// Config parser tests — the minimal YAML subset behind --config debate.yaml.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDebateConfig, serializeDebateConfig } from "../src/config.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("parses the shipped example config (a portable template — no host-specific bin)", async () => {
  const text = await readFile(join(here, "..", "examples", "debate.yaml"), "utf8");
  const cfg = parseDebateConfig(text);
  assert.equal(cfg.rounds, 1);
  assert.equal(cfg.timeoutMinutes, 10);
  assert.equal(cfg.repo, undefined); // commented out
  assert.equal(cfg.participants?.length, 2);
  assert.deepEqual(cfg.participants?.[0], { adapter: "claude", model: "sonnet", maxBudgetUsd: 2 });
  assert.equal(cfg.participants?.[1].adapter, "codex");
  // P2 fix: the template stays portable — the host-specific bin is commented out so
  // copying it never assumes /opt/homebrew. `--init` pins a real bin per machine.
  assert.equal(cfg.participants?.[1].bin, undefined);
  // The judge (respondeo) is Opus — distinct model from the Sonnet debater, so no
  // exact-display correlated-error match (decision #5).
  assert.equal(cfg.judge?.adapter, "claude");
  assert.equal(cfg.judge?.model, "opus");
});

test("serializeDebateConfig round-trips through parseDebateConfig", () => {
  const cfg = {
    rounds: 2,
    timeoutMinutes: 10,
    participants: [
      { adapter: "claude" as const, model: "sonnet", maxBudgetUsd: 2 },
      { adapter: "codex" as const, bin: "/opt/homebrew/bin/codex", effort: "medium" },
      { adapter: "agy" as const, model: "Gemini 3.5 Flash (High)" },
    ],
    judge: { adapter: "claude" as const, model: "opus", effort: "high", maxBudgetUsd: 2 },
  };
  assert.deepEqual(parseDebateConfig(serializeDebateConfig(cfg)), cfg);
});

test("serializeDebateConfig quotes edge-whitespace values, leaves spaces/parens bare", () => {
  const cfg = {
    participants: [
      { adapter: "codex" as const, model: " spaced " },               // quoted to preserve edges
      { adapter: "claude" as const, model: "Gemini 3.5 Flash (High)" }, // stays bare
    ],
  };
  const text = serializeDebateConfig(cfg);
  assert.match(text, /model: " spaced "/);
  assert.match(text, /model: Gemini 3\.5 Flash \(High\)/);
  assert.deepEqual(parseDebateConfig(text), cfg);
});

test("serializeDebateConfig refuses an unrepresentable comment marker rather than corrupting", () => {
  assert.throws(
    () => serializeDebateConfig({ participants: [{ adapter: "codex", model: "weird #name" }, { adapter: "claude" }] }),
    /comment marker/,
  );
});

test("parses a judge: block (respondeo)", () => {
  const cfg = parseDebateConfig(
    "participants:\n  - adapter: claude\n  - adapter: codex\njudge:\n  adapter: claude\n  model: opus\n  effort: low\n",
  );
  assert.deepEqual(cfg.judge, { adapter: "claude", model: "opus", effort: "low" });
  assert.equal(cfg.participants?.length, 2); // judge is separate from the debaters
});

test("judge is undefined when the section is absent", () => {
  const cfg = parseDebateConfig("participants:\n  - adapter: claude\n  - adapter: codex\n");
  assert.equal(cfg.judge, undefined);
});

test("rejects an unknown judge key with the line number", () => {
  assert.throws(
    () => parseDebateConfig("judge:\n  adapter: claude\n  budget: 2\n"),
    /line 3: unknown participant key "budget"/,
  );
});

test("rejects a judge without a valid adapter", () => {
  assert.throws(() => parseDebateConfig("judge:\n  model: opus\n"), /adapter: claude \| agy \| codex/);
});

test("a top-level key after a judge block closes it (no misattribution)", () => {
  const cfg = parseDebateConfig("judge:\n  adapter: claude\nrounds: 2\n");
  assert.deepEqual(cfg.judge, { adapter: "claude" });
  assert.equal(cfg.rounds, 2);
});

test("models with spaces and parens survive (agy model names)", () => {
  const cfg = parseDebateConfig(
    "participants:\n  - adapter: agy\n    model: Gemini 3.5 Flash (High)\n  - adapter: claude\n",
  );
  assert.equal(cfg.participants?.[0].model, "Gemini 3.5 Flash (High)");
});

test("quoted values are unquoted", () => {
  const cfg = parseDebateConfig('repo: "/tmp/my repo"\n');
  assert.equal(cfg.repo, "/tmp/my repo");
});

test("rejects unknown top-level keys with the line number", () => {
  assert.throws(() => parseDebateConfig("round: 2\n"), /line 1: unknown key "round"/);
});

test("parses per-participant effort (free-form string)", () => {
  const cfg = parseDebateConfig(
    "participants:\n  - adapter: claude\n    effort: high\n  - adapter: codex\n    effort: low\n",
  );
  assert.equal(cfg.participants?.[0].effort, "high");
  assert.equal(cfg.participants?.[1].effort, "low");
});

test("rejects unknown participant keys", () => {
  assert.throws(
    () => parseDebateConfig("participants:\n  - adapter: claude\n    budget: 2\n"),
    /unknown participant key "budget"/,
  );
});

test("rejects a single-participant lineup", () => {
  assert.throws(() => parseDebateConfig("participants:\n  - adapter: claude\n"), /at least 2 participants/);
});

test("rejects unknown adapters", () => {
  assert.throws(
    () => parseDebateConfig("participants:\n  - adapter: cursor\n  - adapter: claude\n"),
    /adapter: claude \| agy \| codex/,
  );
});

test("rejects non-numeric numeric keys and non-integer rounds", () => {
  assert.throws(() => parseDebateConfig("rounds: many\n"), /must be a number/);
  assert.throws(() => parseDebateConfig("rounds: 1.5\n"), /non-negative integer/);
});

test("rejects nested structures it cannot represent", () => {
  assert.throws(() => parseDebateConfig("participants:\n  - adapter: claude\n      deep:\n        nope: 1\n"), /line/);
});
