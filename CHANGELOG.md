# Changelog

All notable changes to Disputatio are documented here.

## [0.0.5] — Process-group kill + first three-vendor repo-grounded run

- **Process-group kill on timeout** (`src/adapters.ts`) — `runCli` now spawns
  `detached: true` and, on timeout, signals the child's whole process group
  (`SIGTERM`, then `SIGKILL` after `KILL_GRACE_MS`). Fixes a real deadlock from the
  2026-06-12 I Love Coding run: a turn overran its cap, `SIGTERM` hit only the direct
  child, and a leaked worker held the stdout pipe open — so `close` never fired and the
  whole debate hung ~45 min at ~0 CPU. Regression test in `test/adapters.test.ts`
  ("leaked worker holding the pipe") reproduces the hang via a `FAKE_HANG` shim that
  ignores `SIGTERM` and leaks a pipe-holding grandchild. See
  `research/real-run-2026-06-12-ilovecoding-v0.9.md`.
- **First three-vendor repo-grounded debate** —
  `examples/implement_I_Love_Coding_mvp_0_9.{md,debate.yaml}` (claude + codex + agy at
  comparable tiers) run against a real game repo; lessons recorded in `research/`.
- **Confidentiality convention** (`.gitignore`, `CLAUDE.md`) — Disputatio is a public
  repo run against arbitrary projects, so `research/private_*` is now gitignored
  (mirroring `examples/private*`) and `CLAUDE.md` records the rule: always scrub
  research notes for project-confidential material before committing.

## [0.0.4] — `doctor` preflight (M0, canary half)

The first half of the M0 milestone (`docs/4_PLAN.md`): before a real debate spends
tokens, prove every participant CLI actually round-trips. This is also what lets
colleagues test Disputatio on a fresh machine — the #1 onboarding failure is a CLI
that's missing, shadowed by a stale shim, or not authenticated.

- **`doctor` preflight** (`src/doctor.ts`, new) — `node src/index.ts --doctor` canaries
  each participant with a trivial "pong" prompt, run isolated through the *same* adapter
  classifiers a real turn uses. Surfaces missing binary, stale asdf shim (exit 126/127),
  expired auth, or a broken CLI — fast (90s canary timeout, not the 10m debate timeout)
  and, on spawn failures, free (exit 127 before any tokens are spent). Exit 0 = all
  healthy, exit 1 = something's off.
- **Honest classification** — canary success is `r.ok` (a well-formed success envelope),
  **never** a text match on the reply, so doctor doesn't go flaky on model
  verbosity/punctuation. Each failed `Diagnosis` carries the raw adapter error, so the
  codex stale-shim footgun (0.1.x shadowing 0.139.0) stays diagnosable from doctor
  output alone.
- **Wiring** (`src/index.ts`) — `--doctor` branches to the preflight *before* any
  task-file/rounds/repo logic, so it's never mistaken for a task file; `buildParticipant`
  refactored to take an explicit `timeoutMs` (doctor passes the short canary timeout).
  `runIsolated` exported from `src/debate.ts` for reuse.
- **Tests** — 4 `node:test` tests (`test/doctor.test.ts`) exercising the canary fan-out,
  failure classification, the `allHealthy` gate, and report formatting via stub
  participants (the CLI transport is already covered by `adapters.test.ts`). Suite now 29
  tests, no real agent calls.
- **Deferred, on purpose** (Kaizen) — a `--version` probe ("is it installed", a cheaper
  question than "is it authenticated") and a Node ≥ 24 check are the natural next M0
  increment and belong on the adapter, behind the anti-corruption boundary.

## [0.0.3] — Hardening after the first real-repo run

Every change here traces to the 2026-06-11 repo-grounded run
(`research/real-run-2026-06-11-repo-grounded.md`): two undiagnosable turn failures,
a monologue "debate", agent writes inside the target repo, and a lineup that needed
explicit per-run policy checks.

- **`codex` adapter** (`src/adapters.ts`) — third cross-vendor voice (OpenAI), JSONL
  tier: `codex exec --json -s read-only --ephemeral`, final text = last
  `agent_message`, success = exit 0 + `turn.completed` + no `error`/`turn.failed`.
  Configurable `bin` (a stale asdf shim can shadow the real binary; exit 126/127 is
  reported as a setup problem with a hint).
- **`--config debate.yaml`** (`src/config.ts`) — explicit participant lineup, models,
  budgets, rounds, repo, timeout. Minimal no-dependency YAML subset, strict
  line-numbered errors. **Default lineup is now `claude+codex`**; optional adapters
  belong in explicit config.
- **Read-only evidence is now structural** — repo mode runs each turn in a detached
  throwaway **git worktree of HEAD**, never the real checkout; `agy` gets `--sandbox`;
  claude's allowlist switched to comma-separated rules (the space-separated string was
  mis-parsed) + `--permission-mode dontAsk` + `--disallowedTools Edit,Write`.
- **Degenerate-debate guard** (`src/debate.ts`) — fewer than 2 successful proposals
  aborts the run (exit 1) instead of letting one agent debate a monologue.
- **Diagnosable failures** — per-turn raw CLI captures persisted under
  `.debate/<id>/raw/`; claude errors read from the `errors[]` array (budget-exhaustion
  envelopes have no `result` string); budget default raised to $2; timeout default
  raised to 10m (config `timeoutMinutes`), with agy's `--print-timeout` matched.
- **Prompt hygiene** — the context fed back to agents in reaction rounds no longer
  contains cost footnotes or raw error dumps (the artifact keeps them).
- **First test suite** — 25 `node:test` tests (`npm test`): adapter classifiers against
  fixtures captured from real runs (incl. the "subtype lies" and budget-exhaustion
  regressions), fake CLI shims for timeout/exit-code paths, worktree isolation against
  a real git repo, config parser. No real agent calls.

## [0.0.2] — Agent tooling & knowledge graph

No changes to the debate engine itself; this release adds the agent-native
development scaffolding around it.

- **graphify knowledge graph** — `graphify-out/` holds a queryable graph of the repo
  (140 nodes, 17 communities) plus `GRAPH_REPORT.md` and an interactive `graph.html`.
  The graphify skill is vendored under `.claude/` and `.agents/`, and `CLAUDE.md` now
  instructs agents to query the graph before grepping.
- **Cross-CLI agent config** — `AGENTS.md` (shared agent instructions), `.codex/hooks.json`
  and `.claude/settings.json` (per-CLI hooks/permissions), making the repo navigable by
  every CLI in the planned debate lineup.
- **Toolchain** — `.tool-versions` now pins `python 3.12.8` alongside `nodejs 24.16.0`
  (graphify is Python).

## [0.0.1] — Kaizen MVP v0

First runnable cut: orchestrate a structured debate between *real*, cross-vendor AI
coding-agent CLIs and capture it as a single markdown transcript.

- **CLI entry** (`src/index.ts`) — `node src/index.ts <task.md> [rounds] [repo-path]`;
  runs on Node ≥ 24 with native TypeScript (no build step); stdout = artifact path,
  stderr = progress.
- **Adapter / transport layer** (`src/adapters.ts`) — spawn a CLI, capture output,
  classify success/failure. `claude` read via its JSON envelope
  (`is_error` + exit code, *not* `subtype`); `agy` read as plain trimmed stdout.
- **Debate orchestration** (`src/debate.ts`) — Round 1 parallel independent proposals,
  followed by N reaction rounds against the full transcript snapshot.
- **Isolation** — each agent turn runs in a throwaway temp dir (or the passed repo),
  preventing cross-agent contamination caught during the hand-run.
- **Cross-vendor lineup** — `claude` (Anthropic) + `agy` (Google/Gemini) by design,
  with a sanity check that warns on correlated-error risk.
- **Read-only evidence gathering** — when pointed at a repo, agents can read files and
  run read-only commands (tests, `git diff`) under a tool allowlist and a USD budget cap.
- **Design docs & research** — `1_IDEA` → `2_CONCEPT` → `3_ADAPTERS` → `4_PLAN`, plus
  `research/` with per-CLI headless findings and verified canary runs.
