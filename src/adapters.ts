// Transport layer (Kaizen v0).
// One job: spawn a real agent CLI, capture its output, classify success/failure.
// Every rule here is grounded in research/canary-results.md (verified locally).
// Written with node: APIs so it runs on Node 24 today and stays Bun-compatible.

import { spawn } from "node:child_process";

const TIMEOUT_MS = 5 * 60 * 1000; // agents can think for minutes; cap wall-clock

type CliResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

// Spawn a CLI in `cwd`. stdin is IGNORED (= </dev/null): the canary showed Codex
// hangs waiting for stdin EOF otherwise. stdout/stderr captured separately.
function runCli(cmd: string, args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM"); // v0: kills the child; process-tree kill is a later hardening (see 3_ADAPTERS.md)
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: String(e), timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export type AgentResult =
  | { ok: true; text: string; costUsd?: number }
  | { ok: false; error: string };

export type Participant = {
  id: string;
  display: string;
  vendor: string; // used for the cross-vendor sanity check (diversity is the whole point)
  run: (prompt: string, cwd: string) => Promise<AgentResult>;
};

// --- Claude Code: rich JSON envelope -------------------------------------------------
export function claudeAdapter(model = "sonnet"): Participant {
  return {
    id: "claude",
    display: `Claude (${model})`,
    vendor: "anthropic",
    async run(prompt, cwd) {
      const r = await runCli("claude", [
        "-p", prompt,
        "--output-format", "json",
        "--model", model,
        // read-only evidence tools; enough to run the existing tests = the moat
        "--allowedTools", "Read Glob Grep WebFetch WebSearch Bash(npm test*) Bash(pytest*) Bash(bun test*) Bash(ls *) Bash(cat *) Bash(git diff*)",
        "--no-session-persistence",
        "--max-budget-usd", "1.00",
      ], cwd);
      if (r.timedOut) return { ok: false, error: "timeout" };
      try {
        const j = JSON.parse(r.stdout);
        // CANARY LESSON: trust is_error, NOT subtype. On error, subtype stays "success"
        // while is_error flips true. So classify on is_error + exit code.
        if (r.code === 0 && j.is_error === false) {
          return { ok: true, text: String(j.result ?? ""), costUsd: j.total_cost_usd };
        }
        return { ok: false, error: typeof j.result === "string" ? j.result : `is_error=${j.is_error}` };
      } catch {
        return { ok: false, error: `exit=${r.code} ${r.stderr.slice(0, 200)}` };
      }
    },
  };
}

// --- Antigravity (Gemini): text-only -------------------------------------------------
export function agyAdapter(model = "Gemini 3.5 Flash (High)"): Participant {
  return {
    id: "agy",
    display: `Antigravity (${model})`,
    vendor: "google",
    async run(prompt, cwd) {
      // agy has NO --output-format/--json (canary): stdout IS the answer, clean.
      const r = await runCli("agy", ["-p", prompt, "--model", model], cwd);
      if (r.timedOut) return { ok: false, error: "timeout" };
      const text = r.stdout.trim();
      if (r.code === 0 && text.length > 0) return { ok: true, text };
      return { ok: false, error: `exit=${r.code} ${r.stderr.slice(0, 200)}` };
    },
  };
}
