// Orchestration (Kaizen v0): the debate accumulates into one markdown transcript.
// Phases: proposals (videtur quod) → N reaction rounds (sed contra) → respondeo (the
// judge's verdict) → redactio (the deliverable, only on a RESOLVED verdict). runFinalize
// and runContinuation are exported so the CLI can re-enter a SAVED debate standalone
// (--finalize / --continue). Still missing: the pre-debate consolidatio, a structured
// contribution trailer, and the premise-validation eval — all deferred on purpose
// (docs/4_PLAN.md §11).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Participant, AgentResult } from "./adapters.ts";

const execFileAsync = promisify(execFile);

function log(msg: string) { console.error(`[disputatio] ${msg}`); }

// The phase a turn belongs to. Recorded explicitly so metrics never have to parse it back
// out of the title string (docs/5_METRICS.md §8 step 2).
export type TurnPhase = "proposal" | "reaction" | "respondeo" | "redactio" | "continuation";

// Tier-0 per-turn record. The measurement fields exist because the 2026-08-04 run had to
// be reconstructed by hand from raw captures: nothing recorded how long a turn took, how
// big its prompt was, or whether it gathered any evidence.
export type Turn = {
  title: string;
  participant: string;
  result: AgentResult;
  phase: TurnPhase;
  round?: number;      // reaction turns only, 1-based
  promptBytes: number; // captured at spawn — the prompt is never persisted, so it is unrecoverable later
  agentMs: number;     // the agent call alone
  turnMs: number;      // agentMs + isolation setup/teardown, so overhead stays separable (§3.2)
  canExecute: boolean; // copied from the participant: ranCommands 0 only counts against those who could
};

// What runIsolated measures around a single agent call.
export type IsolatedRun = { result: AgentResult; agentMs: number; turnMs: number; promptBytes: number };

export type RespondeoStatus = "RESOLVED" | "NEEDS_INPUT" | "FAILED";

export type DebateOutcome = {
  transcript: string;       // the full markdown artifact (incl. cost footnotes, failure details)
  turns: Turn[];            // per-turn results, raw CLI captures attached (diagnostics)
  aborted?: string;         // set when the debate could not proceed (e.g. <2 proposals)
  respondeo?: {             // the judge's consolidatio (only when a judge ran)
    status: RespondeoStatus;
    text: string;           // the verdict body — written verbatim to respondeo.md
  };
  finalReport?: {           // the redactio: the deliverable, only when respondeo RESOLVED
    text: string;           // written verbatim to final-report.md
  };
  finalReportError?: {      // set when the redactio ran but failed (debate + verdict still succeeded)
    budgetExhausted: boolean;
    message: string;
  };
};

// Transcript view (for the .md artifact): keeps cost + failure detail.
function render(title: string, r: AgentResult): string {
  if (r.ok) {
    const cost = r.costUsd ? `\n\n_(cost: $${r.costUsd.toFixed(4)})_` : "";
    return `## ${title}\n\n${r.text}${cost}\n`;
  }
  return `## ${title}\n\n> ⚠️ FAILED: ${r.error}\n`;
}

// Prompt-context view (fed back to agents): no cost footnotes, no raw error
// dumps — keep the context agents reason over clean and a little smaller.
function renderForContext(title: string, r: AgentResult): string {
  if (r.ok) return `## ${title}\n\n${r.text}\n`;
  return `## ${title}\n\n> (this participant produced no contribution this turn)\n`;
}

// git worktree add/remove on the same repo can contend on .git locks when run
// concurrently — serialize the git operations (NOT the agent runs).
let gitLock: Promise<unknown> = Promise.resolve();
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = gitLock.then(fn, fn);
  gitLock = p.then(() => {}, () => {});
  return p;
}

// Run a participant in ISOLATION. Isolation is a correctness requirement:
// - Without repoPath: a throwaway temp dir, so agentic CLIs like agy cannot read
//   sibling files — the contamination we caught in research/pre-m0-handrun.md.
// - With repoPath: a DETACHED, THROWAWAY git worktree of HEAD — never the real
//   checkout. Real-run lesson: evidence commands can write local runtime artifacts
//   into the target repo. In a worktree those writes land in the disposable copy
//   and die with it. Trade-off: agents see HEAD only (uncommitted changes are invisible) and
//   untracked build artifacts (node_modules, …) are absent.
//
// Also the measurement bracket (§8 step 1): `agentMs` times the agent call alone while
// `turnMs` spans worktree setup + teardown too, so isolation overhead never hides inside
// model latency. promptBytes is captured here because this is the last place that sees
// the prompt — it is never written to disk.
export async function runIsolated(p: Participant, prompt: string, repoPath?: string): Promise<IsolatedRun> {
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const turnStart = performance.now();
  let agentMs = 0;
  // Time only p.run(), wherever it is called from below.
  const timedRun = async (cwd: string): Promise<AgentResult> => {
    const agentStart = performance.now();
    try { return await p.run(prompt, cwd); }
    finally { agentMs = performance.now() - agentStart; }
  };
  let result: AgentResult;
  const dir = await mkdtemp(join(tmpdir(), "disputatio-"));
  try {
    if (!repoPath) {
      result = await timedRun(dir);
    } else {
      const wt = join(dir, "wt");
      await withGitLock(() => execFileAsync("git", ["-C", repoPath, "worktree", "add", "--detach", wt, "HEAD"]));
      try {
        result = await timedRun(wt);
      } finally {
        await withGitLock(async () => {
          try { await execFileAsync("git", ["-C", repoPath, "worktree", "remove", "--force", wt]); }
          catch { /* dir removal below + git's own prune cover the rest */ }
        });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // Stamped AFTER teardown on purpose — a `return` inside the try would evaluate this
  // before the finally blocks ran, silently excluding the very overhead it exists to show.
  return { result, agentMs, turnMs: performance.now() - turnStart, promptBytes };
}

const proposePrompt = (task: string) =>
  `You are one independent reviewer in a structured debate. The task:\n\n${task}\n\n` +
  `Give your honest, concrete, opinionated proposal/answer. If a repository or files are present in your ` +
  `working directory and relevant, READ them and run READ-ONLY commands (e.g. run the existing tests) to ` +
  `ground your reasoning in real evidence. Respond in English, concise.`;

const reactPrompt = (ctx: string, me: string) =>
  `You are "${me}", one reviewer in a structured debate. The full debate so far:\n\n${ctx}\n\n` +
  `React adversarially: where do you AGREE, where do you DISAGREE (find real, specific flaws), and what is ` +
  `MISSING? State any objection you can back with EXECUTABLE EVIDENCE (run a test, check a file/API in your ` +
  `working directory). Do not repeat what has already been said. Respond in English, concise.`;

// Respondeo: the judge renders the consolidatio over the transcript ALONE (no repo
// access, even in repo mode). It must ASK rather than guess — if a contested point
// cannot be resolved from the transcript, it emits questions for the human instead of
// fabricating a ruling. The mandatory first STATUS line is the machine signal index.ts
// parses to surface NEEDS_INPUT.
const respondeoPrompt = (ctx: string) =>
  `You are the JUDGE (respondeo) closing a structured debate. The full transcript:\n\n${ctx}\n\n` +
  `Render the consolidatio — the resolution. You reason over THIS TRANSCRIPT ALONE; you have no repository ` +
  `access. Rules:\n` +
  `1. Your FIRST line must be exactly one of: "STATUS: RESOLVED" or "STATUS: NEEDS_INPUT" (nothing else on it).\n` +
  `2. Then record the SETTLED AGREEMENTS (what every participant converged on).\n` +
  `3. Then rule on each CONTESTED point, weighing the arguments — prefer positions backed by executable ` +
  `evidence over rhetoric.\n` +
  `4. If — and only if — one or more contested points genuinely CANNOT be resolved from the transcript ` +
  `without human input, use STATUS: NEEDS_INPUT, still record the settled agreements, then add a final ` +
  `"## Quaestiones (for the human)" list of the specific questions, and issue NO ruling on those points. ` +
  `Do not invent a verdict you cannot defend from the transcript.\n` +
  `Respond in English, concise, in Markdown.`;

// Only an explicit STATUS: NEEDS_INPUT on the first non-empty line triggers the human
// path; anything else from a successful turn (RESOLVED or a missing/garbled marker)
// is a verdict. A failed turn is classified FAILED by the caller. Exported because
// --continue / --finalize parse a respondeo loaded back from disk (index.ts).
export function parseRespondeoStatus(text: string): "RESOLVED" | "NEEDS_INPUT" {
  const first = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  return /^STATUS:\s*NEEDS_INPUT\b/i.test(first) ? "NEEDS_INPUT" : "RESOLVED";
}

// Redactio — the SYNTHESIZER authors the actual deliverable the debate existed to
// produce (the plan / review / proposal / outline the user will execute), NOT a
// summary of who-said-what. This is the gap real use surfaced: respondeo.md holds the
// RULING ON the debate, not the work-product born FROM it, so it lacks the data needed
// to start the work. Transcript-only like respondeo: the debate already gathered the
// evidence and it lives in the transcript (repo-grounded redactio is a follow-up).
const finalizePrompt = (quaestio: string, transcript: string, determination: string) =>
  `You are the SYNTHESIZER closing a structured debate. Author the FINAL DELIVERABLE the ` +
  `debate existed to produce — the document a human or agent will use to START THE WORK ` +
  `(implement, review, present, propose). This is the product, NOT minutes of the debate.\n\n` +
  `The original quaestio (it fixes the deliverable's PURPOSE and shape):\n\n${quaestio}\n\n` +
  `The full debate transcript (proposals, reactions, evidence):\n\n${transcript}\n\n` +
  `The respondeo — the judge's determination (what was settled, what was ruled, and why):\n\n${determination}\n\n` +
  `Rules:\n` +
  `1. Infer the deliverable TYPE from the quaestio (implementation plan, code-review report, ` +
  `proposal, presentation outline, …) and produce THAT artifact, in its natural shape.\n` +
  `2. Build it from the SETTLED decisions in the respondeo: adopt what won, drop what was ` +
  `rejected, and fold in the evidence that backed the winning positions.\n` +
  `3. If a repository is present in your working directory, READ it and run READ-ONLY ` +
  `commands to ground the deliverable in the REAL files — prefer concrete, file-accurate ` +
  `steps (real paths, real current shapes) over generic ones. (No repo present = work from ` +
  `the transcript alone.)\n` +
  `4. Make it SELF-CONTAINED: someone reading ONLY this document must have everything needed ` +
  `to begin — restate the context and decisions; never say "as discussed above".\n` +
  `5. Leave the debate's blow-by-blow OUT; keep a rationale only where it is load-bearing for execution.\n` +
  `6. If the respondeo left points unresolved, end with a short "## Open points" section so they ` +
  `are not lost — but do not block the deliverable on them.\n` +
  `Respond in English, in Markdown.`;

// Continuation (--continue): the human has answered the respondeo's open questions.
// Re-invoke the JUDGE ALONE (the cheap path) with the transcript + prior determination
// + the answers. If the answers merely DISAMBIGUATE points the debaters already argued,
// the judge can now rule (RESOLVED). If they open genuinely NEW ground nobody argued,
// the judge must NOT invent a verdict — it returns NEEDS_INPUT again, which is the
// signal that a fresh reaction round is needed (re-debate is the documented follow-up).
const continuePrompt = (quaestio: string, transcript: string, previousDetermination: string, humanAnswers: string) =>
  `You are the JUDGE (respondeo) RESUMING a structured debate you previously could not fully ` +
  `resolve. You reason over the TRANSCRIPT and your PRIOR determination ALONE — no repository ` +
  `access. The human has now answered your open questions.\n\n` +
  `The original quaestio:\n\n${quaestio}\n\n` +
  `The full debate transcript:\n\n${transcript}\n\n` +
  `Your PRIOR determination (it ended in NEEDS_INPUT):\n\n${previousDetermination}\n\n` +
  `The human's answers to your open questions:\n\n${humanAnswers}\n\n` +
  `Rules:\n` +
  `1. Your FIRST line must be exactly one of: "STATUS: RESOLVED" or "STATUS: NEEDS_INPUT".\n` +
  `2. Resolve every point you previously left open, USING the human's answers. Do not re-ask ` +
  `what they have already answered.\n` +
  `3. Carry forward the settled agreements and prior rulings that still hold.\n` +
  `4. ONLY if the answers open a genuinely NEW question the debaters never argued, which you ` +
  `cannot settle from the transcript without inventing a verdict, use STATUS: NEEDS_INPUT, ` +
  `record what is now settled, and list ONLY the new "## Quaestiones (for the human)". ` +
  `Do not fabricate a verdict you cannot defend from the transcript.\n` +
  `Respond in English, concise, in Markdown.`;

// The evidence-validity check (docs/4_PLAN.md §8, §11 P1). Until this existed, a debate
// where nobody ran anything succeeded and looked exactly like a repo-grounded one — the
// gap that made "M1 runs the gate path" an overstatement.
//
// Pure over Turn[], so it is unit-testable with no CLI and no filesystem.
export type EvidenceSummary = {
  turns: number;           // debate turns considered (proposals + reactions only)
  observedTurns: number;   // …of those: succeeded AND the CLI reported counts at all
  executedTurns: number;   // …of the OBSERVED ones, how many actually ran a command
  totalCommands: number;
  totalToolCalls: number;
  ungrounded: string[];    // titles: COULD execute, succeeded, ran nothing — the real finding
  unobservable: string[];  // titles: succeeded, but the CLI reports no counts at all (unknown ≠ zero)
};

// Only proposals and reactions count. The respondeo and continuation are transcript-only
// BY INVARIANT (they must not touch the repo), so flagging them would be noise.
const EVIDENCE_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>(["proposal", "reaction"]);

export function summarizeEvidence(turns: Turn[]): EvidenceSummary {
  const considered = turns.filter((t) => EVIDENCE_PHASES.has(t.phase));
  const s: EvidenceSummary = {
    turns: considered.length,
    observedTurns: 0, executedTurns: 0, totalCommands: 0, totalToolCalls: 0,
    ungrounded: [], unobservable: [],
  };
  for (const t of considered) {
    // A failed turn produced no evidence because it died, not because it skipped the
    // work — counting it as ungrounded would blame the agent for a transport failure.
    if (!t.result.ok) continue;
    const ran = t.result.evidence?.ranCommands;
    s.totalCommands += ran ?? 0;
    s.totalToolCalls += t.result.evidence?.toolCalls ?? 0;
    if (ran === undefined) {
      // Unknown, not zero: this CLI reports nothing (agy is text-only), or is an
      // in-process participant. Never assert absence of evidence from absence of data.
      // Deliberately NOT counted in observedTurns: executedTurns/observedTurns must be a
      // ratio of known values, or the gate reads unknowns as known-zero.
      s.unobservable.push(t.title);
      continue;
    }
    s.observedTurns++;
    if (ran > 0) {
      s.executedTurns++;
    } else if (t.canExecute) {
      // The only real finding: it was permitted to execute, succeeded, and ran nothing.
      s.ungrounded.push(t.title);
    }
    // else: shell-less by invariant (pi, copilot-cli) — 0 is compliance, not a failure.
  }
  return s;
}

// Assemble a Turn from a measured run. One builder so no phase can forget a field.
function toTurn(
  title: string, p: Participant, run: IsolatedRun, phase: TurnPhase, round?: number,
): Turn {
  return {
    title,
    participant: p.id,
    result: run.result,
    phase,
    ...(round !== undefined && { round }),
    promptBytes: run.promptBytes,
    agentMs: run.agentMs,
    turnMs: run.turnMs,
    canExecute: p.canExecute,
  };
}

// The redactio turn: author the deliverable from a RESOLVED determination. UNLIKE the
// respondeo (which is transcript-only by invariant — it must ASK, not guess), the
// synthesizer MAY be repo-grounded: with repoPath it runs in a read-only throwaway
// worktree of HEAD, so the deliverable can cite real files and current shapes. Exported
// so --continue / --finalize can reuse it standalone over a saved debate.
export async function runFinalize(
  judge: Participant, quaestio: string, transcript: string, determination: string, repoPath?: string,
): Promise<Turn> {
  const run = await runIsolated(judge, finalizePrompt(quaestio, transcript, determination), repoPath);
  return toTurn(`Final report — ${judge.display}`, judge, run, "redactio");
}

// The continuation turn: re-judge after the human answered. Transcript-only, like respondeo.
export async function runContinuation(
  judge: Participant, quaestio: string, transcript: string, previousDetermination: string, humanAnswers: string,
): Promise<Turn> {
  const run = await runIsolated(judge, continuePrompt(quaestio, transcript, previousDetermination, humanAnswers));
  return toTurn(`Respondeo (continued) — ${judge.display}`, judge, run, "continuation");
}

export async function runDebate(
  task: string,
  participants: Participant[],
  rounds: number,
  repoPath?: string,
  judge?: Participant,
): Promise<DebateOutcome> {
  const header = `# Disputatio debate\n\n## Task\n\n${task}\n`;
  const fileParts: string[] = [header];
  const ctxParts: string[] = [header];
  const turns: Turn[] = [];

  const record = (title: string, p: Participant, run: IsolatedRun, phase: TurnPhase, round?: number) => {
    turns.push(toTurn(title, p, run, phase, round));
    fileParts.push(render(title, run.result));
    ctxParts.push(renderForContext(title, run.result));
  };

  // Round 1 — independent proposals (parallel; each isolated so they don't peek).
  log(`Round 1 — independent proposals: ${participants.map((p) => p.id).join(", ")}`);
  const proposals = await Promise.all(
    participants.map(async (p) => ({ p, run: await runIsolated(p, proposePrompt(task), repoPath) })),
  );
  for (const { p, run } of proposals) record(`Proposal — ${p.display}`, p, run, "proposal");

  // A debate needs at least two voices. Fewer than 2 successful proposals means
  // the surviving agent would "debate" a monologue — abort loudly instead of
  // producing a plausible-looking but worthless artifact (real-run lesson, 2026-06-11).
  const okProposals = proposals.filter(({ run }) => run.result.ok).length;
  if (okProposals < 2) {
    const failures = proposals
      .filter(({ run }) => !run.result.ok)
      .map(({ p, run }) => `${p.id}: ${(run.result as { error: string }).error}`)
      .join(" | ");
    const aborted = `only ${okProposals}/${participants.length} proposals succeeded — no debate possible. Failures: ${failures}`;
    log(`ABORTED — ${aborted}`);
    fileParts.push(`## Debate aborted\n\n> ⚠️ ${aborted}\n`);
    return { transcript: fileParts.join("\n"), turns, aborted };
  }

  // Reaction rounds — each participant reacts to the full transcript snapshot.
  for (let round = 1; round <= rounds; round++) {
    log(`Round ${round + 1} — reactions`);
    const ctx = ctxParts.join("\n");
    const reactions = await Promise.all(
      participants.map(async (p) => ({ p, run: await runIsolated(p, reactPrompt(ctx, p.display), repoPath) })),
    );
    for (const { p, run } of reactions) record(`Round ${round} reaction — ${p.display}`, p, run, "reaction", round);
  }

  // Respondeo — opt-in judge turn (transcript-only: no repoPath, even in repo mode).
  // A failed judge is non-fatal: it's recorded, but the debate itself still succeeded.
  let respondeo: DebateOutcome["respondeo"];
  let finalReport: DebateOutcome["finalReport"];
  let finalReportError: DebateOutcome["finalReportError"];
  if (judge) {
    const debateCtx = ctxParts.join("\n"); // clean transcript snapshot BEFORE the respondeo turn
    log(`Respondeo — ${judge.display} renders the consolidatio`);
    const run = await runIsolated(judge, respondeoPrompt(debateCtx));
    record(`Respondeo — ${judge.display}`, judge, run, "respondeo");
    const r = run.result;
    respondeo = r.ok
      ? { status: parseRespondeoStatus(r.text), text: r.text }
      : { status: "FAILED", text: `Respondeo turn failed: ${r.error}` };

    // Redactio — author the deliverable, but ONLY when the respondeo actually RESOLVED.
    // On NEEDS_INPUT the deliverable waits for the human (--continue); on FAILED there
    // is nothing to synthesize. The determination is passed separately, so finalize sees
    // the clean debate transcript (not the respondeo turn re-appended). A failed redactio
    // is non-fatal — it's recorded, but the debate + verdict still succeeded.
    if (respondeo.status === "RESOLVED") {
      log(`Redactio — ${judge.display} drafts the final deliverable`);
      // Repo-grounded when the debate ran with --repo: the deliverable cites real files.
      const turn = await runFinalize(judge, task, debateCtx, respondeo.text, repoPath);
      turns.push(turn);
      fileParts.push(render(turn.title, turn.result));
      if (turn.result.ok) {
        finalReport = { text: turn.result.text };
      } else {
        finalReportError = { budgetExhausted: turn.result.budgetExhausted === true, message: turn.result.error };
      }
    }
  }

  return { transcript: fileParts.join("\n"), turns, respondeo, finalReport, finalReportError };
}
