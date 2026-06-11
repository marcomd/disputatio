# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Disputatio orchestrates a structured debate between *real* AI coding-agent CLIs
(`claude`, `agy`) run as their native harnesses — not as raw LLM API calls. The
whole point is **cross-vendor diversity** plus **executable evidence**: agents run in
a real repo and can back objections with a failing test, not just rhetoric. v0 is an
experimental MVP; the core premise (debate beats a single strong agent) is **not yet
validated**.

## Commands

```bash
# proposals + 1 reaction round (pure reasoning, isolated temp dirs)
node src/index.ts examples/task.md

# N reaction rounds
node src/index.ts examples/task.md 2

# point agents at a real repo for READ-ONLY evidence gathering (the actual moat)
node src/index.ts path/to/task.md 1 /path/to/repo
```

- Runs on **Node ≥ 24**, which executes TypeScript natively — **no build step, no
  `tsc`, no transpile**. Edit `.ts` and run it directly. (`.tool-versions` pins
  `nodejs 24.16.0`; this repo uses asdf — prefix bash with `useAll;` to get node on PATH.)
- No test suite, linter, or framework. The "tests" are real debate runs.
- Output: a transcript at `.debate/debate-<timestamp>/debate.md`. **stdout = the
  artifact path only** (agent-native friendly); all progress/logging goes to **stderr**.
- Requires `claude` and `agy` CLIs installed and **already authenticated** — auth is
  out of scope.

## Architecture (three files, clean layers)

- **`src/index.ts`** — CLI entry. Parses args, fixes the participant lineup
  (`claudeAdapter` + `agyAdapter`), runs the cross-vendor sanity check, writes the
  transcript.
- **`src/adapters.ts`** — transport layer. One job: spawn a CLI, capture output,
  classify success/failure. `Participant` = `{ id, display, vendor, run(prompt, cwd) }`.
- **`src/debate.ts`** — orchestration. Round 1 = parallel independent proposals;
  then N reaction rounds where each agent reacts to the full transcript snapshot.

Data flow: `index` builds `Participant[]` → `runDebate` → per-turn `runIsolated` →
`Participant.run` → `runCli` (spawn). Results accumulate into one markdown string.

## Non-obvious invariants — do not break these

These are grounded in real local runs (`research/canary-results.md`,
`research/pre-m0-handrun.md`). Changing them silently reintroduces bugs that were
already caught:

- **Isolation is a correctness requirement, not hygiene.** Each agent runs in a
  throwaway temp dir (or the passed repo). Without it, agentic CLIs like `agy` read
  sibling files and contaminate the debate — observed in the hand-run. Keep
  `runIsolated`'s temp-dir-per-turn behavior.
- **stdin is ignored (`stdio: ["ignore", ...]`).** Codex hangs waiting for stdin EOF
  otherwise. Do not switch to inheriting/piping stdin.
- **Classify `claude` success on `is_error` + exit code — NOT `subtype`.** On error,
  `subtype` stays `"success"` while `is_error` flips `true`. Success =
  `code === 0 && j.is_error === false`.
- **`agy` is text-only.** No `--output-format`/`--json`; trimmed stdout *is* the
  answer. `claude` uses a JSON envelope.
- **Participants must be cross-vendor.** Diversity of reasoning is the entire premise;
  `index.ts` warns when the lineup isn't all distinct `vendor`s. Preserve that check
  when adding adapters (the next planned voice is `codex`).
- `claude` is invoked with a **read-only allowlist** (`Read Glob Grep`, plus
  `Bash(npm test*)` / `pytest` / `bun test` / `git diff` etc.) and a
  `--max-budget-usd` cap. Keep new evidence tools read-only.

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

## Known v0 limitations (from `4_PLAN.md`)

No scholastic `consolidatio`/`respondeo` protocol yet; reaction rounds are parallel
snapshots (agents don't see each other's same-round reactions); timeout kills only the
direct child (no process-tree kill); no `codex` adapter yet.

## Design docs

`1_IDEA.md` (vision) → `2_CONCEPT.md` (disputatio protocol, roles, convergence) →
`3_ADAPTERS.md` (per-CLI headless integration) → `4_PLAN.md` (plan, milestones, honest
status). `research/` holds per-CLI headless research and **verified canary runs** —
consult it before changing any adapter invocation.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
