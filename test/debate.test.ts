// Orchestration tests — fake in-process participants (no spawning), plus a REAL
// git repo in a temp dir to verify the read-only worktree isolation invariant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDebate, runFinalize, runContinuation, parseRespondeoStatus } from "../src/debate.ts";
import type { Participant, AgentResult } from "../src/adapters.ts";

const execFileAsync = promisify(execFile);

function fake(id: string, vendor: string, run: Participant["run"]): Participant {
  return { id, vendor, display: id, run };
}
const ok = (text: string): AgentResult => ({ ok: true, text, costUsd: 0.5 });
const fail = (error: string): AgentResult => ({ ok: false, error });

test("abort: <2 successful proposals ends the debate before any reaction round", async () => {
  let reactions = 0;
  const a = fake("a", "v1", async (prompt) => {
    if (prompt.includes("debate so far")) reactions++;
    return ok("proposal A");
  });
  const b = fake("b", "v2", async () => fail("timeout"));
  const out = await runDebate("task", [a, b], 3);
  assert.ok(out.aborted);
  assert.match(out.aborted!, /only 1\/2 proposals succeeded/);
  assert.match(out.transcript, /Debate aborted/);
  assert.equal(reactions, 0);
});

test("abort: both proposals failing lists both failures", async () => {
  const a = fake("a", "v1", async () => fail("budget"));
  const b = fake("b", "v2", async () => fail("timeout"));
  const out = await runDebate("task", [a, b], 1);
  assert.ok(out.aborted);
  assert.match(out.aborted!, /a: budget/);
  assert.match(out.aborted!, /b: timeout/);
});

test("reaction context is clean: proposals included, cost footnotes excluded", async () => {
  const seen: string[] = [];
  const a = fake("a", "v1", async (prompt) => {
    if (prompt.includes("debate so far")) seen.push(prompt);
    return ok("proposal A says X");
  });
  const b = fake("b", "v2", async () => ok("proposal B says Y"));
  const out = await runDebate("task", [a, b], 1);
  assert.equal(out.aborted, undefined);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /proposal A says X/);
  assert.match(seen[0], /proposal B says Y/);
  assert.doesNotMatch(seen[0], /cost:/);              // prompt hygiene
  assert.match(out.transcript, /cost: \$0\.5000/);    // …but the artifact keeps cost
  assert.equal(out.turns.length, 4);                  // 2 proposals + 2 reactions
});

test("respondeo: the judge runs after reactions and reads proposals + reactions", async () => {
  let judgePrompt = "";
  const a = fake("a", "v1", async () => ok("proposal A says X"));
  const b = fake("b", "v2", async () => ok("proposal B says Y"));
  const j = fake("opus", "v3", async (prompt) => {
    if (prompt.includes("You are the JUDGE")) judgePrompt = prompt; // capture the respondeo call, not the redactio
    return ok("STATUS: RESOLVED\n\nThe verdict.");
  });
  const out = await runDebate("task", [a, b], 1, undefined, j);
  assert.equal(out.aborted, undefined);
  // judge saw both proposals and the round-1 reactions
  assert.match(judgePrompt, /proposal A says X/);
  assert.match(judgePrompt, /Round 1 reaction/);
  assert.doesNotMatch(judgePrompt, /cost:/); // clean context, like reactions
  // recorded as a Respondeo turn in both turns[] and the transcript
  assert.match(out.transcript, /## Respondeo — opus/);
  assert.ok(out.turns.some((t) => t.title === "Respondeo — opus"));
  assert.equal(out.respondeo?.status, "RESOLVED");
  // …and a RESOLVED respondeo is now followed by the redactio (final deliverable)
  assert.equal(out.turns.at(-1)?.title, "Final report — opus");
  assert.ok(out.finalReport);
});

test("finalize: a RESOLVED respondeo triggers a final-report deliverable turn", async () => {
  let redactioPrompt = "";
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async (prompt) => {
    if (prompt.includes("FINAL DELIVERABLE")) {
      redactioPrompt = prompt;
      return ok("# The Plan\n\nStep 1: do the thing.");
    }
    return ok("STATUS: RESOLVED\n\nRuling: X wins.");
  });
  const out = await runDebate("Build a thing", [a, b], 0, undefined, j);
  assert.equal(out.respondeo?.status, "RESOLVED");
  assert.ok(out.finalReport, "finalReport present on RESOLVED");
  assert.match(out.finalReport!.text, /The Plan/);
  // the synthesizer saw the quaestio, the transcript, and the determination
  assert.match(redactioPrompt, /Build a thing/);
  assert.match(redactioPrompt, /proposal A/);
  assert.match(redactioPrompt, /Ruling: X wins/);
  // recorded as the final turn + in the transcript artifact
  assert.equal(out.turns.at(-1)?.title, "Final report — opus");
  assert.match(out.transcript, /## Final report — opus/);
});

test("finalize: NEEDS_INPUT does not produce a final report (the deliverable waits for the human)", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async () => ok("STATUS: NEEDS_INPUT\n\n## Quaestiones (for the human)\n- ?"));
  const out = await runDebate("task", [a, b], 0, undefined, j);
  assert.equal(out.finalReport, undefined);
  assert.doesNotMatch(out.transcript, /Final report/);
});

test("finalize: no judge means no final report", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const out = await runDebate("task", [a, b], 0); // no judge
  assert.equal(out.finalReport, undefined);
});

test("finalize: a failing redactio is non-fatal (debate + respondeo still succeeded)", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async (prompt) =>
    prompt.includes("FINAL DELIVERABLE") ? fail("budget") : ok("STATUS: RESOLVED\n\nRuling."),
  );
  const out = await runDebate("task", [a, b], 0, undefined, j);
  assert.equal(out.respondeo?.status, "RESOLVED");
  assert.equal(out.finalReport, undefined);                 // no deliverable captured
  assert.match(out.transcript, /## Final report — opus/);   // …but the failed turn is recorded
});

test("continuation: re-invokes the judge with the quaestio, transcript, prior determination, and human answers", async () => {
  let p = "";
  const j = fake("opus", "v3", async (prompt) => {
    p = prompt;
    return ok("STATUS: RESOLVED\n\nNow resolved with your answer.");
  });
  const turn = await runContinuation(j, "the quaestio", "TRANSCRIPT BODY", "PRIOR DETERMINATION", "the human answer");
  assert.match(p, /the quaestio/);
  assert.match(p, /TRANSCRIPT BODY/);
  assert.match(p, /PRIOR DETERMINATION/);
  assert.match(p, /the human answer/);
  assert.equal(turn.title, "Respondeo (continued) — opus");
  assert.ok(turn.result.ok);
  assert.equal(parseRespondeoStatus((turn.result as { text: string }).text), "RESOLVED");
});

test("continuation: degrades to NEEDS_INPUT when the answer opens ground the debaters never argued", async () => {
  const j = fake("opus", "v3", async () => ok("STATUS: NEEDS_INPUT\n\n## Quaestiones (for the human)\n- a new one"));
  const turn = await runContinuation(j, "q", "t", "prior", "answer that opens new ground");
  assert.ok(turn.result.ok);
  assert.equal(parseRespondeoStatus((turn.result as { text: string }).text), "NEEDS_INPUT");
});

test("respondeo: no judge turn when the judge arg is absent", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const out = await runDebate("task", [a, b], 1); // no judge
  assert.equal(out.respondeo, undefined);
  assert.equal(out.turns.length, 4); // 2 proposals + 2 reactions, no respondeo
  assert.doesNotMatch(out.transcript, /Respondeo/);
});

test("respondeo: STATUS: NEEDS_INPUT surfaces on the outcome", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async () => ok("STATUS: NEEDS_INPUT\n\n## Quaestiones (for the human)\n- ?"));
  const out = await runDebate("task", [a, b], 0, undefined, j);
  assert.equal(out.respondeo?.status, "NEEDS_INPUT");
});

test("respondeo: a failing judge is non-fatal", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async () => fail("budget"));
  const out = await runDebate("task", [a, b], 0, undefined, j);
  assert.equal(out.aborted, undefined);          // debate still succeeded
  assert.equal(out.respondeo?.status, "FAILED");
  assert.match(out.transcript, /Respondeo — opus/); // failure still recorded
});

test("redactio: with a repo, the synthesizer is grounded in a throwaway worktree, never the real checkout", async () => {
  const repo = await mkdtemp(join(tmpdir(), "disputatio-test-repo-"));
  const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
  await git("init", "-q");
  await git("config", "user.email", "test@test");
  await git("config", "user.name", "test");
  await writeFile(join(repo, "real.txt"), "real repo file");
  await git("add", ".");
  await git("commit", "-q", "-m", "init");

  const cwds: string[] = [];
  const j = fake("opus", "v3", async (_prompt, cwd) => {
    cwds.push(cwd);
    const seen = await readFile(join(cwd, "real.txt"), "utf8"); // grounded: real files ARE visible
    return ok(`# Plan grounded in ${seen}`);
  });

  const turn = await runFinalize(j, "q", "transcript", "determination", repo);
  assert.ok(turn.result.ok);
  assert.match((turn.result as { text: string }).text, /real repo file/);
  for (const cwd of cwds) assert.notEqual(cwd, repo);          // never the real checkout
  const status = await git("status", "--porcelain");
  assert.equal(status.stdout.trim(), "");                      // redactio didn't touch the repo
  const wt = await git("worktree", "list");
  assert.equal(wt.stdout.trim().split("\n").length, 1);        // worktree cleaned up

  await rm(repo, { recursive: true, force: true });
});

test("worktree isolation: agents run in a throwaway worktree, never the real checkout", async () => {
  // a real git repo with one committed file
  const repo = await mkdtemp(join(tmpdir(), "disputatio-test-repo-"));
  const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
  await git("init", "-q");
  await git("config", "user.email", "test@test");
  await git("config", "user.name", "test");
  await writeFile(join(repo, "evidence.txt"), "committed evidence");
  await git("add", ".");
  await git("commit", "-q", "-m", "init");

  const cwds: string[] = [];
  const misbehave = fake("m", "v1", async (_prompt, cwd) => {
    cwds.push(cwd);
    const evidence = await readFile(join(cwd, "evidence.txt"), "utf8"); // tracked files ARE visible
    await writeFile(join(cwd, "stray-write.log"), "agent wrote here");  // simulated misbehavior
    return ok(evidence);
  });
  const second = fake("s", "v2", async (_prompt, cwd) => {
    cwds.push(cwd);
    return ok("fine");
  });

  const out = await runDebate("task", [misbehave, second], 0, repo);
  assert.equal(out.aborted, undefined);
  assert.match(out.transcript, /committed evidence/);

  for (const cwd of cwds) assert.notEqual(cwd, repo);              // never the real checkout
  const status = await git("status", "--porcelain");
  assert.equal(status.stdout.trim(), "");                          // stray write didn't touch the repo
  const wt = await git("worktree", "list");
  assert.equal(wt.stdout.trim().split("\n").length, 1);            // all worktrees cleaned up

  await rm(repo, { recursive: true, force: true });
});
