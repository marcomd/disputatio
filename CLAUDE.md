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
# one-time setup: detect each CLI's real binary, write ~/.config/disputatio/config.yaml
# (with an opus judge seeded). Run after authenticating each CLI. --force overwrites.
node src/index.ts --init [--config examples/debate.yaml] [--force]

# preflight: canary every participant CLI (runnable + authenticated). Exit 0/1.
node src/index.ts --doctor [--config examples/debate.yaml]

# proposals + 1 reaction round (pure reasoning, isolated temp dirs).
# the quaestio is the sole positional, given INLINE by default (quote it);
# --file reads it from disk instead. rounds/repo are named flags.
node src/index.ts "Review changes in this branch and find issues."
node src/index.ts --file examples/task.md   # long quaestio from a markdown file

# N reaction rounds
node src/index.ts "Review changes in this branch and find issues." --rounds 2

# point agents at a real repo for READ-ONLY evidence gathering (the actual moat);
# agents run in a throwaway git worktree of HEAD, never the real checkout
node src/index.ts "Review changes in this branch and find issues." --repo /path/to/repo

# explicit lineup/models/budgets (see examples/debate.yaml)
node src/index.ts --file path/to/task.md --rounds 1 --repo /path/to/repo --config examples/debate.yaml

# close the loop after a NEEDS_INPUT respondeo: answer its quaestiones and re-judge the
# LATEST debate (or --debate <dir>). If now RESOLVED, the deliverable is drafted too.
node src/index.ts --continue "Sync translation; files are comment-free; translator is git-fluent."

# (re)draft the final-report.md deliverable from an already-RESOLVED debate
node src/index.ts --finalize [--debate .debate/debate-<ts>]

# per-TURN wall-clock cap in minutes (default 10; config key: timeoutMinutes).
# the redactio gets 2x this — it reads the whole transcript and is the last turn.
node src/index.ts "..." --timeout 20

# test suite (fixture-based fake CLIs — no real agent calls, fast)
npm test
```

- **Development is buildless.** Node ≥ 24 executes TypeScript natively — edit `.ts` and
  run it directly (`node src/index.ts`); `npm test` runs the `.ts` tests as-is. No `tsc`,
  no transpile in the daily loop. (`.tool-versions` pins `nodejs 24.16.0`; this repo uses
  asdf — prefix bash with `useAll;` to get node on PATH.)
- **Publishing bundles to JS** (`npm run build` → `esbuild` → `dist/index.js`, run
  automatically via the `prepack` hook on `npm pack`/`npm publish`). This is NOT optional:
  Node refuses to type-strip `.ts` under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so an `npm install -g` of a `.ts` bin
  crashes — the published `bin` MUST be the bundled `dist/index.js`. esbuild preserves the
  source shebang on line 1; do **not** also pass `--banner:js` (two `#!` lines → the line-2
  one is a syntax error; regression-guarded in `test/build.test.ts`). `esbuild` is a
  devDependency only — Disputatio still has **zero runtime dependencies**. `npm link`
  does NOT reproduce the node_modules copy (symlink realpath is the repo), so verify the
  binary with `npm pack` + `npm install -g ./<tgz>`, never `npm link` alone.
- Tests: `node:test`, zero deps, in `test/` (fixtures captured from real runs + fake
  CLI shims in `test/fakes/`). Run `npm test` after changing `src/`. Real debate runs
  remain the integration test.
- Output: a transcript at `.debate/debate-<timestamp>/debate.md` plus per-turn raw CLI
  captures in `.debate/debate-<timestamp>/raw/` (the only way to diagnose a failed
  turn). When a judge runs: `respondeo.md` (the ruling ON the debate), and — only on a
  RESOLVED respondeo — `final-report.md` (the **redactio**: the actual deliverable born
  FROM the debate, the thing you start the work from). `--continue` versions the verdict
  (`respondeo-2.md`, `-3.md`, …; highest number is current) and overwrites
  `final-report.md`. **stdout = the artifact path only** (agent-native friendly); all
  progress/logging goes to **stderr**. **<2 successful proposals → abort, exit 1.**
- Requires the lineup's CLIs installed and **already authenticated** — auth is out of
  scope. Default lineup: `claude` + `codex`; optional adapters belong in explicit
  per-run config after checking account and repository policy.

## Architecture (seven files, clean layers)

- **`src/index.ts`** — CLI entry (carries the `#!/usr/bin/env node` shebang so npm's
  `bin` symlink runs it directly; Node ≥24 type-strips the `.ts`). Parses args, resolves
  the quaestio (inline by default, or `--file <path>` — via `quaestio.ts`), resolves
  config (via `install.ts`), builds the participant lineup (default `claude`+`codex`),
  validates the repo is git, runs the cross-vendor sanity check, writes transcript + raw
  captures, exits 1 on abort. `--doctor` (preflight) and `--init` (setup) branch before
  any quaestio logic and exit 0/1. `--continue "<answers>"` and `--finalize` branch
  before quaestio resolution too: they re-enter an EXISTING `.debate/<dir>` (latest, or
  `--debate <dir>`), recover the quaestio from the saved transcript, and run the judge
  alone — no new debate. Both fall back to the built-in opus judge when the config has
  none (closing the loop is intrinsically a judge act).
- **`src/quaestio.ts`** — quaestio input resolution. Pure (no fs): given the `--file`
  path (if any) and the positionals, returns a discriminated result for where the quaestio
  comes from — `{source:"inline"}` (the sole positional IS the question, the default),
  `{source:"file"}` (`--file <path>`), or `{ok:false, error}` for the bad cases (no
  quaestio, both sources, or extra unquoted positionals). rounds/repo are named flags
  (`--rounds`/`--repo`), NOT positionals, so there is no positional juggling. index.ts
  does the actual `readFile`. Extracted as a seam so resolution is unit-testable
  (`test/quaestio.test.ts`) without executing index.ts's top-level body.
- **`src/install.ts`** — config resolution + the `--init` setup phase. Resolution
  precedence: `--config <path>` → `~/.config/disputatio/config.yaml` → built-in lineup.
  The shipped `examples/debate.yaml` is a TEMPLATE, **never auto-loaded** (that coupling
  was the P2 portability footgun: its host-specific `bin:` broke other machines). `--init`
  canaries the lineup, resolves each CLI's real binary (pinning a `bin:` **only when** the
  PATH one fails — the stale-shim case), seeds an opus judge, and writes the user config.
- **`src/doctor.ts`** — M0 preflight. Canaries each participant (a trivial "pong" run
  through the same adapter classifiers) to confirm it's runnable + authenticated
  *before* a debate spends tokens. Success = `r.ok` (never text-match). Failed
  diagnoses carry the raw error so the codex stale-shim footgun stays diagnosable.
- **`src/config.ts`** — `debate.yaml` parsing + the matching `serializeDebateConfig`
  (its inverse, used by `--init`; keep them in lock-step). Deliberately minimal YAML
  subset, no deps, strict line-numbered errors. Do not grow it into a YAML parser —
  switch to a library when real YAML is needed. Per-participant keys: `adapter`, `model`,
  `bin`, `maxBudgetUsd` (claude only), `effort`. `effort` is a **free-form string** passed
  through to the CLI — the parser does NOT validate it (the CLI does; bad values
  surface in the raw capture / `--doctor`), so the parser stays version-agnostic.
- **`src/adapters.ts`** — transport layer. One job: spawn a CLI, capture output,
  classify success/failure. `Participant` = `{ id, display, vendor, canExecute,
  run(prompt, cwd) }`. Each classifier also extracts Tier-0 `Evidence` from the stream it
  already parses (`ranCommands`, `toolCalls`, claude's `agentTurns`/`permissionDenials`).
- **`src/debate.ts`** — orchestration + Tier-0 measurement (`Turn` carries `phase`,
  `round`, `promptBytes`, `agentMs`, `turnMs`, `canExecute`; `summarizeEvidence` is the
  run-level evidence-validity check). Round 1 = parallel independent proposals
  (abort if <2 succeed); then N reaction rounds where each agent reacts to the full
  transcript snapshot; then the opt-in **respondeo** (judge) renders the consolidatio.
  On a RESOLVED respondeo the judge then acts as **synthesizer** for the **redactio**
  (`runFinalize`) — authoring the deliverable from the determination; unlike respondeo it
  MAY be repo-grounded (it accepts `repoPath`). `runContinuation` re-judges after the human answers (used by
  `--continue`). Both are exported so the CLI can drive them standalone over a saved debate.

Data flow: `index` builds `Participant[]` → `runDebate` → per-turn `runIsolated`
(temp dir, or throwaway git worktree in repo mode) → `Participant.run` → `runCli`
(spawn). Results accumulate into a transcript string + per-turn `Turn[]` records.
**`runIsolated` returns a measured wrapper**, `{ result, agentMs, turnMs, promptBytes }`,
not a bare `AgentResult` — it is the measurement bracket, so every caller unwraps
`.result` (breaking change in v0.8.0).

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
  event); `pi` (earendil-works/pi, a minimal multi-LLM harness) a `--mode json` event
  stream (last assistant `message_end`; failures in `auto_retry_end.finalError`). `pi`
  has no OS sandbox, so read-only = a tool ALLOWLIST (`--tools read,grep,find,ls`,
  omitting bash/edit/write).
- **Participants must be cross-vendor.** Diversity of reasoning is the entire premise;
  `index.ts` warns when the lineup isn't all distinct `vendor`s. Preserve that check
  when adding adapters.
- **Keep evidence tools read-only.** `claude`: comma-separated allowlist (the rules
  contain spaces — space-separated strings get mis-parsed) + `--permission-mode
  dontAsk` + `--max-budget-usd` (default **$5**, overridable per-run with `--budget`;
  $1 then $2 were each exceeded by a real turn);
  `codex`: `-s read-only` (OS-enforced); `agy`: `--sandbox`; `pi`: `--tools
  read,grep,find,ls` allowlist (no OS sandbox — omit bash/edit/write).
- **Reasoning `effort` is per-CLI, not uniform.** `claude` takes a native
  `--effort {low,medium,high,xhigh,max}`; `codex` has no flag — set it via the config
  override `-c model_reasoning_effort="…"` ({minimal,low,medium,high}); `agy` has NO
  effort control (effort is baked into the model name, e.g. `(High)`) and `index.ts`
  warns if `effort` is set for it; `pi` takes `--thinking {off,minimal,low,medium,
  high,xhigh}`. Keep the per-CLI mapping when adding adapters.
- **A failed redactio is RECOVERABLE — always print the retry.** The transcript and a
  RESOLVED `respondeo.md` are already on disk, so `--finalize` re-runs the turn that died.
  The hint used to be printed only for budget exhaustion, so the 2026-08-11 timeout looked
  like a lost run ($3.26 and 578s of a 600s cap, discarded mid `tool_use`). `index.ts`
  prints `finalizeRetryHint(kind, …)` for EVERY redactio failure. Do not replace this with
  an interactive prompt: stdout is the artifact path and unattended/agent-driven runs must
  not block on stdin.
- **A timed-out turn still reports what it spent.** `claude`'s partial envelope carries
  `total_cost_usd`/`num_turns` even when killed; the adapter salvages them instead of
  returning on `timedOut` first. A $3.26 turn recorded as costless is the same class of
  error as an unknown counted as a zero.
- **Exit 126/127 from a spawned CLI is a setup failure, not an agent failure** (stale
  asdf shims shadow real binaries on this machine — `codex` needs
  `bin: /opt/homebrew/bin/codex` in debate.yaml). Keep the hint in `spawnFailure`.
- **Timeouts must kill the process GROUP, not just the direct child.** `runCli` spawns
  `detached: true` (child becomes its own group leader) and, on timeout, signals `-pid`
  (`SIGTERM`, then `SIGKILL` after `KILL_GRACE_MS`). A real run (2026-06-12, I Love
  Coding) hung ~45 min at ~0 CPU because killing only the direct child left an orphaned
  worker holding the stdout pipe open, so `close` never fired. `detached` also makes the
  group signal safe (it targets the child's group, never the orchestrator's). Regression
  test: `test/adapters.test.ts` "leaked worker holding the pipe".

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

## Known v0 limitations (summary of `docs/4_PLAN.md` §11)

No full scholastic `consolidatio` (pre-debate N-proposal merge) yet — `respondeo` +
`redactio` exist; reaction rounds are parallel snapshots (agents don't see each other's
same-round reactions); repo mode shows agents HEAD only (uncommitted changes invisible,
untracked artifacts like `node_modules` absent); a worktree shares the repo's object
store (CLI sandboxes are the second defense layer); `agy` has no spend cap (no flag
exists — budget control is claude-only).

**Deliberately deferred follow-ups (close-the-loop, scoped down on purpose):**
- **`--continue` re-debate path.** Today `--continue` re-judges ALONE. When the human's
  answer opens ground the debaters never argued, the judge returns NEEDS_INPUT again
  (it refuses to invent a verdict) — the signal that a fresh reaction round is needed.
  Re-engaging the debaters with the human input is the next increment.
- **Crash-resume.** `runDebate` accumulates in memory; `index.ts` writes only at the end,
  so a mid-debate crash loses the run (restart from scratch). This is separate from
  `--continue` (a workflow step, not a crash recovery). A persisted `state.json` spine
  (planned in `docs/4_PLAN.md` §3) would give both; not built for v0.
- **Redactio tool grant.** `runFinalize` IS repo-groundable (it takes `repoPath` and runs
  in a worktree) — the old "transcript-only" note here was stale; `4_PLAN.md` §11 was
  right. What is open: in the 2026-08-04 run the synthesizer turn recorded
  `permission_denials: 1`, so the judge's allowlist blocked a command it wanted. Match the
  finalizer's tool grant to its repo-grounded intent.

## Design docs

`docs/1_IDEA.md` (vision) → `docs/2_CONCEPT.md` (disputatio protocol, roles, convergence) →
`docs/3_ADAPTERS.md` (per-CLI headless integration) → `docs/4_PLAN.md` (as-built plan +
the **status table** in §11: shipped / validating now / deferred pending evidence) →
`docs/5_METRICS.md` (protocol KPIs — error amplification, coordination overhead,
redundancy, efficiency; Tier-0 free vs Tier-1 needs a claim ledger). `research/` holds
per-CLI headless research and **verified canary runs** — consult it before changing any
adapter invocation.

`4_PLAN.md` §11 is the single source of truth for project status. If any other document
(including the limitations list below) contradicts it, §11 wins.

## Private area

Don't read remember.txt as it could contain private information.

**Disputatio is a public repository, but it runs against arbitrary (often private)
projects.** Before committing anything under `research/` — or any transcript/example
captured from a real run — scrub it for project-confidential material (source snippets,
internal paths, business logic, credentials, customer data). Never commit confidential
content from a project Disputatio was pointed at. As a last resort, name the file
`research/private_*` (gitignored, like `examples/private*`) to keep it local-only.

## Versioning — do this at the end of every change

After any change that is committed, **always** bump the version, update the changelog,
and update the README. Use standard semver criteria:

- **patch** (0.x.**y**) — bug fixes, doc-only changes, minor internal refactors with no
  behavioural change visible to users.
- **minor** (0.**x**.0) — new flags, new features, new phases, new exported APIs, or any
  change that adds capability without breaking existing invocations.
- **major** (**x**.0.0) — breaking CLI changes (flag renames/removals, output format
  changes, config schema changes). Pre-1.0 breaking changes are acceptable but still
  warrant a minor bump until 1.0.

**Steps (in order, before the commit):**

1. Bump `"version"` in `package.json`.
2. Add a `## [x.y.z] — <one-line summary>` entry at the top of `CHANGELOG.md` (below
   the header, above the previous release). List every user-visible change as a bullet.
3. Update the version in the README.md status callout:
   `> **Status: experimental, early MVP — vX.Y.Z.**`

All three files go in the same commit as the code change. Commit subject starts with
`vX.Y.Z`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
