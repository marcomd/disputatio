// Transport layer (Kaizen v0).
// One job: spawn a real agent CLI, capture its output, classify success/failure.
// Every rule here is grounded in research/canary-results.md (verified locally).
// Written with node: APIs so it runs on Node 24 today and stays Bun-compatible.

import { spawn } from "node:child_process";

// Agents can think for minutes; cap wall-clock. 10m: a repo-grounded run showed
// 5m is too tight for larger evidence-gathering turns.
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// `signal` is NOT decoration: when a CLI is killed, `code` is null and the signal is the
// ONLY evidence of why. The 2026-08-04 run lost a pi turn to `exit=null` with empty
// stdout and stderr, undiagnosable because this field was dropped on the floor.
export type CliCapture = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

// How a run ended, for error strings. `exit=null` alone is a dead end; name the signal.
function exitLabel(r: CliCapture): string {
  return r.signal ? `signal=${r.signal}` : `exit=${r.code}`;
}

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
    child.on("error", (e) => { finish({ code: null, signal: null, stdout, stderr: String(e), timedOut }); });
    child.on("close", (code, signal) => { finish({ code, signal, stdout, stderr, timedOut }); });
  });
}

// Tier-0 evidence counts, extracted per turn by the classifier that already parses the
// stream (docs/5_METRICS.md §8 step 3). This is what makes the evidence-validity check in
// 4_PLAN.md §8 enforceable: today a zero-execution debate is indistinguishable from a
// repo-grounded one.
//
// `ranCommands` distinguishes UNDEFINED (this CLI does not report commands — unknown)
// from 0 (known to have executed none). The gate needs that difference: only 0 paired
// with `canExecute: true` means "could have gathered evidence and did not".
export type Evidence = {
  ranCommands?: number;       // shell commands actually executed
  toolCalls?: number;         // tool invocations of any kind (read/grep/view/…)
  agentTurns?: number;        // claude `num_turns` — a coarse activity proxy, NOT a tool count
  permissionDenials?: number; // tool calls the harness refused (claude)
};

export type AgentResult =
  | { ok: true; text: string; costUsd?: number; evidence?: Evidence; raw?: CliCapture }
  | { ok: false; error: string; budgetExhausted?: true; evidence?: Evidence; raw?: CliCapture };

export type Participant = {
  id: string;
  display: string;
  vendor: string; // used for the cross-vendor sanity check (diversity is the whole point)
  // Whether this adapter grants a shell AT ALL. `pi` and `copilot-cli` are shell-less by
  // invariant (allowlist-only, no OS sandbox / no shell tool), so their `ranCommands: 0`
  // is obedience, not an evidence failure. Scoring the two apart requires this flag.
  canExecute: boolean;
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
    canExecute: true, // Bash(...) rules in --allowedTools below
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
        // The envelope reports no per-command breakdown, so `ranCommands` stays UNDEFINED
        // (unknown, not zero) and num_turns serves as the coarse activity proxy (§8 step 3).
        const evidence: Evidence = {
          ...(typeof j.num_turns === "number" && { agentTurns: j.num_turns }),
          ...(Array.isArray(j.permission_denials) && { permissionDenials: j.permission_denials.length }),
        };
        // CANARY LESSON: trust is_error, NOT subtype. On error, subtype stays "success"
        // while is_error flips true. So classify on is_error + exit code.
        if (r.code === 0 && j.is_error === false) {
          return { ok: true, text: String(j.result ?? ""), costUsd: j.total_cost_usd, evidence, raw: r };
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
        return { ok: false, error, ...(budgetExhausted && { budgetExhausted }), evidence, raw: r };
      } catch {
        return { ok: false, error: `${exitLabel(r)} ${r.stderr.slice(0, 200)}`, raw: r };
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
    canExecute: true, // print mode is agentic; --sandbox restricts it but does not remove the shell
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
      // agy is text-only: no event stream, so nothing to count. Evidence stays undefined
      // (unknown) rather than 0 — it CAN execute, we just cannot observe whether it did.
      const text = r.stdout.trim();
      if (r.code === 0 && text.length > 0) return { ok: true, text, raw: r };
      return { ok: false, error: `${exitLabel(r)} ${r.stderr.slice(0, 200)}`, raw: r };
    },
  };
}

// Codex item detail types that are TOOL invocations (research/codex-cli-headless.md).
// `agent_message`, `reasoning`, `todo_list` and `error` are narration, not tool use, so
// they stay out: `toolCalls` must not be a plain alias of `ranCommands` — a codex turn
// that only reads files or searches the web would otherwise report zero tool activity.
const CODEX_TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search"]);

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
    canExecute: true, // -s read-only is an OS-sandboxed SHELL, not a tool allowlist
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
      let ranCommands = 0;
      let toolCalls = 0;
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; } // tolerate non-JSON noise on stdout
        if (ev.type === "item.completed" && ev.item?.type === "agent_message") text = String(ev.item.text ?? "");
        // Count item.completed ONLY. `item.started` carries the same item.type, so
        // counting both double-reports every command — the exact error a hand-analysis
        // of the 2026-08-04 run made before this moved into the classifier.
        else if (ev.type === "item.completed" && CODEX_TOOL_ITEMS.has(ev.item?.type)) {
          toolCalls++;
          if (ev.item.type === "command_execution") ranCommands++;
        }
        else if (ev.type === "turn.completed") turnCompleted = true;
        else if (ev.type === "turn.failed") failure ||= String(ev.error?.message ?? "turn.failed");
        else if (ev.type === "error") failure ||= String(ev.message ?? "error event");
      }
      const evidence: Evidence = { ranCommands, toolCalls };
      if (r.code === 0 && turnCompleted && !failure && text.length > 0) {
        return { ok: true, text, evidence, raw: r }; // no costUsd: ChatGPT-account auth reports tokens, not dollars
      }
      return { ok: false, error: failure || `${exitLabel(r)} ${r.stderr.slice(0, 200)}`, evidence, raw: r };
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
    canExecute: false, // --tools read,grep,find,ls — bash is deliberately omitted (no OS sandbox)
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
      let toolCalls = 0;
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; } // tolerate non-JSON noise on stdout
        if (ev.type === "message_end" && ev.message?.role === "assistant") {
          text = piMessageText(ev.message);
        } else if (ev.type === "tool_execution_start") {
          toolCalls++;
        } else if (ev.type === "auto_retry_end" && ev.finalError) {
          failure ||= String(ev.finalError);
        }
      }
      // ranCommands is a hard 0, not undefined: the allowlist above omits bash, so we
      // KNOW none ran. Paired with canExecute:false that reads as compliance, not a
      // missing-evidence failure.
      const evidence: Evidence = { ranCommands: 0, toolCalls };
      if (r.code === 0 && !failure && text.length > 0) return { ok: true, text, evidence, raw: r };
      return { ok: false, error: failure || `${exitLabel(r)} ${r.stderr.slice(0, 200)}`, evidence, raw: r };
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
    // --available-tools view,glob,grep — no shell tool exists for this participant, so it
    // cannot run `git` either. In repo mode that is load-bearing: a git WORKTREE has no
    // `.git/` directory (`.git` is a file holding a gitdir pointer), so a shell-less agent
    // cannot reach history by path either. See research/run-2026-08-04-*.md.
    canExecute: false,
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
      let toolCalls = 0;
      for (const line of r.stdout.split("\n")) {
        if (!line.trim()) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "assistant.message" && typeof ev.data?.content === "string") {
          text = ev.data.content.trim();
        } else if (ev.type === "tool.execution_start") {
          toolCalls++;
        } else if (ev.type === "result") {
          sawResult = true;
          resultExit = typeof ev.exitCode === "number" ? ev.exitCode : undefined;
          if (ev.error) failure ||= String(ev.error);
        } else if (ev.type === "error") {
          failure ||= String(ev.message ?? ev.data?.message ?? "error event");
        }
      }
      // ranCommands is a hard 0 for the same reason as pi: no shell tool is available.
      const evidence: Evidence = { ranCommands: 0, toolCalls };
      if (r.code === 0 && sawResult && resultExit === 0 && !failure && text.length > 0) return { ok: true, text, evidence, raw: r };
      // exitLabel FIRST, like every other adapter: stderr must never be able to hide the
      // signal. A SIGKILLed copilot that printed one deprecation warning would otherwise
      // report only that warning — the exact 2026-08-04 blind spot this release closes.
      return { ok: false, error: failure || `${exitLabel(r)} ${r.stderr.trim().slice(0, 200)}`.trim(), evidence, raw: r };
    },
  };
}
