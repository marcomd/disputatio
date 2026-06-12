// Config parser tests — the minimal YAML subset behind --config debate.yaml.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDebateConfig } from "../src/config.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("parses the shipped example config", async () => {
  const text = await readFile(join(here, "..", "examples", "debate.yaml"), "utf8");
  const cfg = parseDebateConfig(text);
  assert.equal(cfg.rounds, 1);
  assert.equal(cfg.timeoutMinutes, 10);
  assert.equal(cfg.repo, undefined); // commented out
  assert.equal(cfg.participants?.length, 2);
  assert.deepEqual(cfg.participants?.[0], { adapter: "claude", model: "sonnet", maxBudgetUsd: 2 });
  assert.equal(cfg.participants?.[1].adapter, "codex");
  assert.equal(cfg.participants?.[1].bin, "/opt/homebrew/bin/codex");
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
