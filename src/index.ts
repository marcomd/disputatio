// CLI entry (Kaizen v0). Run with: node src/index.ts <task-file.md> [rounds] [repo-path] [--config debate.yaml]

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeAdapter, agyAdapter, codexAdapter, type Participant } from "./adapters.ts";
import { parseDebateConfig, type ParticipantSpec } from "./config.ts";
import { runDebate } from "./debate.ts";
import { runDoctor, allHealthy, formatDiagnoses, CANARY_TIMEOUT_MS } from "./doctor.ts";

const execFileAsync = promisify(execFile);

function usage(exitCode: number): never {
  console.error("usage: disputatio <task-file.md> [rounds] [repo-path] [--config debate.yaml]");
  console.error("       disputatio --doctor [--config debate.yaml]");
  console.error("  task-file  markdown file describing the task/quaestio");
  console.error("  rounds     number of reaction rounds after proposals (default 1)");
  console.error("  repo-path  optional: agents gather read-only evidence in a throwaway");
  console.error("             git worktree of this repo (git repos only; HEAD is what they see)");
  console.error("  --config   debate.yaml selecting participants/models/budgets (see examples/debate.yaml)");
  console.error("             default lineup without config: claude + codex");
  console.error("  --doctor   preflight: canary every participant CLI (runnable + authenticated),");
  console.error("             report status, exit 0 if all healthy. Run this before a real debate.");
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage(args.length === 0 ? 1 : 0);

let configPath: string | undefined;
let doctorMode = false;
const positionals: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") {
    configPath = args[++i];
    if (!configPath) usage(1);
  } else if (args[i] === "--doctor") {
    doctorMode = true;
  } else {
    positionals.push(args[i]);
  }
}

const cfg = configPath ? parseDebateConfig(await readFile(configPath, "utf8")) : {};

// Cross-vendor by design: claude→Anthropic, codex→OpenAI, agy→Google. Diversity is
// the point. Default lineup is claude+codex; optional adapters go through --config.
const specs: ParticipantSpec[] = cfg.participants ?? [{ adapter: "claude" }, { adapter: "codex" }];

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

// --doctor: preflight only — needs the lineup (+ optional --config), nothing else.
// Branch BEFORE the task-file/rounds/repo logic so `--doctor` never gets mistaken
// for a task file. Short canary timeout: a hung preflight is a broken preflight.
if (doctorMode) {
  const participants = specs.map((s) => buildParticipant(s, CANARY_TIMEOUT_MS));
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

const participants = specs.map((s) => buildParticipant(s, timeoutMs));

const vendors = new Set(participants.map((p) => p.vendor));
if (vendors.size < participants.length) {
  console.error("[disputatio] ⚠️ participants are not all cross-vendor — correlated-error risk (docs/2_CONCEPT.md §2)");
}

const outcome = await runDebate(task, participants, rounds, repoPath);

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

console.error(`[disputatio] done`);
console.log(`${dir}/debate.md`); // stdout = the artifact path (agent-native friendly)
