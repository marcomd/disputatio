# Real run 2026-06-12 — I Love Coding v0.9, three-vendor repo-grounded debate

This run pointed Disputatio at a personal repository (the *I Love Coding* game) for
read-only evidence gathering, with a three-vendor lineup at comparable model tiers
(`claude` sonnet + `codex` GPT-5.x + `agy` Gemini 3.1 Pro), 2 reaction rounds. The
*quaestio* asked how to implement the v0.9 local-AI character layer without breaking the
game's seeded-determinism invariant. Task/config:
`examples/implement_I_Love_Coding_mvp_0_9.{md,debate.yaml}`. Transcript kept locally.

## 1. The deadlock — timeout killed only the direct child (FIXED)

The first attempt **hung ~45 minutes at ~0 CPU** with no progress past Round 2 and
nothing written to disk (the transcript is only persisted after `runDebate` returns).

**Root cause.** A Round-2 turn ran past the 10-minute cap. `runCli`'s timeout sent
`SIGTERM` to the **direct child only**. The agent CLI had spawned a worker that survived
and kept the **stdout pipe open**, so Node's `close` event never fired and the turn's
promise never resolved — `Promise.all` waited forever. Diagnosis was by process
forensics: the orchestrator node had 0.27s CPU, **zero** live children, state `S`.
(The `claude`/`codex`/`agy` processes initially visible were the user's unrelated
interactive iTerm sessions — parent chain traced to `iTerm.app`, not the run.)

**Fix (TDD).** A regression test reproducing the exact shape first — a fake CLI that
leaks a grandchild holding the pipe open *and* ignores `SIGTERM` (`FAKE_HANG` in
`test/fakes/*`, asserted in `test/adapters.test.ts` "leaked worker holding the pipe").
Red against the old code (resolved only after ~8s). Then the fix: `runCli` spawns
`detached: true` (child is its own process-group leader) and on timeout signals the
**whole group** via `process.kill(-pid, …)` — `SIGTERM`, escalating to `SIGKILL` after
`KILL_GRACE_MS` (2s). Green at ~2.2s (the misbehaving fake's `trap '' TERM` propagates
`SIG_IGN` to its `sleep` children, so only the uncatchable `SIGKILL` ends it — proving
the escalation path is load-bearing). `detached` also makes `-pid` safe: it targets the
child's group, never the orchestrator's. Re-ran: completed cleanly, 9/9 turns.

**Docs corrected:** the "timeout kills only the direct child (no process-tree kill)"
limitation is removed from `README.md` / `CLAUDE.md` and is now an invariant.

## 2. The debate itself — premise signal (leans positive, N=1)

All three agents **independently** traced the determinism leak to the same chain
(verified here against HEAD): the hook call `_merge_llm_themes` at
`personality_engine.gd:495` writes LLM output into `dev.memory_long` (`:558`);
`drift_traits` (`:251`) reads the dominant theme to mutate `stable_traits` (`:274`); the
serializer persists `memory_long` at `state_serializer.gd:205`. They agreed on the
headline fix (AI layer must be presentation-only). The *headline* decision did **not**
change — matching the pre-M0 "later agents confirm" finding.

> **Caveat on agent-sourced citations.** Two of the agents' line numbers were slightly
> off: Claude cited the write at `:528` (the loop header; the write is `:558`) and the
> serializer at `:204` (`memory_short`; `memory_long` is `:205`). The repo was dirty at
> run time, so agents saw HEAD while the working tree differed. **Lesson: verify
> agent-cited line numbers against HEAD before committing them to a durable doc** — the
> evidence ethos cuts both ways.

The value was concentrated in the **reaction rounds** (not the independent proposals),
all line-cited and verified:

- **A stale test that protects the leak** — `test_valid_llm_summarizer_merges_returned_themes`
  asserts LLM output *becomes* `memory_long`; must be deleted, not inverted (Claude; and
  it caught that Codex's "add a regression test" was the opposite assertion).
- **Worse than "picks themes"** — `_merge_llm_themes` blindly casts unbounded/negative
  numeric fields (`:521–526`), so a buggy model could write `count = -999999` (Codex).
- **Locale poisoning** — the prompt builder runs through `TranslationServer.translate()`
  *in core* (`:783`); a non-English locale feeds garbage to a small English model (Codex,
  sharpened by Gemini).
- **Render-loop DoS** — `personality_panel.gd:24` rebuilds every render; wiring an async
  model call there hammers the local server. Needs `(dev_id, turn)` gating (Gemini).
- **Cross-correction** — Codex+Gemini caught Claude's in-core hook violating `GEMINI.md`
  §3; Claude conceded *and* escalated (the existing hook already violates it). A 3-way
  Godot-threading tangle self-resolved to the correct primitive (`HTTPRequest.timeout`).
  Claude caught Gemini's model size off by ~10× (Phi-3 "<2GB" → ~2.2GB vs 80MB SmolLM2).
- **Agents were wrong too** — Codex invented a nonexistent `memory_version` field; Gemini
  proposed truncation (others correctly rejected) and an incoherent `WorkerThreadPool`+HTTP
  model (later retracted); Claude wrote a `Thread.wait_to_finish()` timeout that doesn't
  exist. The wrong claims were challenged with file refs and largely cancelled out.
- **One disagreement stayed open** (deprecate vs hard-remove `set_llm_summarizer()`) —
  recorded, not forced. No automated `respondeo` in v0; the human synthesized.

## 3. Evidence tier — citations, not failing tests (as predicted)

The `claude` allowlist has no Godot runner, and the HEAD-only worktree lacks `.godot`
import artifacts, so no agent ran the GUT suite. Codex stated this explicitly: *"I did
not run Godot tests because this session is read-only and the repo requires Godot outside
sandbox mode."* Agents **did** run read-only `rg`/`nl`/`sed` (which surfaced the stale
test and stale docs). Net: **medium** tier (precise `file:line`), not `command-output`.
**Follow-up:** an allowlist entry for `godot --headless` (+ shipping `.godot` import
state into the worktree) would unlock the top tier on this repo.

## 4. Cost

~**$0.93** measurable (Claude's 3 turns: $0.3174 + $0.2395 + $0.3717). `codex` and `agy`
report tokens, not dollars, on these accounts — so a total-run budget in the orchestrator
remains the eventual answer (per `4_PLAN.md` §8).
