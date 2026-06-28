# AGENTS.md

Instructions for Codex and other coding agents working in this repository.

## Project Context

Disputatio is an experimental local-first CLI that orchestrates structured debate
between real coding-agent CLIs. It runs native harnesses such as `claude`, `codex`,
`agy`, and `pi`, not raw LLM API calls. The core value is cross-vendor reasoning plus
executable evidence gathered from a real repository.

The project is an early MVP. Preserve the runnable, small-step shape of the code and
avoid speculative rewrites.

## Runtime And Commands

- Use Node 24 or newer. `.tool-versions` pins `nodejs 24.16.0`.
- Development is buildless: TypeScript is executed directly by Node (`node src/index.ts`,
  `npm test`). No transpiler or `tsc` workflow in the daily loop.
- Publishing bundles to JS: `npm run build` (esbuild → `dist/index.js`) runs automatically
  via the `prepack` hook. Required because Node won't type-strip `.ts` under `node_modules`,
  so the installed `bin` is the bundled `dist/index.js`, not the source. esbuild is a
  devDependency; there are still zero runtime dependencies.
- Installed as a binary: `npm install -g disputatio` → `disputatio …`. Verify the binary
  with `npm pack` + `npm install -g ./<tgz>` (NOT `npm link`, which can't reproduce the
  node_modules copy).
- Main usage:

```bash
node src/index.ts --init [--config examples/debate.yaml] [--force]
node src/index.ts --doctor [--config examples/debate.yaml]
node src/index.ts "Review changes in this branch and find issues."
node src/index.ts --file examples/task.md
node src/index.ts "Review changes in this branch and find issues." --rounds 2
node src/index.ts "Review changes in this branch and find issues." --repo /path/to/repo
node src/index.ts --file path/to/task.md --rounds 1 --repo /path/to/repo --config examples/debate.yaml
node src/index.ts --continue "Sync translation; files are comment-free; translator is git-fluent."
node src/index.ts --finalize [--debate .debate/debate-<ts>]
```

- `npm run debate -- examples/task.md` is equivalent to invoking `node src/index.ts`
  through the package script.
- `npm test` runs the Node fixture tests in `test/` with fake CLI shims; use it after
  changing `src/`.
- The quaestio is inline by default and must be quoted as the sole positional. Use
  `--file <path>` for long markdown tasks. Reaction count and repo mode are named flags:
  `--rounds <n>` and `--repo <path>`, not positionals.
- `--init` canaries the lineup, resolves each CLI's real binary (pinning a `bin:` only
  when the PATH one fails), seeds an opus judge, and writes the user config. Run it after
  authenticating each CLI; it spends a cheap canary turn per participant. `--force`
  overwrites an existing user config.
- `--doctor` preflights every configured participant with a cheap canary before a
  debate spends tokens. It prints the human report to stderr and exits 0/1.
- `--continue "<answers>"` answers a NEEDS_INPUT respondeo and re-judges the latest
  debate, or `--debate <dir>`. `--finalize` drafts or re-drafts `final-report.md` from
  an already RESOLVED debate. These judge-only paths do not start a new debate and fall
  back to the built-in opus judge when config has none.
- Config precedence when `--config` is omitted: `~/.config/disputatio/config.yaml` if
  present, else the built-in lineup (`claude` + `codex`, no judge). `examples/debate.yaml`
  is a copy-me TEMPLATE — never auto-loaded (that coupling was a portability footgun).
- Debate output is written under `.debate/debate-<timestamp>/debate.md`; raw per-turn
  CLI captures are written under `.debate/debate-<timestamp>/raw/`. Judge runs write
  `respondeo.md`; continuations version that as `respondeo-2.md`, `respondeo-3.md`, and
  so on. A RESOLVED respondeo also writes `final-report.md`, the redactio deliverable.
- Stdout must remain the artifact path only; progress and diagnostic logging belongs
  on stderr. Doctor has no artifact, so stdout remains empty. Fewer than two successful
  proposals aborts the debate and exits 1.
- The default lineup is `claude` + `codex`. Optional adapters should be enabled through
  explicit per-run config after checking account and repository policy.

## Architecture

- `src/index.ts`: CLI entry point (with `bin` shebang), argument parsing, quaestio
  reading, `--config`, participant lineup, cross-vendor sanity check, `--doctor`/
  `--init`/`--continue`/`--finalize` branches, transcript and raw-capture writing.
- `src/quaestio.ts`: pure quaestio input resolution. Inline is the default; `--file`
  selects disk input; `--rounds` and `--repo` are named flags. Keep it unit-testable
  without executing `index.ts` top-level behavior.
- `src/install.ts`: config resolution (`--config` → `~/.config/disputatio/config.yaml` →
  built-in lineup) and the `--init` setup phase (probe lineup, resolve real binaries,
  write the user config). The anti-corruption boundary between run modes and disk layout.
- `src/doctor.ts`: M0 preflight. Runs a trivial canary through the same participant
  adapters/classifiers used by real debate turns, then exits 0/1 based on lineup
  health.
- `src/debate.ts`: debate orchestration, isolation per turn, proposal and reaction
  prompt construction. Abort when fewer than two proposals succeed. Also exports
  judge-only continuation and finalization flows for saved debates.
- `src/adapters.ts`: transport layer for spawning native agent CLIs and normalizing
  results into `Participant` / `AgentResult`.
- `src/config.ts`: minimal `debate.yaml` parsing (and the matching `serializeDebateConfig`
  used by `--init`) for explicit lineups, models, budgets, effort, and binary overrides.
  `effort` is a free-form string passed through to the relevant CLI; do not validate it
  in the parser.
- `test/`: Node `node:test` fixture tests and fake CLI shims. These should stay fast
  and not require real agent calls.
- `research/`: headless CLI research, canary results, and verified notes. Read these
  before changing adapter invocations.
- `docs/1_IDEA.md`, `docs/2_CONCEPT.md`, `docs/3_ADAPTERS.md`, `docs/4_PLAN.md`: design and roadmap
  documents. Keep terminology and implementation aligned with them.

## Non-Negotiable Invariants

- Keep per-turn isolation. Without a supplied repo path, each participant must run in
  a throwaway temp directory so agents cannot read each other's outputs. With a repo
  path, run evidence gathering in a detached throwaway git worktree of HEAD, not the
  real checkout.
- Keep `runCli` stdin ignored with `stdio: ["ignore", "pipe", "pipe"]`. Changing
  this can make headless agent CLIs hang.
- Preserve cross-vendor participant checking. Diversity of vendors is central to the
  premise.
- Keep `claude` success classification based on exit code plus `is_error === false`;
  do not rely on `subtype`. Read `errors[]` before `result` when reporting failures.
- Keep `codex` success classification based on a completed JSONL turn and no error or
  failed-turn event; the answer is the last `agent_message`.
- Treat `agy` as text-only and sandboxed. Its trimmed stdout is the answer; do not add
  JSON output flags unless research proves they exist.
- Treat `pi` as a JSON event stream via `--mode json`: the answer is the last assistant
  `message_end`, and failures are reported in `auto_retry_end.finalError`. It has no OS
  sandbox, so read-only means a tool allowlist: `--tools read,grep,find,ls`.
- Keep evidence-gathering permissions read-only unless the design docs and user
  request explicitly call for a different mode. Preserve per-CLI mappings: `claude`
  allowlist plus `--permission-mode dontAsk` and budget, `codex -s read-only`, `agy
  --sandbox`, and `pi --tools read,grep,find,ls`.
- Keep reasoning effort per CLI, not uniform. `claude` uses `--effort`; `codex` uses
  config override `-c model_reasoning_effort="..."`; `agy` has no effort control and
  should warn if configured; `pi` uses `--thinking`.
- Keep doctor success based on adapter `ok`, never canary text matching. Failed
  diagnoses must preserve raw adapter errors so setup issues like stale shims remain
  diagnosable.
- Treat spawned CLI exit 126/127 as setup failure, not agent failure; preserve the stale
  shim hint in `spawnFailure`.
- Timeouts must kill the process group. `runCli` uses `detached: true` and signals
  `-pid` with `SIGTERM`, then `SIGKILL` after the grace period, so orphaned workers
  cannot keep stdout pipes open.
- Do not change stdout/stderr behavior casually. Automation depends on stdout being
  machine-friendly.

## Development Style

- Prefer TDD for behavior changes: write the failing fixture/unit test first, implement
  the minimum code, then refactor.
- Prefer small, validated changes over broad refactors.
- Use the domain language consistently: disputatio, quaestio, proposal, reaction,
  respondeo, consolidatio, redactio, participant, evidence.
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
- For participant setup or adapter classification changes, run `node src/index.ts
  --doctor [--config examples/debate.yaml]`.
- Run `npm test` after changing `src/`; the test suite uses fixture-based fake CLIs
  and should not require real agent authentication.
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

## Private area

Don't read remember.txt as it could contain private information.

Disputatio is public, but it can run against arbitrary private repositories. Before
committing anything under `research/`, or any transcript/example captured from a real
run, scrub project-confidential material such as source snippets, internal paths,
business logic, credentials, or customer data. As a last resort, name local-only files
`research/private_*` (gitignored, like `examples/private*`).

## Versioning

After any change that is committed, bump the version, update the changelog, and update
the README status callout in the same commit. Use semver:

- Patch for bug fixes, doc-only changes, and minor internal refactors with no
  user-visible behavior change.
- Minor for new flags, features, phases, exported APIs, or added capability.
- Major for breaking CLI changes; pre-1.0 breaking changes still warrant a minor bump.

Steps before committing:

1. Bump `"version"` in `package.json`.
2. Add a `## [x.y.z] — <one-line summary>` entry at the top of `CHANGELOG.md`.
3. Update the README status callout to `> **Status: experimental, early MVP — vX.Y.Z.**`

Commit subjects for releases start with `vX.Y.Z`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
