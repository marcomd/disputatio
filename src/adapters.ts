// Transport layer (Kaizen v0).
// One job: spawn a real agent CLI, capture its output, classify success/failure.
// Every rule here is grounded in research/canary-results.md (verified locally).
// Written with node: APIs so it runs on Node 24 today and stays Bun-compatible.

import { spawn } from "node:child_process";

// Agents can think for minutes; cap wall-clock. 10m: a repo-grounded run showed
// 5m is too tight for larger evidence-gathering turns.
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export type CliCapture = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

// After SIGTERM-ing a timed-out group, wait this long for a graceful exit, then
// SIGKILL the whole group. A CLI that traps/ignores SIGTERM cannot outlive this.
export const KILL_GRACE_MS = 2_000;

// Spawn a CLI in `cwd`. stdin is IGNORED (= </dev/null): the canary showed Codex
// hangs waiting for stdin EOF otherwise. stdout/stderr captured separately.
//
// `detached: true` makes the child its OWN process-group leader (pgid === pid) so
// a timeout can kill the WHOLE tree, not just the direct child. This is a
// correctness fix, not hygiene: in the 2026-06-12 I Love Coding run a turn ran
// past the cap, SIGTERM hit only the direct child, and a leaked worker kept the
// stdout pipe open — so `close` never fired and the whole debate hung ~45 min at
// ~0 CPU. Group-kill closes the pipe, `close` fires, the turn resolves as timeout,
// and the round proceeds. (Negative pid in process.kill = signal the group.)
function runCli(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CliCapture> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;

    // Signal the child's whole process group. ESRCH (group already gone) is benign.
    // We target the group (-pid), never node's own group, because `detached` put
    // the child in its own group — so this can't kill the orchestrator.
    const killGroup = (signal: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, signal); }
      catch { /* already dead */ }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      hardTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS); // escalate if ignored
    }, timeoutMs);

    const finish = (cap: CliCapture) => {
      clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      resolve(cap);
    };

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { finish({ code: null, stdout, stderr: String(e), timedOut }); });
    child.on("close", (code) => { finish({ code, stdout, stderr, timedOut }); });
  });
}

export type AgentResult =
  | { ok: true; text: string; costUsd?: number; raw?: CliCapture }
  | { ok: false; error: string; budgetExhausted?: true; raw?: CliCapture };

export type Participant = {
  id: string;
  display: string;
  vendor: string; // used for the cross-vendor sanity check (diversity is the whole point)
  run: (prompt: string, cwd: string) => Promise<AgentResult>;
};

// exit 126/127 = the shell could not run the binary at all (e.g. a stale asdf
// shim shadowing the real install) — a setup problem, not an agent failure.
function spawnFailure(r: CliCapture): string | null {
  if (r.code === 126 || r.code === 127) {
    return `binary not runnable (exit ${r.code}) — check PATH / asdf shims, or set 'bin' in debate.yaml. stderr: ${r.stderr.slice(0, 200)}`;
  }
  return null;
}

// --- Claude Code: rich JSON envelope -------------------------------------------------
export type ClaudeOpts = { maxBudgetUsd?: number; timeoutMs?: number; effort?: string };

export function claudeAdapter(model = "sonnet", opts: ClaudeOpts = {}): Participant {
  // $5 default: raised from $2 after the redactio (full transcript + repo traversal at
  // effort:high) hit the $2 cap on a real medium-sized run. Use --budget to override.
  const budget = opts.maxBudgetUsd ?? 5;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "claude",
    display: `Claude (${model})`,
    vendor: "anthropic",
    async run(prompt, cwd) {
      const r = await runCli("claude", [
        "-p", prompt,
        "--output-format", "json",
        "--model", model,
        // read-only evidence tools; enough to run the existing tests = the moat.
        // Comma-separated permission rules (research/claude-code-headless.md) —
        // the rules themselves contain spaces, so commas are the only safe separator.
        "--allowedTools", "Read,Glob,Grep,WebFetch,WebSearch,Bash(npm test *),Bash(pytest *),Bash(bun test *),Bash(rspec *),Bash(bundle exec rspec *),Bash(ls *),Bash(cat *),Bash(git diff *),Bash(git log *)",
        "--disallowedTools", "Edit,Write,NotebookEdit",
        "--permission-mode", "dontAsk", // headless: deny anything not allowlisted, never prompt
        "--no-session-persistence",
        "--max-budget-usd", String(budget),
        // Reasoning effort, to dose token spend. Native flag; values: low|medium|high|xhigh|max.
        ...(opts.effort ? ["--effort", opts.effort] : []),
      ], cwd, timeoutMs);
      if (r.timedOut) return { ok: false, error: "timeout", raw: r };
      const spawnErr = spawnFailure(r);
      if (spawnErr) return { ok: false, error: spawnErr, raw: r };
      try {
        const j = JSON.parse(r.stdout);
        // CANARY LESSON: trust is_error, NOT subtype. On error, subtype stays "success"
        // while is_error flips true. So classify on is_error + exit code.
        if (r.code === 0 && j.is_error === false) {
          return { ok: true, text: String(j.result ?? ""), costUsd: j.total_cost_usd, raw: r };
        }
        // CANARY LESSON (2026-06-11): on budget exhaustion there is NO `result`
        // string — the message lives in the `errors` array and subtype becomes
        // "error_max_budget_usd". Read all three places, most specific first.
        // Note: for SUCCESS we trust is_error not subtype (subtype lies); but for
        // budget exhaustion specifically, subtype IS the reliable discriminator.
        const budgetExhausted: true | undefined = j.subtype === "error_max_budget_usd" ? true : undefined;
        const error =
          Array.isArray(j.errors) && j.errors.length > 0 ? j.errors.join("; ")
          : typeof j.result === "string" && j.result ? j.result
          : `is_error=${j.is_error} subtype=${j.subtype}`;
        return { ok: false, error, ...(budgetExhausted && { budgetExhausted }), raw: r };
      } catch {
        return { ok: false, error: `exit=${r.code} ${r.stderr.slice(0, 200)}`, raw: r };
      }
    },
  };
}

// --- Antigravity (Gemini): text-only -------------------------------------------------
export type AgyOpts = { timeoutMs?: number };

export function agyAdapter(model = "Gemini 3.5 Flash (High)", opts: AgyOpts = {}): Participant {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "agy",
    display: `Antigravity (${model})`,
    vendor: "google",
    async run(prompt, cwd) {
      // agy has NO --output-format/--json (canary): stdout IS the answer, clean.
      // --sandbox: print mode is agentic and can auto-execute terminal commands;
      // sandbox keeps it on terminal restrictions. Canaried 2026-06-11.
      const r = await runCli("agy", [
        "--sandbox",
        "--print-timeout", `${Math.ceil(timeoutMs / 60_000)}m`, // agy's own default (5m) is shorter than ours
        "--model", model,
        "-p", prompt,
      ], cwd, timeoutMs);
      if (r.timedOut) return { ok: false, error: "timeout", raw: r };
      const spawnErr = spawnFailure(r);
      if (spawnErr) return { ok: false, error: spawnErr, raw: r };
      const text = r.stdout.trim();
      if (r.code === 0 && text.length > 0) return { ok: true, text, raw: r };
      return { ok: false, error: `exit=${r.code} ${r.stderr.slice(0, 200)}`, raw: r };
    },
  };
}

// --- Codex (OpenAI): JSONL stream ----------------------------------------------------
export type CodexOpts = { bin?: string; timeoutMs?: number; effort?: string };

export function codexAdapter(model?: string, opts: CodexOpts = {}): Participant {
  // `bin` is configurable because a stale shim can shadow the real binary
  // (observed locally: asdf shim with codex 0.1.x hiding Homebrew's 0.139.0).
  const bin = opts.bin ?? "codex";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "codex",
    display: `Codex (${model ?? "account default"})`,
    vendor: "openai",
    async run(prompt, cwd) {
      // Recipe canaried on codex 0.139.0 (2026-06-11) + research/codex-cli-headless.md:
      // -s read-only is an OS-enforced sandbox; --ephemeral = no session rollout
      // files (orchestrator owns memory); --skip-git-repo-check for temp dirs.
      const r = await runCli(bin, [
        "exec",
        "--json",
        "-s", "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        ...(model ? ["-m", model] : []),
        // Reasoning effort, to dose token spend. No dedicated flag: set it via a
        // config override. Values: minimal|low|medium|high.
        ...(opts.effort ? ["-c", `model_reasoning_effort="${opts.effort}"`] : []),
        prompt,
      ], cwd, timeoutMs);
      if (r.timedOut) return { ok: false, error: "timeout", raw: r };
      const spawnErr = spawnFailure(r);
      if (spawnErr) return { ok: false, error: spawnErr, raw: r };
      // JSONL: final answer = LAST item.completed with item.type === "agent_message".
      // Success = exit 0 && a turn.completed seen && no error/turn.failed event.
      let text = "";
      let turnCompleted = false;
      let failure = "";
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; } // tolerate non-JSON noise on stdout
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") text = String(ev.item.text ?? "");
        else if (ev.type === "turn.completed") turnCompleted = true;
        else if (ev.type === "turn.failed") failure ||= String(ev.error?.message ?? "turn.failed");
        else if (ev.type === "error") failure ||= String(ev.message ?? "error event");
      }
      if (r.code === 0 && turnCompleted && !failure && text.length > 0) {
        return { ok: true, text, raw: r }; // no costUsd: ChatGPT-account auth reports tokens, not dollars
      }
      return { ok: false, error: failure || `exit=${r.code} ${r.stderr.slice(0, 200)}`, raw: r };
    },
  };
}

// --- Pi (earendil-works/pi): JSON event stream, multi-LLM harness --------------------
// `pi` is a minimal, low-overhead coding agent that fronts MANY providers behind one
// harness (https://github.com/earendil-works/pi). The *harness* is its own vendor here:
// the cross-vendor diversity check keys on the harness, not the backing model.
export type PiOpts = { bin?: string; timeoutMs?: number; effort?: string };

export function piAdapter(model?: string, opts: PiOpts = {}): Participant {
  // `bin` is configurable for the same reason as codex: a stale shim can shadow it.
  const bin = opts.bin ?? "pi";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "pi",
    display: `Pi (${model ?? "account default"})`,
    vendor: "pi",
    async run(prompt, cwd) {
      // `--mode json` emits the session as JSON lines on stdout (docs: pi.dev/docs/latest/json).
      // `--no-session` = ephemeral, the orchestrator owns memory. READ-ONLY evidence: pi has
      // no OS sandbox, so we restrict the tool ALLOWLIST to read,grep,find,ls (omitting bash,
      // edit, write) — agents can inspect the repo but never mutate it. `--thinking` doses
      // reasoning effort (off|minimal|low|medium|high|xhigh). Prompt is the positional.
      const r = await runCli(bin, [
        "--mode", "json",
        "--no-session",
        "--tools", "read,grep,find,ls",
        ...(model ? ["--model", model] : []),
        ...(opts.effort ? ["--thinking", opts.effort] : []),
        prompt,
      ], cwd, timeoutMs);
      if (r.timedOut) return { ok: false, error: "timeout", raw: r };
      const spawnErr = spawnFailure(r);
      if (spawnErr) return { ok: false, error: spawnErr, raw: r };
      // JSON lines: final answer = the LAST `message_end` for an assistant message; its
      // `message.content` is either a string or an array of blocks (take the `text` ones).
      // Failures surface in `auto_retry_end.finalError`. Success = exit 0 + a final message.
      let text = "";
      let failure = "";
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; } // tolerate non-JSON noise on stdout
        if (ev.type === "message_end" && ev.message?.role === "assistant") {
          text = piMessageText(ev.message);
        } else if (ev.type === "auto_retry_end" && ev.finalError) {
          failure ||= String(ev.finalError);
        }
      }
      if (r.code === 0 && !failure && text.length > 0) return { ok: true, text, raw: r };
      return { ok: false, error: failure || `exit=${r.code} ${r.stderr.slice(0, 200)}`, raw: r };
    },
  };
}

// Pi's assistant message content is a string OR an array of content blocks; join the
// text blocks. Kept tiny and defensive so a shape tweak degrades to "" not a throw.
function piMessageText(message: any): string {
  const c = message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).join("").trim();
  }
  return "";
}

// --- GitHub Copilot CLI: JSONL stream ------------------------------------------------
export type CopilotCliOpts = { bin?: string; timeoutMs?: number; effort?: string };

export function copilotCliAdapter(model?: string, opts: CopilotCliOpts = {}): Participant {
  // The npm package is @github/copilot, but the installed binary is `copilot`.
  // Keep `bin` configurable to handle shadowed/stale shims like codex/pi.
  const bin = opts.bin ?? "copilot";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "copilot-cli",
    display: `Copilot CLI (${model ?? "auto"})`,
    vendor: "github-copilot",
    async run(prompt, cwd) {
      // Canaried with @github/copilot 1.0.65: `-p` is non-interactive prompt mode;
      // `--output-format json` is JSONL; read-only evidence is a tool availability
      // allowlist of view/glob/grep, with builtin GitHub MCP disabled.
      const r = await runCli(bin, [
        "-p", prompt,
        "--output-format", "json",
        "--stream", "off",
        "--no-color",
        "--no-remote",
        "--no-remote-export",
        "--no-auto-update",
        "--no-ask-user",
        "--disable-builtin-mcps",
        "--available-tools", "view,glob,grep",
        ...(model ? ["--model", model] : []),
        ...(opts.effort ? ["--effort", opts.effort] : []),
      ], cwd, timeoutMs);
      if (r.timedOut) return { ok: false, error: "timeout", raw: r };
      const spawnErr = spawnFailure(r);
      if (spawnErr) return { ok: false, error: spawnErr, raw: r };

      let text = "";
      let sawResult = false;
      let resultExit: number | undefined;
      let failure = "";
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "assistant.message" && typeof ev.data?.content === "string") {
          text = ev.data.content.trim();
        } else if (ev.type === "result") {
          sawResult = true;
          resultExit = typeof ev.exitCode === "number" ? ev.exitCode : undefined;
          if (ev.error) failure ||= String(ev.error);
        } else if (ev.type === "error") {
          failure ||= String(ev.message ?? ev.data?.message ?? "error event");
        }
      }
      if (r.code === 0 && sawResult && resultExit === 0 && !failure && text.length > 0) return { ok: true, text, raw: r };
      return { ok: false, error: failure || r.stderr.trim().slice(0, 200) || `exit=${r.code}`, raw: r };
    },
  };
}
