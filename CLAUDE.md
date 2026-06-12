# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Disputatio orchestrates a structured debate between *real* AI coding-agent CLIs
(`claude`, `codex`, `agy`) run as their native harnesses — not as raw LLM API calls. The
whole point is **cross-vendor diversity** plus **executable evidence**: agents run in
a real repo and can back objections with a failing test, not just rhetoric. v0 is an
experimental MVP; the core premise (debate beats a single strong agent) is **not yet
validated**.

## Commands

```bash
# preflight: canary every participant CLI (runnable + authenticated). Exit 0/1.
node src/index.ts --doctor [--config examples/debate.yaml]

# proposals + 1 reaction round (pure reasoning, isolated temp dirs)
node src/index.ts examples/task.md

# N reaction rounds
node src/index.ts examples/task.md 2

# point agents at a real repo for READ-ONLY evidence gathering (the actual moat);
# agents run in a throwaway git worktree of HEAD, never the real checkout
node src/index.ts path/to/task.md 1 /path/to/repo

# explicit lineup/models/budgets (see examples/debate.yaml)
node src/index.ts path/to/task.md 1 /path/to/repo --config examples/debate.yaml

# test suite (fixture-based fake CLIs — no real agent calls, fast)
npm test
```

- Runs on **Node ≥ 24**, which executes TypeScript natively — **no build step, no
  `tsc`, no transpile**. Edit `.ts` and run it directly. (`.tool-versions` pins
  `nodejs 24.16.0`; this repo uses asdf — prefix bash with `useAll;` to get node on PATH.)
- Tests: `node:test`, zero deps, in `test/` (fixtures captured from real runs + fake
  CLI shims in `test/fakes/`). Run `npm test` after changing `src/`. Real debate runs
  remain the integration test.
- Output: a transcript at `.debate/debate-<timestamp>/debate.md` plus per-turn raw CLI
  captures in `.debate/debate-<timestamp>/raw/` (the only way to diagnose a failed
  turn). **stdout = the artifact path only** (agent-native friendly); all
  progress/logging goes to **stderr**. **<2 successful proposals → abort, exit 1.**
- Requires the lineup's CLIs installed and **already authenticated** — auth is out of
  scope. Default lineup: `claude` + `codex`; optional adapters belong in explicit
  per-run config after checking account and repository policy.

## Architecture (five files, clean layers)

- **`src/index.ts`** — CLI entry. Parses args + `--config`, builds the participant
  lineup (default `claude`+`codex`), validates the repo is git, runs the cross-vendor
  sanity check, writes transcript + raw captures, exits 1 on abort. `--doctor` branches
  to the preflight (before any task-file logic) and exits 0/1 on lineup health.
- **`src/doctor.ts`** — M0 preflight. Canaries each participant (a trivial "pong" run
  through the same adapter classifiers) to confirm it's runnable + authenticated
  *before* a debate spends tokens. Success = `r.ok` (never text-match). Failed
  diagnoses carry the raw error so the codex stale-shim footgun stays diagnosable.
- **`src/config.ts`** — `debate.yaml` parsing (deliberately minimal YAML subset, no
  deps, strict line-numbered errors). Do not grow it into a YAML parser — switch to a
  library when real YAML is needed.
- **`src/adapters.ts`** — transport layer. One job: spawn a CLI, capture output,
  classify success/failure. `Participant` = `{ id, display, vendor, run(prompt, cwd) }`.
- **`src/debate.ts`** — orchestration. Round 1 = parallel independent proposals
  (abort if <2 succeed); then N reaction rounds where each agent reacts to the full
  transcript snapshot.

Data flow: `index` builds `Participant[]` → `runDebate` → per-turn `runIsolated`
(temp dir, or throwaway git worktree in repo mode) → `Participant.run` → `runCli`
(spawn). Results accumulate into a transcript string + per-turn `Turn[]` records.

## Non-obvious invariants — do not break these

These are grounded in real local runs (`research/canary-results.md`,
`research/pre-m0-handrun.md`, `research/real-run-2026-06-11-repo-grounded.md`). Changing them
silently reintroduces bugs that were already caught:

- **Isolation is a correctness requirement, not hygiene.** Each agent turn runs in a
  throwaway temp dir, or — in repo mode — a **detached throwaway git worktree of
  HEAD**, never the real checkout. Without the temp dir, agentic CLIs like `agy` read
  sibling files and contaminate the debate (hand-run); without the worktree, evidence
  commands can write logs/tmp/test-state into the target repo. Keep both.
- **stdin is ignored (`stdio: ["ignore", ...]`).** Codex hangs waiting for stdin EOF
  otherwise. Do not switch to inheriting/piping stdin.
- **Classify `claude` success on `is_error` + exit code — NOT `subtype`.** On error,
  `subtype` stays `"success"` while `is_error` flips `true`. Success =
  `code === 0 && j.is_error === false`. **Error messages: read `errors[]` first** —
  budget-exhaustion envelopes have NO `result` string (repo-grounded run, canaried).
- **`agy` is text-only and must run `--sandbox`.** No `--output-format`/`--json`;
  trimmed stdout *is* the answer. Plain print mode can auto-execute terminal commands
  during evidence gathering. `claude` uses a JSON envelope; `codex` a JSONL stream
  (last `agent_message`; success needs `turn.completed` and no `error`/`turn.failed`
  event).
- **Participants must be cross-vendor.** Diversity of reasoning is the entire premise;
  `index.ts` warns when the lineup isn't all distinct `vendor`s. Preserve that check
  when adding adapters.
- **Keep evidence tools read-only.** `claude`: comma-separated allowlist (the rules
  contain spaces — space-separated strings get mis-parsed) + `--permission-mode
  dontAsk` + `--max-budget-usd` (default $2; $1 was exceeded by one real turn);
  `codex`: `-s read-only` (OS-enforced); `agy`: `--sandbox`.
- **Exit 126/127 from a spawned CLI is a setup failure, not an agent failure** (stale
  asdf shims shadow real binaries on this machine — `codex` needs
  `bin: /opt/homebrew/bin/codex` in debate.yaml). Keep the hint in `spawnFailure`.

## Best practices

Follow these three working principles when developing in this repo:

- **TDD (Test-Driven Development)** — write a failing test that captures the intended
  behavior *before* the implementation, then write the minimum code to make it pass,
  then refactor. This matters doubly here: Disputatio's whole value proposition is
  *executable evidence*, so the project should hold itself to the same bar it asks
  agents to meet — an assertion backed by a passing/failing test, not by prose.
- **DDD (Domain-Driven Design)** — model the code in the domain's own (scholastic)
  language: *disputatio*, *quaestio*, *proposal*, *reaction*, *respondeo*,
  *consolidatio*, *participant*, *evidence*. Keep that ubiquitous language consistent
  across types, function names, and docs. Preserve clear boundaries between the layers
  (transport / adapters ↔ orchestration / domain) — the adapter layer is an
  anti-corruption boundary that hides each CLI's quirks from the debate logic.
- **Kaizen (continuous improvement, Agile manifesto)** — ship the smallest runnable
  thing, then improve in small, validated increments. Prefer one verified step over a
  big speculative rewrite. Each change should leave the tool runnable and a little
  better; capture lessons in `research/` so improvements compound.

## Known v0 limitations (from `docs/4_PLAN.md`)

No scholastic `consolidatio`/`respondeo` protocol yet; reaction rounds are parallel
snapshots (agents don't see each other's same-round reactions); timeout kills only the
direct child (no process-tree kill); repo mode shows agents HEAD only (uncommitted
changes invisible, untracked artifacts like `node_modules` absent); a worktree shares
the repo's object store (CLI sandboxes are the second defense layer); `agy` has no
spend cap (no flag exists — budget control is claude-only).

## Design docs

`docs/1_IDEA.md` (vision) → `docs/2_CONCEPT.md` (disputatio protocol, roles, convergence) →
`docs/3_ADAPTERS.md` (per-CLI headless integration) → `docs/4_PLAN.md` (plan, milestones, honest
status). `research/` holds per-CLI headless research and **verified canary runs** —
consult it before changing any adapter invocation.

## Private area

Don't read remember.txt as it could contain private information.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
