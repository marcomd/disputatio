#!/usr/bin/env node
// CLI entry (Kaizen v0). Two run modes off ONE codebase:
//   - from source:      node src/index.ts <task-file.md> [rounds] [repo-path] [--config debate.yaml]
//   - installed binary: disputatio <task-file.md> ...   (npm install -g disputatio)
// The shebang lets npm's `bin` symlink exec this directly: Node ≥24 type-strips the .ts.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeAdapter, agyAdapter, codexAdapter, type Participant } from "./adapters.ts";
import { parseDebateConfig, type ParticipantSpec, type DebateConfig } from "./config.ts";
import { runDebate } from "./debate.ts";
import { runDoctor, allHealthy, formatDiagnoses, CANARY_TIMEOUT_MS } from "./doctor.ts";
import { resolveConfigText, userConfigPath, runInit } from "./install.ts";

const execFileAsync = promisify(execFile);

function usage(exitCode: number): never {
  console.error("usage: disputatio <task-file.md> [rounds] [repo-path] [--config debate.yaml]");
  console.error("       disputatio --doctor [--config debate.yaml]");
  console.error("       disputatio --init [--config debate.yaml] [--force]");
  console.error("  task-file  markdown file describing the task/quaestio");
  console.error("  rounds     number of reaction rounds after proposals (default 1)");
  console.error("  repo-path  optional: agents gather read-only evidence in a throwaway");
  console.error("             git worktree of this repo (git repos only; HEAD is what they see)");
  console.error("  --config   debate.yaml selecting participants/models/budgets + an optional judge");
  console.error("             (see examples/debate.yaml — a TEMPLATE, never auto-loaded). When omitted,");
  console.error(`             reads ${userConfigPath()} if present, else the built-in lineup: claude + codex, no judge`);
  console.error("  --doctor   preflight: canary every participant CLI (runnable + authenticated),");
  console.error("             report status, exit 0 if all healthy. Run this before a real debate.");
  console.error("  --init     probe the lineup, resolve each CLI's real binary, and write the user");
  console.error(`             config to ${userConfigPath()}. Run after authenticating each CLI. --force overwrites.`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage(args.length === 0 ? 1 : 0);

let configPath: string | undefined;
let doctorMode = false;
let initMode = false;
let force = false;
const positionals: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") {
    configPath = args[++i];
    if (!configPath) usage(1);
  } else if (args[i] === "--doctor") {
    doctorMode = true;
  } else if (args[i] === "--init") {
    initMode = true;
  } else if (args[i] === "--force") {
    force = true;
  } else {
    positionals.push(args[i]);
  }
}

// Cross-vendor by design: claude→Anthropic, codex→OpenAI, agy→Google. Diversity is the
// point. The built-in default lineup is claude+codex (no judge — bare runs stay lean);
// the respondeo judge is reserved for configured runs (e.g. what `--init` writes).
const DEFAULT_SPECS: ParticipantSpec[] = [{ adapter: "claude" }, { adapter: "codex" }];
const DEFAULT_JUDGE: ParticipantSpec = { adapter: "claude", model: "opus", effort: "high", maxBudgetUsd: 2 };

function buildParticipant(s: ParticipantSpec, timeoutMs: number): Participant {
  switch (s.adapter) {
    case "claude": return claudeAdapter(s.model ?? "sonnet", { maxBudgetUsd: s.maxBudgetUsd, timeoutMs, effort: s.effort });
    case "agy":
      // agy has no effort flag — effort is baked into the model name (e.g. "(High)").
      if (s.effort) console.error(`[disputatio] ⚠️ agy ignores "effort" — encode it in the model name (e.g. "Gemini 3.5 Flash (High)")`);
      return agyAdapter(s.model ?? "Gemini 3.5 Flash (High)", { timeoutMs });
    case "codex": return codexAdapter(s.model, { bin: s.bin, timeoutMs, effort: s.effort });
  }
}

// --init: probe the lineup, resolve each CLI's real binary, write the user config.
// Branch BEFORE resolving the runtime config: init REGENERATES the user config, so its
// basis is an explicit --config or the built-in defaults — it must NEVER read (and choke
// on) the existing ~/.config/disputatio/config.yaml. Parsing its own basis here is what
// lets `disputatio --init --force` recover from a user config the user broke by hand.
// With --config the judge carries through; with no config the default opus judge is
// seeded (so a set-up install gets the full scholastic protocol).
if (initMode) {
  const basis: DebateConfig = configPath ? parseDebateConfig(await readFile(configPath, "utf8")) : {};
  const initSpecs = basis.participants ?? DEFAULT_SPECS;
  const initJudge = configPath ? basis.judge : DEFAULT_JUDGE;
  console.error(`[disputatio] init — probing: ${initSpecs.map((s) => s.adapter).join(", ")}`);
  const res = await runInit(initSpecs, initJudge, userConfigPath(), { force, deps: { buildParticipant } });
  console.error(res.report);
  process.exit(res.exitCode);
}

// Config resolution (see install.ts): --config → ~/.config/disputatio/config.yaml →
// built-in lineup. The shipped examples/debate.yaml is a TEMPLATE, never auto-loaded —
// that coupling was the P2 footgun (its host-specific bin: broke other machines).
const { text: cfgText, source: cfgSource } = await resolveConfigText(configPath);
const cfg: DebateConfig = cfgText !== null ? parseDebateConfig(cfgText) : {};

const specs: ParticipantSpec[] = cfg.participants ?? DEFAULT_SPECS;

// --doctor: preflight only — needs the lineup (+ optional --config), nothing else.
// Branch BEFORE the task-file/rounds/repo logic so `--doctor` never gets mistaken
// for a task file. Short canary timeout: a hung preflight is a broken preflight.
// The judge is an agent that must be runnable + authenticated like any other — canary it too.
if (doctorMode) {
  console.error(`[disputatio] config: ${cfgSource}`);
  const participants = specs.map((s) => buildParticipant(s, CANARY_TIMEOUT_MS));
  if (cfg.judge) participants.push(buildParticipant(cfg.judge, CANARY_TIMEOUT_MS));
  console.error(`[disputatio] doctor — canary: ${participants.map((p) => p.id).join(", ")}`);
  const diagnoses = await runDoctor(participants);
  console.error(formatDiagnoses(diagnoses));
  process.exit(allHealthy(diagnoses) ? 0 : 1);
}

const [taskFile, roundsArg, repoArg] = positionals;
if (!taskFile) usage(1);

const task = await readFile(taskFile, "utf8");

const rounds = roundsArg !== undefined ? Number(roundsArg) : cfg.rounds ?? 1;
if (!Number.isInteger(rounds) || rounds < 0) {
  console.error(`[disputatio] rounds must be a non-negative integer, got "${roundsArg}"`);
  process.exit(1);
}
const repoPath = repoArg ?? cfg.repo;
const timeoutMs = (cfg.timeoutMinutes ?? 10) * 60_000;

// READ-ONLY invariant: evidence gathering happens in a throwaway git worktree,
// never in the real checkout — so the repo must be a git repo. Fail fast here.
if (repoPath) {
  try {
    await execFileAsync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
  } catch {
    console.error(`[disputatio] ${repoPath} is not a git repository — evidence mode requires git (agents run in a throwaway worktree)`);
    process.exit(1);
  }
  const { stdout } = await execFileAsync("git", ["-C", repoPath, "status", "--porcelain"]);
  if (stdout.trim() !== "") {
    console.error(`[disputatio] ⚠️ ${repoPath} has uncommitted changes — agents see HEAD only, not your working tree`);
  }
}

console.error(`[disputatio] config: ${cfgSource}`);
const participants = specs.map((s) => buildParticipant(s, timeoutMs));

const vendors = new Set(participants.map((p) => p.vendor));
if (vendors.size < participants.length) {
  console.error("[disputatio] ⚠️ participants are not all cross-vendor — correlated-error risk (docs/2_CONCEPT.md §2)");
}

const judge = cfg.judge ? buildParticipant(cfg.judge, timeoutMs) : undefined;

// Correlated-error guard for the judge. display encodes adapter+model, so an exact
// match means a debater is grading its OWN argument (same vendor AND model) — the loud
// ⚠️. A shared vendor (different model) is a milder shared-training-lineage risk — a note.
if (judge) {
  if (participants.some((p) => p.display === judge.display)) {
    console.error(`[disputatio] ⚠️ judge ${judge.display} is identical to a debater — it would grade its own argument (correlated-error risk; docs/2_CONCEPT.md §2)`);
  } else if (participants.some((p) => p.vendor === judge.vendor)) {
    console.error(`[disputatio] note: judge ${judge.display} shares a vendor with a debater — mild shared-training-lineage risk`);
  }
}

const outcome = await runDebate(task, participants, rounds, repoPath, judge);

const id = `debate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dir = `.debate/${id}`;
await mkdir(`${dir}/raw`, { recursive: true });
await writeFile(`${dir}/debate.md`, outcome.transcript, "utf8");

// Per-turn raw CLI captures: when a turn FAILS, the envelope/stderr here is the
// only way to diagnose it (lesson from debate-2026-06-11: "is_error=true" with
// everything else discarded was undiagnosable).
for (let i = 0; i < outcome.turns.length; i++) {
  const t = outcome.turns[i];
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  await writeFile(`${dir}/raw/${String(i + 1).padStart(2, "0")}-${slug}.json`, JSON.stringify(t, null, 2), "utf8");
}

if (outcome.aborted) {
  console.error(`[disputatio] debate ABORTED: ${outcome.aborted}`);
  console.error(`[disputatio] partial transcript + raw captures kept for diagnosis`);
  console.log(`${dir}/debate.md`); // still expose the artifact path for inspection
  process.exit(1);
}

// Respondeo (consolidatio) artifact, alongside debate.md. NEEDS_INPUT is not an abort:
// the judge did its job by asking instead of guessing — surface it on stderr, exit 0.
if (outcome.respondeo) {
  await writeFile(`${dir}/respondeo.md`, outcome.respondeo.text, "utf8");
  console.error(`[disputatio] respondeo (${outcome.respondeo.status}): ${dir}/respondeo.md`);
  if (outcome.respondeo.status === "NEEDS_INPUT") {
    console.error(`[disputatio] ⚠️ respondeo needs human input — see ${dir}/respondeo.md`);
  }
}

console.error(`[disputatio] done`);
console.log(`${dir}/debate.md`); // stdout = the artifact path (agent-native friendly)
