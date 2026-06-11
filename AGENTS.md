# AGENTS.md

Instructions for Codex and other coding agents working in this repository.

## Project Context

Disputatio is an experimental local-first CLI that orchestrates structured debate
between real coding-agent CLIs. It runs native harnesses such as `claude` and `agy`,
not raw LLM API calls. The core value is cross-vendor reasoning plus executable
evidence gathered from a real repository.

The project is an early MVP. Preserve the runnable, small-step shape of the code and
avoid speculative rewrites.

## Runtime And Commands

- Use Node 24 or newer. `.tool-versions` pins `nodejs 24.16.0`.
- TypeScript is executed directly by Node. There is no build step, transpiler, or
  `tsc` workflow.
- Main usage:

```bash
node src/index.ts examples/task.md
node src/index.ts examples/task.md 2
node src/index.ts path/to/task.md 1 /path/to/repo
```

- `npm run debate -- examples/task.md` is equivalent to invoking `node src/index.ts`
  through the package script.
- There is currently no dedicated test suite or linter. Validate behavior with small
  targeted CLI runs when practical.
- Debate output is written under `.debate/debate-<timestamp>/debate.md`.
- Stdout must remain the artifact path only; progress and diagnostic logging belongs
  on stderr.

## Architecture

- `src/index.ts`: CLI entry point, argument parsing, participant lineup, cross-vendor
  sanity check, transcript writing.
- `src/debate.ts`: debate orchestration, isolation per turn, proposal and reaction
  prompt construction.
- `src/adapters.ts`: transport layer for spawning native agent CLIs and normalizing
  results into `Participant` / `AgentResult`.
- `research/`: headless CLI research, canary results, and verified notes. Read these
  before changing adapter invocations.
- `1_IDEA.md`, `2_CONCEPT.md`, `3_ADAPTERS.md`, `4_PLAN.md`: design and roadmap
  documents. Keep terminology and implementation aligned with them.

## Non-Negotiable Invariants

- Keep per-turn isolation. Without a supplied repo path, each participant must run in
  a throwaway temp directory so agents cannot read each other's outputs.
- Keep `runCli` stdin ignored with `stdio: ["ignore", "pipe", "pipe"]`. Changing
  this can make headless agent CLIs hang.
- Preserve cross-vendor participant checking. Diversity of vendors is central to the
  premise.
- Keep `claude` success classification based on exit code plus `is_error === false`;
  do not rely on `subtype`.
- Treat `agy` as text-only. Its trimmed stdout is the answer; do not add JSON output
  flags unless research proves they exist.
- Keep evidence-gathering permissions read-only unless the design docs and user
  request explicitly call for a different mode.
- Do not change stdout/stderr behavior casually. Automation depends on stdout being
  machine-friendly.

## Development Style

- Prefer small, validated changes over broad refactors.
- Use the domain language consistently: disputatio, quaestio, proposal, reaction,
  respondeo, consolidatio, participant, evidence.
- Keep the adapter layer as the anti-corruption boundary for CLI-specific quirks.
  Debate orchestration should not need to know transport details.
- Use Node standard library APIs where the current code already does. Do not add
  dependencies without a clear need.
- Add comments only for non-obvious constraints or canary-derived behavior.
- Preserve ASCII in code and docs unless a file already uses non-ASCII for a clear
  purpose.

## Verification Guidance

- For CLI behavior changes, run a focused debate command if local `claude` and `agy`
  are installed and authenticated.
- For adapter changes, first consult `research/canary-results.md` and the relevant
  `research/*-headless.md` file.
- If `graphify-out/graph.json` exists, use `graphify query "<question>"` before broad
  source browsing, and run `graphify update .` after code changes.
- If a verification command cannot run because external CLIs or authentication are
  unavailable, state that clearly in the final response.

## Git And Workspace Hygiene

- The working tree may contain user changes. Do not revert or overwrite unrelated
  modifications.
- Avoid destructive commands such as `git reset --hard` or checkout-based reverts
  unless the user explicitly asks for them.
- Keep generated debate transcripts and cache artifacts out of unrelated changes.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
