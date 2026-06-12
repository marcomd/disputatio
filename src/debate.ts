// Orchestration (Kaizen v0): a crude round-robin debate that accumulates into one
// markdown transcript. No scholastic protocol / respondeo / eval yet — those are the
// next small steps. This is the smallest thing that reproduces the manual workflow.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Participant, AgentResult } from "./adapters.ts";

const execFileAsync = promisify(execFile);

function log(msg: string) { console.error(`[disputatio] ${msg}`); }

export type Turn = { title: string; participant: string; result: AgentResult };

export type DebateOutcome = {
  transcript: string;       // the full markdown artifact (incl. cost footnotes, failure details)
  turns: Turn[];            // per-turn results, raw CLI captures attached (diagnostics)
  aborted?: string;         // set when the debate could not proceed (e.g. <2 proposals)
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
async function runIsolated(p: Participant, prompt: string, repoPath?: string): Promise<AgentResult> {
  const dir = await mkdtemp(join(tmpdir(), "disputatio-"));
  try {
    if (!repoPath) return await p.run(prompt, dir);
    const wt = join(dir, "wt");
    await withGitLock(() => execFileAsync("git", ["-C", repoPath, "worktree", "add", "--detach", wt, "HEAD"]));
    try {
      return await p.run(prompt, wt);
    } finally {
      await withGitLock(async () => {
        try { await execFileAsync("git", ["-C", repoPath, "worktree", "remove", "--force", wt]); }
        catch { /* dir removal below + git's own prune cover the rest */ }
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

export async function runDebate(
  task: string,
  participants: Participant[],
  rounds: number,
  repoPath?: string,
): Promise<DebateOutcome> {
  const header = `# Disputatio debate\n\n## Task\n\n${task}\n`;
  const fileParts: string[] = [header];
  const ctxParts: string[] = [header];
  const turns: Turn[] = [];

  const record = (title: string, p: Participant, r: AgentResult) => {
    turns.push({ title, participant: p.id, result: r });
    fileParts.push(render(title, r));
    ctxParts.push(renderForContext(title, r));
  };

  // Round 1 — independent proposals (parallel; each isolated so they don't peek).
  log(`Round 1 — independent proposals: ${participants.map((p) => p.id).join(", ")}`);
  const proposals = await Promise.all(
    participants.map(async (p) => ({ p, r: await runIsolated(p, proposePrompt(task), repoPath) })),
  );
  for (const { p, r } of proposals) record(`Proposal — ${p.display}`, p, r);

  // A debate needs at least two voices. Fewer than 2 successful proposals means
  // the surviving agent would "debate" a monologue — abort loudly instead of
  // producing a plausible-looking but worthless artifact (real-run lesson, 2026-06-11).
  const okProposals = proposals.filter(({ r }) => r.ok).length;
  if (okProposals < 2) {
    const failures = proposals
      .filter(({ r }) => !r.ok)
      .map(({ p, r }) => `${p.id}: ${(r as { error: string }).error}`)
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
      participants.map(async (p) => ({ p, r: await runIsolated(p, reactPrompt(ctx, p.display), repoPath) })),
    );
    for (const { p, r } of reactions) record(`Round ${round} reaction — ${p.display}`, p, r);
  }

  return { transcript: fileParts.join("\n"), turns };
}
