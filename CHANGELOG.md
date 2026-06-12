# Changelog

All notable changes to Disputatio are documented here.

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
