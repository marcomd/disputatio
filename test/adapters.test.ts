// Adapter classifier tests — run against fake CLIs (test/fakes/*) that replay
// envelopes captured from REAL runs (research/canary-results.md + the
// 2026-06-11 budget-exceeded canary). The fakes shadow the real binaries via PATH.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { claudeAdapter, agyAdapter, codexAdapter } from "../src/adapters.ts";

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
