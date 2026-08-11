// Install / --init tests. resolveBinary's "pin only when needed" branching is tested as
// a pure function (injected canary); runInit is tested through dependency injection —
// a stub buildParticipant whose canary verdict is driven by the bin, so no real CLI is
// spawned. The codex stale-shim scenario (PATH binary fails, a brew path works) is the
// motivating case and the thing we assert end-to-end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBinary, runInit } from "../src/install.ts";
import type { ParticipantSpec } from "../src/config.ts";
import type { Participant } from "../src/adapters.ts";

// --- resolveBinary (pure) -------------------------------------------------------------

test("resolveBinary: PATH binary works → ok, no pin, alternatives untouched", async () => {
  let calls = 0;
  const res = await resolveBinary("codex", ["/opt/homebrew/bin/codex"], async (bin) => { calls++; return bin === "codex"; });
  assert.deepEqual(res, { ok: true, tried: ["codex"] });
  assert.equal(calls, 1); // short-circuits — never canaries the alternative
});

test("resolveBinary: PATH binary fails, an alternative works → pin that alternative", async () => {
  const res = await resolveBinary("codex", ["/n/a/codex", "/opt/homebrew/bin/codex"], async (bin) => bin === "/opt/homebrew/bin/codex");
  assert.equal(res.ok, true);
  assert.equal(res.bin, "/opt/homebrew/bin/codex");
});

test("resolveBinary: nothing works → ok:false, no bin", async () => {
  const res = await resolveBinary("codex", ["/opt/homebrew/bin/codex"], async () => false);
  assert.equal(res.ok, false);
  assert.equal(res.bin, undefined);
});

// --- runInit (DI) ---------------------------------------------------------------------

// A stub lineup factory: the canary verdict is whether the spec's effective binary is in
// `working`. runInit's default canary is runIsolated → p.run, which for a stub never
// spawns a real CLI.
function stubBuild(working: Set<string>) {
  return (spec: ParticipantSpec): Participant => ({
    id: spec.adapter,
    display: spec.adapter,
    vendor: spec.adapter,
    canExecute: true,
    run: async () => (working.has(spec.bin ?? spec.adapter) ? { ok: true, text: "pong" } : { ok: false, error: "stale shim" }),
  });
}

const JUDGE: ParticipantSpec = { adapter: "claude", model: "opus", effort: "high", maxBudgetUsd: 2 };
const tmpCfg = () => join(tmpdir(), `disputatio-init-${process.pid}-${Math.floor(performance.now())}.yaml`);

test("runInit: codex stale shim → brew bin pinned; claude on PATH → no bin; judge seeded", async () => {
  const cfgPath = tmpCfg();
  try {
    const res = await runInit(
      [{ adapter: "claude" }, { adapter: "codex" }],
      JUDGE,
      cfgPath,
      { force: true, deps: {
        buildParticipant: stubBuild(new Set(["claude", "/opt/homebrew/bin/codex"])),
        findAlternatives: async (bin) => (bin === "codex" ? ["/opt/homebrew/bin/codex"] : []),
      } },
    );
    assert.equal(res.exitCode, 0);
    const written = await readFile(cfgPath, "utf8");
    assert.match(written, /adapter: codex/);
    assert.match(written, /bin: \/opt\/homebrew\/bin\/codex/); // pinned because PATH codex failed
    // claude block must NOT carry a bin (PATH binary worked)
    const claudeBlock = written.slice(written.indexOf("adapter: claude"), written.indexOf("adapter: codex"));
    assert.ok(!/bin:/.test(claudeBlock), `claude should have no bin, got: ${claudeBlock}`);
    // judge seeded
    assert.match(written, /judge:/);
    assert.match(written, /model: opus/);
  } finally {
    await rm(cfgPath, { force: true });
  }
});

test("runInit: PATH binaries all work → no bin pinned (only-when-needed)", async () => {
  const cfgPath = tmpCfg();
  try {
    const res = await runInit(
      [{ adapter: "claude" }, { adapter: "codex" }],
      undefined,
      cfgPath,
      { force: true, deps: {
        buildParticipant: stubBuild(new Set(["claude", "codex"])),
        findAlternatives: async () => ["/opt/homebrew/bin/codex"], // present, but never needed
      } },
    );
    assert.equal(res.exitCode, 0);
    const written = await readFile(cfgPath, "utf8");
    assert.ok(!/bin:/.test(written), `no bin should be pinned, got:\n${written}`);
    assert.ok(!/judge:/.test(written), "no judge when none passed");
  } finally {
    await rm(cfgPath, { force: true });
  }
});

test("runInit: a participant with no working binary → exit 1, config not written", async () => {
  const cfgPath = tmpCfg();
  const res = await runInit(
    [{ adapter: "claude" }, { adapter: "codex" }],
    undefined,
    cfgPath,
    { force: true, deps: {
      buildParticipant: stubBuild(new Set(["claude"])), // codex broken everywhere
      findAlternatives: async () => [],
    } },
  );
  assert.equal(res.exitCode, 1);
  await assert.rejects(() => readFile(cfgPath, "utf8")); // nothing written
});
