// Orchestration tests — fake in-process participants (no spawning), plus a REAL
// git repo in a temp dir to verify the read-only worktree isolation invariant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDebate, runFinalize, runContinuation, parseRespondeoStatus, summarizeEvidence, finalizeRetryHint } from "../src/debate.ts";
import type { Participant, AgentResult } from "../src/adapters.ts";

const execFileAsync = promisify(execFile);

function fake(id: string, vendor: string, run: Participant["run"], canExecute = true): Participant {
  return { id, vendor, display: id, canExecute, run };
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

test("finalize: budget-exhausted redactio sets finalReportError.budgetExhausted", async () => {
  const budgetFail = (error: string): AgentResult => ({ ok: false, error, budgetExhausted: true });
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const j = fake("opus", "v3", async (prompt) =>
    prompt.includes("FINAL DELIVERABLE") ? budgetFail("Reached maximum budget ($2)") : ok("STATUS: RESOLVED\n\nRuling."),
  );
  const out = await runDebate("task", [a, b], 0, undefined, j);
  assert.equal(out.respondeo?.status, "RESOLVED");
  assert.equal(out.finalReport, undefined);
  assert.equal(out.finalReportError?.budgetExhausted, true);
  assert.match(out.finalReportError?.message ?? "", /Reached maximum budget/);
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

// --- P1: Tier-0 turn instrumentation (docs/5_METRICS.md §8 steps 1-2) ------------------

test("every turn records phase, promptBytes and both timing brackets", async () => {
  const a = fake("a", "v1", async () => ok("proposal A"));
  const b = fake("b", "v2", async () => ok("proposal B"));
  const judge = fake("j", "v3", async () => ok("STATUS: NEEDS_INPUT\n\nunresolved"));
  const out = await runDebate("task", [a, b], 1, undefined, judge);

  assert.equal(out.turns.length, 5); // 2 proposals + 2 reactions + respondeo
  for (const t of out.turns) {
    assert.ok(t.promptBytes > 0, `${t.title} has no promptBytes`);
    assert.ok(typeof t.agentMs === "number" && t.agentMs >= 0, `${t.title} agentMs`);
    assert.ok(typeof t.turnMs === "number" && t.turnMs >= t.agentMs, `${t.title} turnMs < agentMs`);
    assert.equal(typeof t.canExecute, "boolean");
  }
  assert.deepEqual(out.turns.map((t) => t.phase), ["proposal", "proposal", "reaction", "reaction", "respondeo"]);
  // Cross-layer: turns built by the real path must be exempted by the real check too —
  // 5 turns recorded, but the respondeo is transcript-only so only 4 are considered.
  assert.equal(summarizeEvidence(out.turns).turns, 4);
});

test("round is set on reaction turns only, and counts from 1", async () => {
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const out = await runDebate("task", [a, b], 2);

  const proposals = out.turns.filter((t) => t.phase === "proposal");
  const reactions = out.turns.filter((t) => t.phase === "reaction");
  assert.equal(proposals.length, 2);
  assert.equal(reactions.length, 4);
  for (const t of proposals) assert.equal(t.round, undefined);
  assert.deepEqual(reactions.map((t) => t.round), [1, 1, 2, 2]);
});

test("promptBytes grows with the transcript and is measured in BYTES, not characters", async () => {
  // Unrecoverable after the fact (§8 step 2): the prompt is never persisted, so if it is
  // not captured at spawn time it is gone. Multi-byte content must not undercount.
  const a = fake("a", "v1", async () => ok("café ☕ proposal"));
  const b = fake("b", "v2", async () => ok("B"));
  const out = await runDebate("task", [a, b], 1);

  const proposal = out.turns.find((t) => t.phase === "proposal" && t.participant === "a")!;
  const reaction = out.turns.find((t) => t.phase === "reaction" && t.participant === "a")!;
  assert.ok(reaction.promptBytes > proposal.promptBytes, "reaction prompt carries the transcript");
  // "café ☕" is 6 chars but 10 bytes — a char count would understate the real payload.
  assert.ok(reaction.promptBytes > Buffer.byteLength("café ☕ proposal", "utf8"));
});

test("canExecute propagates from the participant onto the turn record", async () => {
  // The whole point of the flag: ranCommands 0 is only a finding when canExecute is true.
  const shell = fake("shell", "v1", async () => ok("A"), true);
  const shellless = fake("shellless", "v2", async () => ok("B"), false);
  const out = await runDebate("task", [shell, shellless], 1);

  for (const t of out.turns.filter((t) => t.participant === "shell")) assert.equal(t.canExecute, true);
  for (const t of out.turns.filter((t) => t.participant === "shellless")) assert.equal(t.canExecute, false);
});

test("a FAILED turn is still instrumented (timings survive the failure path)", async () => {
  // The 2026-08-04 pi turn died silently; its cost in wall-clock was invisible.
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const c = fake("c", "v3", async (prompt) => (prompt.includes("debate so far") ? fail("signal=SIGKILL") : ok("C")));
  const out = await runDebate("task", [a, b, c], 1);

  const failed = out.turns.find((t) => !t.result.ok)!;
  assert.equal(failed.phase, "reaction");
  assert.equal(failed.round, 1);
  assert.ok(failed.promptBytes > 0);
  assert.ok(typeof failed.turnMs === "number");
});

test("redactio and continuation turns carry their own phase", async () => {
  const judge = fake("j", "v3", async () => ok("drafted"));
  const fin = await runFinalize(judge, "q", "transcript", "determination");
  assert.equal(fin.phase, "redactio");
  assert.ok(fin.promptBytes > 0);

  const cont = await runContinuation(judge, "q", "transcript", "prior", "answers");
  assert.equal(cont.phase, "continuation");
  assert.ok(cont.promptBytes > 0);
});

// --- P1: the evidence-validity check (docs/4_PLAN.md §8, §11 P1) -----------------------

test("evidence check: a turn that COULD execute and did not is flagged ungrounded", async () => {
  const turns = [
    { phase: "proposal", title: "P — a", canExecute: true, result: { ok: true, text: "x", evidence: { ranCommands: 4 } } },
    { phase: "proposal", title: "P — b", canExecute: true, result: { ok: true, text: "x", evidence: { ranCommands: 0 } } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.equal(s.totalCommands, 4);
  assert.equal(s.executedTurns, 1);
  assert.deepEqual(s.ungrounded, ["P — b"]);
});

test("evidence check: shell-less participants are NOT flagged for running no commands", async () => {
  // The correction this run forced: pi/copilot cannot execute by invariant, so their
  // ranCommands 0 is compliance. A raw count would score them identically to a turn
  // that could have gathered evidence and chose not to.
  const turns = [
    { phase: "proposal", title: "P — pi", canExecute: false, result: { ok: true, text: "x", evidence: { ranCommands: 0, toolCalls: 24 } } },
    { phase: "proposal", title: "P — copilot", canExecute: false, result: { ok: true, text: "x", evidence: { ranCommands: 0, toolCalls: 7 } } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.deepEqual(s.ungrounded, []);
  assert.equal(s.totalToolCalls, 31);
});

test("evidence check: a CLI that reports nothing is 'unobservable', not 'ungrounded'", async () => {
  // agy is text-only: it CAN execute but emits no stream, so ranCommands is undefined.
  // Unknown must not be reported as known-zero.
  const turns = [
    { phase: "proposal", title: "P — agy", canExecute: true, result: { ok: true, text: "x" } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.deepEqual(s.ungrounded, []);
  assert.deepEqual(s.unobservable, ["P — agy"]);
});

test("evidence check: judge turns are exempt (transcript-only by invariant)", async () => {
  const turns = [
    { phase: "respondeo", title: "R — j", canExecute: true, result: { ok: true, text: "x", evidence: { ranCommands: 0 } } },
    { phase: "continuation", title: "C — j", canExecute: true, result: { ok: true, text: "x", evidence: { ranCommands: 0 } } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.deepEqual(s.ungrounded, []);
  assert.equal(s.turns, 0);
});

test("evidence check: failed turns are not counted as ungrounded (they failed, not skipped)", async () => {
  const turns = [
    { phase: "reaction", title: "X — pi", canExecute: true, result: { ok: false, error: "signal=SIGKILL" } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.deepEqual(s.ungrounded, []);
  assert.deepEqual(s.unobservable, []);
});

test("evidence check: a whole debate with zero execution is reported as ungrounded", async () => {
  // The gate-blocking case from 4_PLAN.md §11: today a zero-execution debate succeeds and
  // is indistinguishable from a repo-grounded one.
  const a = fake("a", "v1", async () => ok("A"), true);
  const b = fake("b", "v2", async () => ok("B"), true);
  const out = await runDebate("task", [a, b], 1);
  const s = summarizeEvidence(out.turns);
  assert.equal(s.executedTurns, 0);
  assert.equal(s.turns, 4);
  assert.equal(s.unobservable.length, 4); // in-process fakes report no evidence at all
});

test("evidence check: unobservable turns stay OUT of the executed/observed ratio", async () => {
  // The denominator must be a ratio of KNOWN values. Folding an unknown in would let a
  // gate read "1/2 ran commands" when the second turn's status was never reported.
  const turns = [
    { phase: "proposal", title: "P — codex", canExecute: true, result: { ok: true, text: "x", evidence: { ranCommands: 3, toolCalls: 3 } } },
    { phase: "proposal", title: "P — agy", canExecute: true, result: { ok: true, text: "x" } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.equal(s.turns, 2);          // considered
  assert.equal(s.observedTurns, 1);  // …but only one reported anything
  assert.equal(s.executedTurns, 1);
  assert.deepEqual(s.unobservable, ["P — agy"]);
  assert.deepEqual(s.ungrounded, []); // agy is unknown, NOT known-zero
});

test("evidence check: an all-unobservable debate has observedTurns 0, not executedTurns 0/N", async () => {
  const turns = [
    { phase: "proposal", title: "P — agy", canExecute: true, result: { ok: true, text: "x" } },
    { phase: "reaction", title: "R — agy", canExecute: true, result: { ok: true, text: "x" } },
  ] as unknown as Parameters<typeof summarizeEvidence>[0];
  const s = summarizeEvidence(turns);
  assert.equal(s.observedTurns, 0);
  assert.equal(s.executedTurns, 0);
  assert.deepEqual(s.ungrounded, []);
  assert.equal(s.unobservable.length, 2);
});

// --- Redactio timeout recovery (2026-08-11) --------------------------------------------

test("the redactio runs on the SYNTHESIZER participant when one is given", async () => {
  // The redactio's input is the whole transcript plus repo traversal and it is the LAST
  // turn, so it earns a longer wall-clock cap than a debater. That means a distinct
  // participant instance, which runDebate must actually use.
  const seen: string[] = [];
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const judge = fake("judge", "v3", async () => ok("STATUS: RESOLVED\n\nruling"));
  const synth = fake("synth", "v3", async () => { seen.push("synth"); return ok("the deliverable"); });

  const out = await runDebate("task", [a, b], 0, undefined, judge, synth);
  assert.equal(out.respondeo?.status, "RESOLVED");
  assert.equal(out.finalReport?.text, "the deliverable");
  assert.deepEqual(seen, ["synth"]);
  assert.equal(out.turns.find((t) => t.phase === "redactio")?.participant, "synth");
  assert.equal(out.turns.find((t) => t.phase === "respondeo")?.participant, "judge");
});

test("the judge doubles as synthesizer when no separate one is given (unchanged default)", async () => {
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const judge = fake("judge", "v3", async (p) =>
    ok(p.includes("determination") || p.includes("deliverable") ? "drafted" : "STATUS: RESOLVED\n\nruling"));
  const out = await runDebate("task", [a, b], 0, undefined, judge);
  assert.equal(out.turns.find((t) => t.phase === "redactio")?.participant, "judge");
});

test("finalizeRetryHint always yields a runnable command, tailored to the failure", () => {
  // The 2026-08-11 run printed "redactio failed: timeout" and NOTHING else, while
  // `--finalize` would have recovered it from the saved RESOLVED respondeo. The recovery
  // existed and was invisible exactly when it was needed.
  const dir = ".debate/debate-x";

  const t = finalizeRetryHint("timeout", dir, "/repo");
  assert.match(t, /--finalize/);
  assert.match(t, /--timeout <minutes>/);   // placeholder when no concrete value is known
  assert.match(t, /--debate \.debate\/debate-x/);
  assert.match(t, /--repo \/repo/);

  const b = finalizeRetryHint("budget", dir);
  assert.match(b, /--budget <usd>/);
  assert.doesNotMatch(b, /--repo/); // no repo in the original run → none in the hint

  const o = finalizeRetryHint("other", dir);
  assert.match(o, /--finalize/);
  assert.doesNotMatch(o, /--budget/);
  assert.doesNotMatch(o, /--timeout/);
});

test("a timed-out redactio records kind 'timeout' and keeps the cost it already spent", async () => {
  // The 2026-08-11 shape end-to-end: RESOLVED verdict on disk, deliverable turn dies. The
  // debate itself still succeeded, so this must be non-fatal AND must carry enough for the
  // CLI to print the right recovery flag.
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const judge = fake("judge", "v3", async () => ok("STATUS: RESOLVED\n\nruling"));
  const synth = fake("synth", "v3", async () => ({ ok: false, error: "timeout", costUsd: 3.26 }));

  const out = await runDebate("task", [a, b], 0, undefined, judge, synth);
  assert.equal(out.respondeo?.status, "RESOLVED");   // the verdict survives
  assert.equal(out.finalReport, undefined);
  assert.equal(out.finalReportError?.kind, "timeout");
  assert.equal(out.finalReportError?.budgetExhausted, false);
  assert.equal(finalizeRetryHint(out.finalReportError!.kind, ".debate/d"), "disputatio --finalize --timeout <minutes> --debate .debate/d");
  // …and the spend on the dead turn is visible in the transcript, not silently dropped.
  assert.match(out.transcript, /FAILED: timeout _\(spent before failing: \$3\.2600\)_/);
});

test("a budget-exhausted redactio still records kind 'budget'", async () => {
  const a = fake("a", "v1", async () => ok("A"));
  const b = fake("b", "v2", async () => ok("B"));
  const judge = fake("judge", "v3", async () => ok("STATUS: RESOLVED\n\nruling"));
  const synth = fake("synth", "v3", async () => ({ ok: false, error: "Reached maximum budget", budgetExhausted: true as const }));

  const out = await runDebate("task", [a, b], 0, undefined, judge, synth);
  assert.equal(out.finalReportError?.kind, "budget");
  assert.equal(out.finalReportError?.budgetExhausted, true);
});

test("finalizeRetryHint suggests a CONCRETE value when the caller knows the failed cap", () => {
  // "--timeout <minutes>" makes the user guess. The CLI knows which cap just failed, so
  // the hint should be copy-pasteable rather than a template.
  assert.equal(
    finalizeRetryHint("timeout", ".debate/d", undefined, 20),
    "disputatio --finalize --timeout 20 --debate .debate/d",
  );
  assert.equal(
    finalizeRetryHint("budget", ".debate/d", "/repo", 10),
    "disputatio --finalize --budget 10 --debate .debate/d --repo /repo",
  );
  // A suggestion is meaningless for an unclassified failure — plain retry, no noise.
  assert.equal(finalizeRetryHint("other", ".debate/d", undefined, 20), "disputatio --finalize --debate .debate/d");
});
