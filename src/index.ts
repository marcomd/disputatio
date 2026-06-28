#!/usr/bin/env node
// CLI entry (Kaizen v0). Two run modes off ONE codebase:
//   - from source:      node src/index.ts "<quaestio>" [--rounds N] [--repo path] [--config debate.yaml]
//   - installed binary: disputatio "<quaestio>" ...   (npm install -g disputatio)
// The quaestio is given inline by default; --file <path> reads it from a markdown file.
// rounds/repo are named flags (--rounds/--repo), so the quaestio is the only positional.
// The shebang lets npm's `bin` symlink exec this directly: Node ≥24 type-strips the .ts.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { claudeAdapter, agyAdapter, codexAdapter, type Participant } from "./adapters.ts";
import { parseDebateConfig, type ParticipantSpec, type DebateConfig } from "./config.ts";
import { runDebate, runFinalize, runContinuation, parseRespondeoStatus } from "./debate.ts";
import { runDoctor, allHealthy, formatDiagnoses, CANARY_TIMEOUT_MS } from "./doctor.ts";
import { resolveConfigText, userConfigPath, runInit } from "./install.ts";
import { resolveQuaestioInput } from "./quaestio.ts";

const execFileAsync = promisify(execFile);

function usage(exitCode: number): never {
  console.error('usage: disputatio "<quaestio>" [--rounds N] [--repo path] [--config debate.yaml]');
  console.error("       disputatio --file <task-file.md> [--rounds N] [--repo path] [--config debate.yaml]");
  console.error('       disputatio --continue "<answers>" [--debate <dir>] [--config debate.yaml]');
  console.error("       disputatio --finalize [--debate <dir>] [--config debate.yaml]");
  console.error("       disputatio --doctor [--config debate.yaml]");
  console.error("       disputatio --init [--config debate.yaml] [--force]");
  console.error("  quaestio   the question/task to debate, given inline as a string (quote it)");
  console.error("  --file,-f  read the quaestio from a markdown file instead (for long descriptions)");
  console.error('  --continue close the loop after a NEEDS_INPUT respondeo: re-judge the latest debate');
  console.error("             with your answers (a string), then draft the deliverable if RESOLVED");
  console.error("  --finalize (re)draft the final-report.md deliverable from a RESOLVED debate");
  console.error("  --debate   target a specific .debate/<dir> for --continue/--finalize (default: latest)");
  console.error("  --rounds   number of reaction rounds after proposals (default 1)");
  console.error("  --repo     optional: agents gather read-only evidence in a throwaway git");
  console.error("             worktree of this repo (git repos only; HEAD is what they see)");
  console.error("  --budget   override the judge/synthesizer per-turn budget cap in USD (default: $5);");
  console.error("             use when the redactio fails with 'Reached maximum budget'");
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
let filePath: string | undefined;
let roundsArg: string | undefined;
let repoArg: string | undefined;
let continueArg: string | undefined;
let debateArg: string | undefined;
let budgetArg: string | undefined;
let finalizeMode = false;
let doctorMode = false;
let initMode = false;
let force = false;
const positionals: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config") {
    configPath = args[++i];
    if (!configPath) usage(1);
  } else if (args[i] === "--file" || args[i] === "-f") {
    filePath = args[++i];
    if (!filePath) usage(1);
  } else if (args[i] === "--rounds") {
    roundsArg = args[++i];
    if (roundsArg === undefined) usage(1);
  } else if (args[i] === "--repo") {
    repoArg = args[++i];
    if (!repoArg) usage(1);
  } else if (args[i] === "--continue") {
    continueArg = args[++i];
    if (continueArg === undefined) usage(1);
  } else if (args[i] === "--debate") {
    debateArg = args[++i];
    if (!debateArg) usage(1);
  } else if (args[i] === "--finalize") {
    finalizeMode = true;
  } else if (args[i] === "--budget") {
    budgetArg = args[++i];
    if (!budgetArg || isNaN(Number(budgetArg)) || Number(budgetArg) <= 0) usage(1);
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
const DEFAULT_JUDGE: ParticipantSpec = { adapter: "claude", model: "opus", effort: "high", maxBudgetUsd: 5 };

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

// --budget overrides maxBudgetUsd on judge/synthesizer turns only (claude-only flag).
// Precedence: --budget > config maxBudgetUsd > default $2. Debater budgets are config-only.
function withBudget(spec: ParticipantSpec): ParticipantSpec {
  return budgetArg !== undefined ? { ...spec, maxBudgetUsd: Number(budgetArg) } : spec;
}

// --- --continue / --finalize helpers: read an existing debate back off disk ----------
// Respondeo files are versioned: respondeo.md (the first determination, = #1), then
// respondeo-2.md, respondeo-3.md, … one per --continue. The highest number is current.
function respondeoNum(name: string): number {
  const m = name.match(/^respondeo(?:-(\d+))?\.md$/);
  return m ? (m[1] ? Number(m[1]) : 1) : -1;
}

// Default the debate target to the most RECENT .debate/debate-* (ids are ISO
// timestamps, so a lexicographic sort is chronological). Explicit --debate wins.
async function resolveDebateDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const entries = await readdir(".debate", { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("debate-")).map((e) => e.name).sort();
  if (dirs.length === 0) {
    console.error("[disputatio] no .debate/debate-* directory found — run a debate first");
    process.exit(1);
  }
  return `.debate/${dirs.at(-1)}`;
}

async function loadLatestRespondeo(dir: string): Promise<{ num: number; text: string }> {
  const names = (await readdir(dir).catch(() => [])).filter((n) => respondeoNum(n) > 0);
  if (names.length === 0) {
    console.error(`[disputatio] no respondeo found in ${dir} — was this debate run with a judge?`);
    process.exit(1);
  }
  const latest = names.sort((a, b) => respondeoNum(a) - respondeoNum(b)).at(-1)!;
  return { num: respondeoNum(latest), text: await readFile(`${dir}/${latest}`, "utf8") };
}

// Recover the quaestio from a saved transcript. debate.ts writes the header as
// `## Task\n\n<task>` and then appends the proposals, so the quaestio runs up to the
// FIRST `## Proposal — `. We can't stop at the next `## ` — the task itself routinely
// contains `## CONTEXT` / `## TODO` subsections (that truncated it to the title alone).
function extractTask(debateMd: string): string {
  const m = debateMd.match(/## Task\n\n([\s\S]*?)\n## Proposal — /);
  return m ? m[1].trim() : "(quaestio not found in transcript)";
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
const timeoutMs = (cfg.timeoutMinutes ?? 10) * 60_000;

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

// --continue / --finalize close the human-in-the-loop: they re-enter an EXISTING debate
// on disk (no new debate runs). Both need the judge/synthesizer — fall back to the
// built-in opus judge when the config has none (the default lineup is judge-less, but
// closing the loop is intrinsically a judge act). Branch BEFORE quaestio resolution:
// the quaestio is recovered from the saved transcript, not the CLI.
if (continueArg !== undefined || finalizeMode) {
  const dir = await resolveDebateDir(debateArg);
  const { num, text: prevDetermination } = await loadLatestRespondeo(dir);
  const transcript = await readFile(`${dir}/debate.md`, "utf8");
  const quaestio = extractTask(transcript);
  const judge = buildParticipant(withBudget(cfg.judge ?? DEFAULT_JUDGE), timeoutMs);
  console.error(`[disputatio] config: ${cfgSource}`);

  // --repo grounds ONLY the redactio (the deliverable), in a read-only worktree of HEAD.
  // The re-judge stays transcript-only (respondeo invariant: it trusts the human's answers,
  // it does not re-litigate against the repo). So --repo is meaningful here only because a
  // RESOLVED continuation, and every --finalize, ends in a redactio. Validate it's git.
  const finalizeRepo = repoArg ?? cfg.repo;
  if (finalizeRepo) {
    try {
      await execFileAsync("git", ["-C", finalizeRepo, "rev-parse", "--is-inside-work-tree"]);
    } catch {
      console.error(`[disputatio] ${finalizeRepo} is not a git repository — redactio evidence mode requires git (read-only worktree of HEAD)`);
      process.exit(1);
    }
    console.error(`[disputatio] redactio will ground the deliverable in ${finalizeRepo} (read-only worktree of HEAD)`);
  }

  // --finalize: (re)draft the deliverable from a determination that ALREADY resolved.
  // Refuse on NEEDS_INPUT — there is no settled verdict to synthesize yet; --continue first.
  if (finalizeMode) {
    if (parseRespondeoStatus(prevDetermination) === "NEEDS_INPUT") {
      console.error(`[disputatio] respondeo #${num} in ${dir} still needs input — run --continue "<answers>" first`);
      process.exit(1);
    }
    console.error(`[disputatio] finalize — drafting deliverable for ${dir} with ${judge.display}`);
    const fin = await runFinalize(judge, quaestio, transcript, prevDetermination, finalizeRepo);
    await writeFile(`${dir}/raw/finalize-respondeo.json`, JSON.stringify(fin, null, 2), "utf8");
    if (!fin.result.ok) {
      const hint = fin.result.budgetExhausted
        ? `\n[disputatio]    retry: disputatio --finalize --budget <usd> --debate ${dir}${finalizeRepo ? ` --repo ${finalizeRepo}` : ""}`
        : "";
      console.error(`[disputatio] finalize FAILED: ${fin.result.error}${hint}`);
      process.exit(1);
    }
    await writeFile(`${dir}/final-report.md`, fin.result.text, "utf8");
    console.error(`[disputatio] final report: ${dir}/final-report.md`);
    console.log(`${dir}/final-report.md`);
    process.exit(0);
  }

  // --continue: the human answered the open questions → re-judge (judge-only path).
  console.error(`[disputatio] continue — re-judging ${dir} (from respondeo #${num}) with ${judge.display}`);
  const turn = await runContinuation(judge, quaestio, transcript, prevDetermination, continueArg!);
  const nextNum = num + 1;
  await writeFile(`${dir}/raw/continue-${nextNum}-input.txt`, continueArg!, "utf8");
  await writeFile(`${dir}/raw/continue-${nextNum}-respondeo.json`, JSON.stringify(turn, null, 2), "utf8");
  if (!turn.result.ok) {
    console.error(`[disputatio] continuation FAILED: ${turn.result.error}`);
    process.exit(1);
  }
  const status = parseRespondeoStatus(turn.result.text);
  const respPath = `${dir}/respondeo-${nextNum}.md`;
  await writeFile(respPath, turn.result.text, "utf8");
  console.error(`[disputatio] respondeo (${status}): ${respPath}`);

  if (status === "NEEDS_INPUT") {
    // The answer opened ground the debaters never argued — the judge refused to invent a
    // verdict. Answer again with --continue, or re-run the debate to re-engage the debaters.
    console.error(`[disputatio] ⚠️ still needs input — your answer opened a point the debaters never argued; answer again with --continue, or re-run the debate to re-engage them`);
    console.log(respPath);
    process.exit(0);
  }

  // RESOLVED → author the deliverable (final-report.md is overwritten: it is the CURRENT deliverable).
  const fin = await runFinalize(judge, quaestio, transcript, turn.result.text, finalizeRepo);
  await writeFile(`${dir}/raw/continue-${nextNum}-final-report.json`, JSON.stringify(fin, null, 2), "utf8");
  if (fin.result.ok) {
    await writeFile(`${dir}/final-report.md`, fin.result.text, "utf8");
    console.error(`[disputatio] final report: ${dir}/final-report.md`);
    console.log(`${dir}/final-report.md`);
  } else {
    const hint = fin.result.budgetExhausted
      ? `\n[disputatio]    retry: disputatio --finalize --budget <usd> --debate ${dir}${finalizeRepo ? ` --repo ${finalizeRepo}` : ""}`
      : "";
    console.error(`[disputatio] ⚠️ finalize failed: ${fin.result.error}${hint}`);
    console.log(respPath);
  }
  process.exit(0);
}

// Quaestio: inline by default (the sole positional), or read from --file <path>.
const input = resolveQuaestioInput(filePath, positionals);
if (!input.ok) {
  console.error(`[disputatio] ${input.error}`);
  usage(1);
}
let task: string;
if (input.source === "file") {
  task = await readFile(input.path, "utf8");
  console.error(`[disputatio] quaestio: ${input.path}`);
} else {
  task = input.text;
  console.error(`[disputatio] quaestio: inline (${input.text.length} chars)`);
}

const rounds = roundsArg !== undefined ? Number(roundsArg) : cfg.rounds ?? 1;
if (!Number.isInteger(rounds) || rounds < 0) {
  console.error(`[disputatio] rounds must be a non-negative integer, got "${roundsArg}"`);
  process.exit(1);
}
const repoPath = repoArg ?? cfg.repo;

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

const judge = cfg.judge ? buildParticipant(withBudget(cfg.judge), timeoutMs) : undefined;

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
    console.error(`[disputatio]    answer it to close the loop: disputatio --continue "<answers>"`);
  }
}

// Redactio (the deliverable) artifact, only when the respondeo RESOLVED. This is what
// you actually start the work from — distinct from respondeo.md, which rules ON the debate.
if (outcome.finalReport) {
  await writeFile(`${dir}/final-report.md`, outcome.finalReport.text, "utf8");
  console.error(`[disputatio] final report: ${dir}/final-report.md`);
} else if (outcome.finalReportError) {
  const hint = outcome.finalReportError.budgetExhausted
    ? `\n[disputatio]    retry: disputatio --finalize --budget <usd> --debate ${dir}${repoPath ? ` --repo ${repoPath}` : ""}`
    : "";
  console.error(`[disputatio] ⚠️ redactio failed: ${outcome.finalReportError.message}${hint}`);
}

console.error(`[disputatio] done`);
// stdout = the PRIMARY artifact (agent-native friendly). When a deliverable was produced
// it IS the actionable artifact, so point downstream consumers at it; otherwise the
// transcript is all there is.
console.log(outcome.finalReport ? `${dir}/final-report.md` : `${dir}/debate.md`);
