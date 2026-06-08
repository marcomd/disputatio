// Orchestration (Kaizen v0): a crude round-robin debate that accumulates into one
// markdown transcript. No scholastic protocol / respondeo / eval yet — those are the
// next small steps. This is the smallest thing that reproduces the manual workflow.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Participant, AgentResult } from "./adapters.ts";

function log(msg: string) { console.error(`[disputatio] ${msg}`); }

function render(title: string, r: AgentResult): string {
  if (r.ok) {
    const cost = r.costUsd ? `\n\n_(cost: $${r.costUsd.toFixed(4)})_` : "";
    return `## ${title}\n\n${r.text}${cost}\n`;
  }
  return `## ${title}\n\n> ⚠️ FAILED: ${r.error}\n`;
}

// Run a participant in ISOLATION.
// - With repoPath: cwd = the repo, so the agent can read files and run read-only
//   commands (the executable-evidence moat lives here).
// - Without: a throwaway temp dir, so agentic CLIs like agy cannot read sibling
//   files — the contamination we caught in research/pre-m0-handrun.md (agy read
//   another agent's output before answering).
async function runIsolated(p: Participant, prompt: string, repoPath?: string): Promise<AgentResult> {
  if (repoPath) return p.run(prompt, repoPath);
  const dir = await mkdtemp(join(tmpdir(), "disputatio-"));
  try {
    return await p.run(prompt, dir);
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
): Promise<string> {
  const transcript: string[] = [`# Disputatio debate\n\n## Task\n\n${task}\n`];

  // Round 1 — independent proposals (parallel; each isolated so they don't peek).
  log(`Round 1 — independent proposals: ${participants.map((p) => p.id).join(", ")}`);
  const proposals = await Promise.all(
    participants.map(async (p) => ({ p, r: await runIsolated(p, proposePrompt(task), repoPath) })),
  );
  for (const { p, r } of proposals) transcript.push(render(`Proposal — ${p.display}`, r));

  // Reaction rounds — each participant reacts to the full transcript snapshot.
  for (let round = 1; round <= rounds; round++) {
    log(`Round ${round + 1} — reactions`);
    const ctx = transcript.join("\n");
    const reactions = await Promise.all(
      participants.map(async (p) => ({ p, r: await runIsolated(p, reactPrompt(ctx, p.display), repoPath) })),
    );
    for (const { p, r } of reactions) transcript.push(render(`Round ${round} reaction — ${p.display}`, r));
  }

  return transcript.join("\n");
}
