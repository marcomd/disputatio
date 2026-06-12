// doctor (M0 preflight) tests — exercise the orchestration seam with STUB
// Participants (canned `run`), not real CLIs. The CLI transport / success
// classification is already covered by adapters.test.ts; here we only test that
// the canary fan-out, classification, allHealthy gate, and report formatting
// behave. Stubs also keep the shared FAKE_STDOUT_FILE env from colliding when
// claude+codex canary in parallel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor, allHealthy, formatDiagnoses } from "../src/doctor.ts";
import type { Participant, AgentResult } from "../src/adapters.ts";

function stub(id: string, vendor: string, result: AgentResult): Participant {
  return { id, display: `${id} (stub)`, vendor, run: async () => result };
}

test("doctor: all participants answer the canary → all ok, allHealthy true", async () => {
  const ds = await runDoctor([
    stub("claude", "anthropic", { ok: true, text: "pong" }),
    stub("codex", "openai", { ok: true, text: "pong" }),
  ]);
  assert.equal(ds.length, 2);
  assert.ok(ds.every((d) => d.ok));
  assert.equal(allHealthy(ds), true);
});

test("doctor: one participant fails → that diagnosis ok:false and allHealthy false", async () => {
  const ds = await runDoctor([
    stub("claude", "anthropic", { ok: true, text: "pong" }),
    stub("codex", "openai", { ok: false, error: "binary not runnable (exit 127) — check PATH / asdf shims" }),
  ]);
  assert.equal(allHealthy(ds), false);
  const codex = ds.find((d) => d.id === "codex");
  assert.equal(codex?.ok, false);
  // raw error excerpt must survive into the diagnosis so the codex stale-shim
  // footgun (0.1.x shadowing 0.139.0) is diagnosable from doctor output alone.
  assert.match(codex?.detail ?? "", /asdf shims/);
});

test("doctor: a participant that throws is reported as unhealthy, not crash the run", async () => {
  const ds = await runDoctor([
    stub("claude", "anthropic", { ok: true, text: "pong" }),
    { id: "boom", display: "boom", vendor: "x", run: async () => { throw new Error("kaboom"); } },
  ]);
  assert.equal(allHealthy(ds), false);
  assert.match(ds.find((d) => d.id === "boom")?.detail ?? "", /kaboom/);
});

test("doctor: report shows a per-participant marker, vendor, and the failing detail", async () => {
  const ds = await runDoctor([
    stub("claude", "anthropic", { ok: true, text: "pong" }),
    stub("codex", "openai", { ok: false, error: "not authenticated" }),
  ]);
  const report = formatDiagnoses(ds);
  assert.match(report, /claude/);
  assert.match(report, /anthropic/);
  assert.match(report, /not authenticated/);
  assert.match(report, /1\/2/); // healthy count summary
});
