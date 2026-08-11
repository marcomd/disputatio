// Adapter classifier tests — run against fake CLIs (test/fakes/*) that replay
// envelopes captured from REAL runs (research/canary-results.md + the
// 2026-06-11 budget-exceeded canary). The fakes shadow the real binaries via PATH.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { claudeAdapter, agyAdapter, codexAdapter, piAdapter, copilotCliAdapter } from "../src/adapters.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
process.env.PATH = `${join(here, "fakes")}:${process.env.PATH}`;

const cwd = tmpdir();

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("FAKE_")) delete process.env[k];
});

// --- claude: JSON envelope ------------------------------------------------------------

test("claude: success envelope → ok with text and cost", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-success.json");
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, "pong");
  assert.equal(r.ok && r.costUsd, 0.10388775);
});

test("claude: --max-budget-usd defaults to $5, overridable via maxBudgetUsd", async () => {
  const argvFile = join(tmpdir(), `disputatio-claude-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-success.json");
  process.env.FAKE_ARGV_FILE = argvFile;

  await claudeAdapter().run("ping", cwd);
  let argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "5");

  await claudeAdapter("sonnet", { maxBudgetUsd: 10 }).run("ping", cwd);
  argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "10");
});

test("claude: effort is passed as --effort when set, omitted when absent", async () => {
  const argvFile = join(tmpdir(), `disputatio-claude-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-success.json");
  process.env.FAKE_ARGV_FILE = argvFile;

  await claudeAdapter("sonnet", { effort: "high" }).run("ping", cwd);
  let argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(argv.includes("--effort"), "expected --effort in argv");
  assert.equal(argv[argv.indexOf("--effort") + 1], "high");

  await claudeAdapter("sonnet").run("ping", cwd);
  argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(!argv.includes("--effort"), "expected no --effort when effort is unset");
});

test("codex: effort is passed as model_reasoning_effort override when set, omitted when absent", async () => {
  const argvFile = join(tmpdir(), `disputatio-codex-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-success.jsonl");
  process.env.FAKE_ARGV_FILE = argvFile;

  await codexAdapter(undefined, { bin: join(here, "fakes", "codex"), effort: "high" }).run("ping", cwd);
  let argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(argv.includes(`model_reasoning_effort="high"`), `expected the config override in argv, got ${JSON.stringify(argv)}`);

  await codexAdapter(undefined, { bin: join(here, "fakes", "codex") }).run("ping", cwd);
  argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(!argv.some((a) => a.startsWith("model_reasoning_effort")), "expected no effort override when unset");
});

test("claude: budget-exceeded envelope (no `result` string) → error from `errors` array", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-budget-error.json");
  process.env.FAKE_EXIT = "1";
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /Reached maximum budget/);
  assert.equal(!r.ok ? r.budgetExhausted : undefined, true); // structural flag, not string-match
});

test("claude: REGRESSION — subtype lies on error; classify on is_error", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-model-error.json");
  process.env.FAKE_EXIT = "1";
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, false); // subtype says "success" — is_error must win
  assert.match(!r.ok ? r.error : "", /issue with the selected model/);
});

test("claude: non-JSON stdout → error with exit code", async () => {
  process.env.FAKE_STDERR = "boom";
  process.env.FAKE_EXIT = "1";
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /exit=1/);
});

test("claude: exit 126 (stale shim) → setup hint, not a cryptic error", async () => {
  process.env.FAKE_EXIT = "126";
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /asdf shims/);
});

// --- agy: text-only -------------------------------------------------------------------

test("agy: trimmed stdout is the answer", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-success.json"); // any text payload works
  const r = await agyAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
});

test("agy: empty stdout → failure even on exit 0", async () => {
  const r = await agyAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
});

test("agy: timeout kills the run and reports it", async () => {
  process.env.FAKE_SLEEP = "2";
  const r = await agyAdapter("Gemini 3.5 Flash (High)", { timeoutMs: 200 }).run("ping", cwd);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "timeout");
});

test("REGRESSION — leaked worker holding the pipe + SIGTERM-ignoring CLI still times out fast (process-group kill)", async () => {
  // Reproduces the deadlock from the 2026-06-12 I Love Coding run: a turn ran past
  // the cap, the timeout SIGTERM'd only the direct child, but a leaked worker kept
  // stdout open so `close` never fired and the run hung for ~45 min at ~0 CPU.
  // The fix (detached spawn + process-GROUP kill) must resolve near the timeout.
  process.env.FAKE_HANG = "1";
  const start = Date.now();
  const r = await agyAdapter("Gemini 3.5 Flash (High)", { timeoutMs: 200 }).run("ping", cwd);
  const elapsed = Date.now() - start;
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "timeout");
  assert.ok(elapsed < 4000, `expected a fast group-kill timeout, took ${elapsed}ms (the leaked worker is holding the pipe)`);
});

// --- codex: JSONL ----------------------------------------------------------------------

test("codex: success JSONL → LAST agent_message wins", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-success.jsonl");
  const r = await codexAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, "pong"); // not "intermediate thought"
});

test("codex: turn.failed → failure with the event's message", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-turn-failed.jsonl");
  process.env.FAKE_EXIT = "1";
  const r = await codexAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /not supported/);
});

test("codex: exit 0 but no turn.completed → failure (incomplete stream)", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-turn-failed.jsonl");
  const r = await codexAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
});

test("codex: custom bin override is used", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-success.jsonl");
  const r = await codexAdapter(undefined, { bin: join(here, "fakes", "codex") }).run("ping", cwd);
  assert.equal(r.ok, true);
});

// --- pi: JSON event stream -------------------------------------------------------------

test("pi: success JSON lines → LAST assistant message_end wins", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-success.jsonl");
  const r = await piAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, "pong"); // not "intermediate thought"
});

test("pi: runs read-only (tools allowlist, no edit/write/bash) in json mode", async () => {
  const argvFile = join(tmpdir(), `disputatio-pi-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-success.jsonl");
  process.env.FAKE_ARGV_FILE = argvFile;
  await piAdapter().run("ping", cwd);
  const argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--mode") + 1], "json");
  const tools = argv[argv.indexOf("--tools") + 1];
  assert.equal(tools, "read,grep,find,ls");
  assert.ok(!/\b(edit|write|bash)\b/.test(tools), "read-only: no mutating tools");
});

test("pi: effort is passed as --thinking when set, omitted when absent", async () => {
  const argvFile = join(tmpdir(), `disputatio-pi-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-success.jsonl");
  process.env.FAKE_ARGV_FILE = argvFile;

  await piAdapter(undefined, { effort: "high" }).run("ping", cwd);
  let argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--thinking") + 1], "high");

  await piAdapter().run("ping", cwd);
  argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(!argv.includes("--thinking"), "expected no --thinking when effort is unset");
});

test("pi: auto_retry_end finalError → failure with the error", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-retry-error.jsonl");
  process.env.FAKE_EXIT = "1";
  const r = await piAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /rate limit/);
});

test("pi: custom bin override is used", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-success.jsonl");
  const r = await piAdapter(undefined, { bin: join(here, "fakes", "pi") }).run("ping", cwd);
  assert.equal(r.ok, true);
});

// --- GitHub Copilot CLI: JSON event stream ------------------------------------------

test("copilot-cli: success JSON lines → LAST assistant.message wins", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-success.jsonl");
  const r = await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, "pong");
});

test("copilot-cli: runs read-only (available-tools view/glob/grep, no bash/edit/write) in json mode", async () => {
  const argvFile = join(tmpdir(), `disputatio-copilot-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-success.jsonl");
  process.env.FAKE_ARGV_FILE = argvFile;
  await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  const argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--output-format") + 1], "json");
  assert.ok(argv.includes("--disable-builtin-mcps"), "expected builtin GitHub MCP disabled");
  const tools = argv[argv.indexOf("--available-tools") + 1];
  assert.equal(tools, "view,glob,grep");
  assert.ok(!/\b(bash|edit|write|create)\b/.test(tools), "read-only: no mutating tools");
});

test("copilot-cli: effort is passed as --effort when set, omitted when absent", async () => {
  const argvFile = join(tmpdir(), `disputatio-copilot-effort-argv-${process.pid}.txt`);
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-success.jsonl");
  process.env.FAKE_ARGV_FILE = argvFile;

  await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot"), effort: "high" }).run("ping", cwd);
  let argv = readFileSync(argvFile, "utf8").split("\n");
  assert.equal(argv[argv.indexOf("--effort") + 1], "high");

  await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  argv = readFileSync(argvFile, "utf8").split("\n");
  assert.ok(!argv.includes("--effort"), "expected no --effort when effort is unset");
});

test("copilot-cli: result exitCode non-zero → failure", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-error.jsonl");
  process.env.FAKE_EXIT = "1";
  const r = await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /rate limit/);
});

test("copilot-cli: custom bin override is used", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-success.jsonl");
  const r = await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  assert.equal(r.ok, true);
});

// --- P1: signal capture (5_METRICS.md §8) ---------------------------------------------

test("REGRESSION — a signal-killed CLI reports the SIGNAL, not a bare `exit=null`", async () => {
  // The 2026-08-04 run's pi reaction returned code=null with empty stdout AND stderr,
  // and the error read `exit=null ` — cause undiagnosable, because runCli dropped the
  // `signal` argument node passes to `close`. Capture it and say which signal it was.
  process.env.FAKE_KILL_SELF = "KILL";
  const r = await piAdapter().run("ping", cwd);
  assert.equal(r.ok, false);
  assert.equal(r.raw?.signal, "SIGKILL");
  assert.equal(r.raw?.code, null);
  assert.match(!r.ok ? r.error : "", /SIGKILL/);
  assert.doesNotMatch(!r.ok ? r.error : "", /exit=null/);
});

test("REGRESSION — copilot: stderr noise must not swallow the signal", async () => {
  // copilot was the one adapter whose error string put stderr BEFORE the exit label, so a
  // signal death that printed any warning reported only the warning — the same blind spot
  // the signal capture exists to close, in the one place the fix had not reached.
  process.env.FAKE_KILL_SELF = "KILL";
  process.env.FAKE_STDERR = "npm warn deprecated";
  const r = await copilotCliAdapter(undefined, { bin: join(here, "fakes", "copilot") }).run("ping", cwd);
  assert.equal(r.ok, false);
  assert.equal(r.raw?.signal, "SIGKILL");
  assert.match(!r.ok ? r.error : "", /signal=SIGKILL/);
  assert.match(!r.ok ? r.error : "", /npm warn deprecated/); // stderr still reported, just not INSTEAD
});

test("signal is null on a normal exit (no false positives)", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-success.jsonl");
  const r = await piAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.raw?.signal, null);
});

// --- P1: canExecute capability flag ----------------------------------------------------

test("canExecute reflects whether the adapter grants a shell at all", () => {
  // Not cosmetic: `ranCommands === 0` means "gathered no executable evidence" only for
  // participants that COULD execute. pi and copilot are shell-less by invariant, so a
  // raw count would score them evidence-free for obeying their own allowlist.
  assert.equal(claudeAdapter().canExecute, true);       // Bash(...) in --allowedTools
  assert.equal(codexAdapter().canExecute, true);        // -s read-only = OS-sandboxed shell
  assert.equal(agyAdapter().canExecute, true);          // --sandbox
  assert.equal(piAdapter().canExecute, false);          // --tools read,grep,find,ls
  assert.equal(copilotCliAdapter().canExecute, false);  // --available-tools view,glob,grep
});

// --- P1: per-turn evidence counts ------------------------------------------------------

test("codex: counts command_execution items as ranCommands", async () => {
  // Count item.completed ONLY. item.started carries the same item_type, so counting both
  // double-reports every command (the error a first hand-analysis of the run made).
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-evidence.jsonl");
  const r = await codexAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.evidence?.ranCommands, 3);
  // toolCalls is NOT an alias of ranCommands: the fixture also carries a `web_search`
  // item (a tool call that runs no command), and a `reasoning` item (narration, not a
  // tool). Aliasing the two would report a read-only codex turn as zero tool activity.
  assert.equal(r.evidence?.toolCalls, 4);
});

test("pi: counts tool calls, and reports ranCommands 0 (shell-less)", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "pi-evidence.jsonl");
  const r = await piAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.evidence?.toolCalls, 2);
  assert.equal(r.evidence?.ranCommands, 0);
});

test("copilot-cli: counts tool calls, and reports ranCommands 0 (shell-less)", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "copilot-evidence.jsonl");
  const r = await copilotCliAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.evidence?.toolCalls, 2);
  assert.equal(r.evidence?.ranCommands, 0);
});

test("claude: exposes num_turns + permission_denials as the evidence proxy", async () => {
  // The envelope does not break out shell commands, so ranCommands stays UNDEFINED
  // (unknown) rather than 0 (known-none) — the distinction the gate depends on.
  process.env.FAKE_STDOUT_FILE = join(fixtures, "claude-evidence.json");
  const r = await claudeAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.evidence?.agentTurns, 12);
  assert.equal(r.evidence?.permissionDenials, 1);
  assert.equal(r.evidence?.ranCommands, undefined);
});

test("evidence counting tolerates a stream with no tool activity", async () => {
  process.env.FAKE_STDOUT_FILE = join(fixtures, "codex-success.jsonl");
  const r = await codexAdapter().run("ping", cwd);
  assert.equal(r.ok, true);
  assert.equal(r.evidence?.ranCommands, 0);
});
