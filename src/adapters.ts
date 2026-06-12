// Transport layer (Kaizen v0).
// One job: spawn a real agent CLI, capture its output, classify success/failure.
// Every rule here is grounded in research/canary-results.md (verified locally).
// Written with node: APIs so it runs on Node 24 today and stays Bun-compatible.

import { spawn } from "node:child_process";

// Agents can think for minutes; cap wall-clock. 10m: a repo-grounded run showed
// 5m is too tight for larger evidence-gathering turns.
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export type CliCapture = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

// Spawn a CLI in `cwd`. stdin is IGNORED (= </dev/null): the canary showed Codex
// hangs waiting for stdin EOF otherwise. stdout/stderr captured separately.
function runCli(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CliCapture> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM"); // v0: kills the child; process-tree kill is a later hardening (see docs/3_ADAPTERS.md)
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: String(e), timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export type AgentResult =
  | { ok: true; text: string; costUsd?: number; raw?: CliCapture }
  | { ok: false; error: string; raw?: CliCapture };

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
export type ClaudeOpts = { maxBudgetUsd?: number; timeoutMs?: number };

export function claudeAdapter(model = "sonnet", opts: ClaudeOpts = {}): Participant {
  // $2 default: a repo-grounded turn approached the old $1 cap.
  const budget = opts.maxBudgetUsd ?? 2;
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
        const error =
          Array.isArray(j.errors) && j.errors.length > 0 ? j.errors.join("; ")
          : typeof j.result === "string" && j.result ? j.result
          : `is_error=${j.is_error} subtype=${j.subtype}`;
        return { ok: false, error, raw: r };
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
export type CodexOpts = { bin?: string; timeoutMs?: number };

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
