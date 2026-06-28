# Changelog

All notable changes to Disputatio are documented here.

## [0.5.1] — raise default judge budget from $2 to $5

The $2 cap was hit on a real medium-sized repo run, wasting the tokens already spent on
the debate. $5 covers medium work; `--budget` is the escape hatch for large repos.

- `claudeAdapter` default raised: `opts.maxBudgetUsd ?? 5` (was `?? 2`).
- `DEFAULT_JUDGE.maxBudgetUsd` raised to `5` (was `2`).
- Usage line and comment updated to reflect the new default.

## [0.5.0] — `--budget` flag + structured budget-exhaustion detection

Adds a CLI escape hatch for when the redactio (final-report.md synthesizer) hits the
per-turn spending cap, and makes budget exhaustion a structured, actionable error rather
than an opaque string.

- **`--budget <usd>`** (`src/index.ts`) — overrides the judge/synthesizer per-turn
  budget cap for that run. Precedence: `--budget` > `maxBudgetUsd` in config > default
  `$2`. Applies to both the main debate redactio and the `--continue`/`--finalize`
  paths. Debater budgets remain config-only (the issue is always the redactio turn).
- **Structured `budgetExhausted` flag** (`src/adapters.ts`) — `AgentResult` failure
  variant gains `budgetExhausted?: true`, set via `j.subtype === "error_max_budget_usd"`
  (the reliable discriminator; see the existing CANARY LESSON comment). Not a
  string-match — survives message-wording changes.
- **`finalReportError` on `DebateOutcome`** (`src/debate.ts`) — when the redactio runs
  but fails, `{ budgetExhausted, message }` is set on the outcome so callers can branch
  structurally rather than parsing the transcript.
- **Actionable retry hint** (`src/index.ts`) — on budget exhaustion in any of the three
  redactio failure sites (main debate, `--finalize`, `--continue` after RESOLVED), stderr
  prints the exact retry command:
  `disputatio --finalize --budget <usd> --debate <dir> [--repo <repo>]`
- **Tests** — 70 tests (up from 69); new: `budgetExhausted` flag on adapter result,
  `finalReportError.budgetExhausted` propagation through `runDebate`.

## [0.4.0] — redactio (final deliverable) + `--continue` / `--finalize` / `--debate`

Closes the human-in-the-loop: after the judge rules, the deliverable is now drafted
automatically, and two new flags let you close the loop on a saved debate without
re-running it.

- **Redactio phase** (`src/debate.ts`, `runDebate`) — when the respondeo resolves, the
  judge immediately acts as **synthesizer** and writes `final-report.md`: the actual
  deliverable born from the debate (implementation plan, review, proposal…), built from
  the settled decisions. With `--repo` it grounds this in real files (read-only worktree
  of HEAD). A failed redactio is non-fatal — the debate + verdict still succeed.
- **`--continue "<answers>"`** (`src/index.ts`) — close the loop after a `NEEDS_INPUT`
  respondeo: fold the human's answers in and re-judge the latest (or `--debate`) debate.
  If it now resolves, the deliverable is drafted. If the answers open genuinely new ground
  the debaters never argued, the judge refuses to invent a verdict and flags it instead.
  Verdict is versioned as `respondeo-2.md`, `-3.md`… (highest number = current);
  `final-report.md` is overwritten on every resolution.
- **`--finalize`** (`src/index.ts`) — (re)draft `final-report.md` from an
  already-RESOLVED debate without re-judging. Refuses on `NEEDS_INPUT` (run
  `--continue` first). Accepts `--repo` to ground the deliverable in real files.
- **`--debate <dir>`** (`src/index.ts`) — target a specific `.debate/<dir>` for
  `--continue` / `--finalize`; defaults to the latest debate.
- **stdout = primary artifact** (`src/index.ts`) — when a deliverable was produced,
  stdout prints `final-report.md`; otherwise `debate.md`. Both paths were previously
  stdout; now the most actionable artifact surfaces first (agent-native friendly).
- **Exports** (`src/debate.ts`) — `runFinalize`, `runContinuation`, `parseRespondeoStatus`
  exported so `index.ts` can drive them standalone over a saved debate (seam for
  `--continue` / `--finalize`).
- **README** — new "The flow: phases & artifacts" section with scholastic-phase
  descriptions (proposals → reactions → respondeo → redactio) and an output-files table
  (`debate.md`, `respondeo.md`, `final-report.md`, `raw/`).
- **Tests** — 69 tests (up from 62); new cases cover `runFinalize`, `runContinuation`,
  and worktree cleanup.
- **Docs** — `docs/4_PLAN.md` updated with 2026-06-27 status note on the surface change
  (flags, not subcommands) and the partial resolution of execution-ownership point.

## [0.3.0] — inline quaestio by default; `--rounds`/`--repo` flags

The quaestio no longer has to live in a file: you can ask on the fly. This is a
deliberate, backward-incompatible CLI change (acceptable pre-1.0): the file path is no
longer the first positional.

- **Inline quaestio is the default** (`src/index.ts`, `src/quaestio.ts` new) — the sole
  positional IS the question (`disputatio "Review changes in this branch and find issues."`);
  `--file <path>` (alias `-f`) reads it from a markdown file instead, for long
  descriptions. stderr logs the source (`quaestio: inline (N chars)` or `quaestio: <path>`).
- **`--rounds`/`--repo` are named flags** — rounds and repo path moved off the positionals
  (where they used to shift depending on `--file`) to explicit `--rounds N` / `--repo path`,
  so the quaestio is the only positional and there's no positional juggling. Both still fall
  back to `debate.yaml` (`rounds`/`repo`) then the built-in defaults.
- **`src/quaestio.ts`** (new, pure — no fs) — resolves the quaestio source and rejects the
  ambiguous cases with clear errors: no quaestio given, both inline and `--file`, or extra
  unquoted positionals (`did you forget to quote the quaestio?`). Extracted as a testable
  seam since `index.ts` runs entirely at module top level. `index.ts` does the actual
  `readFile`.
- **Tests** — `test/quaestio.test.ts` covers inline default, `--file` source, and the
  no-quaestio / conflict / extra-positional rejections. Suite now 62 tests, no real agent
  calls.
- **Docs** — `README.md`, `docs/npm-package.md`, and `CLAUDE.md` (Commands + Architecture,
  now seven files) switched to the inline + `--rounds`/`--repo` form.

## [0.2.2] — fix: The npm doc now has a short version that links to the one on github

## [0.2.1] — fix: the published binary couldn't run (ship bundled JS)

`0.2.0` was published with `bin` pointing at `src/index.ts`, but **Node refuses to
type-strip TypeScript under `node_modules`** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`),
so `npm install -g disputatio@0.2.0` produced a `disputatio` that crashed on launch. (The
0.2.0 verification used `npm link`, whose symlink realpath is the repo — *outside*
`node_modules` — so it never reproduced the failure. A real `npm install -g` copies files
*into* `node_modules`.) `0.2.0` is deprecated; use ≥ 0.2.1.

- **Publish-time bundle** (`package.json`, `esbuild` devDependency) — `npm run build`
  bundles `src/index.ts` → `dist/index.js`, run automatically via the `prepack` hook on
  `npm pack`/`npm publish`. `bin` now points at the JS bundle. Development stays buildless
  (`node src/index.ts`, `npm test`); runtime dependencies remain **zero** (esbuild is
  dev-only). esbuild preserves the source's line-1 shebang — no `--banner` (a second `#!`
  line is a syntax error).
- **Regression guard** (`test/build.test.ts`) — asserts the built bin is JS with exactly
  one line-1 shebang and runs `--help` end to end. Skips on a zero-dep clone (no esbuild).

## [0.2.0] — portable config + installable `disputatio` binary

Disputatio is now usable two ways off one codebase — from source (`node src/index.ts`)
and as an installed binary (`npm install -g disputatio`) — and the default config path is
portable across machines.

- **Portability fix (P2)** — a no-`--config` run no longer auto-loads `examples/debate.yaml`.
  That coupling (added in 0.1.0) shipped a host-specific `bin: /opt/homebrew/bin/codex`,
  so no-config runs and `--doctor` failed on any other machine. The example is now a
  copy-me **template** (host-specific `bin:` commented out), never auto-loaded.
- **Config resolution** (`src/install.ts`, `src/index.ts`) — precedence is now
  `--config <path>` → `~/.config/disputatio/config.yaml` (XDG-aware, read identically in
  both run modes) → built-in lineup (`claude` + `codex`, **no judge** — bare runs stay
  lean). An explicit `--config` still hard-fails if the file is missing.
- **Installable binary** (`package.json`, `src/index.ts`) — `bin: disputatio` + a
  `#!/usr/bin/env node` shebang make `npm install -g disputatio` work with **no build
  step** (Node ≥24 type-strips the `.ts`). A `files` allowlist publishes only `src`, the
  portable template, the generic example task, and docs — **never** the gitignored
  `examples/private_*` or real-run-derived examples.
- **`--init` setup phase** (`src/install.ts`) — probes the lineup, resolves each CLI's
  real binary via the same canary `--doctor` uses (pinning a `bin:` **only when** the PATH
  binary fails — the codex stale-shim case), seeds an opus judge, and writes
  `~/.config/disputatio/config.yaml` (backing up any existing one unless `--force`). Run it
  after authenticating each CLI; it spends one cheap canary turn per participant.
- **`serializeDebateConfig`** (`src/config.ts`) — the inverse of `parseDebateConfig`, used
  by `--init` to emit the minimal YAML subset; round-trip tested. Refuses values it cannot
  represent (a `#` comment marker) rather than silently corrupting them.

## [0.1.0] — `respondeo`: the judge stage (first scholastic-protocol step)

The top missing piece of the v0 MVP (`docs/4_PLAN.md`: "no respondeo protocol yet").
After the reaction rounds, one configurable agent reads the full transcript and renders
the *consolidatio* — the resolution the human previously had to write by hand.

- **Opt-in `judge:` block** (`src/config.ts`, `examples/debate.yaml`) — a new top-level
  `judge:` section in `debate.yaml`, same keys as a participant (`adapter`, `model`,
  `effort`, `bin`, `maxBudgetUsd`). Present → the debate ends with a respondeo turn;
  absent → it ends at the reaction rounds exactly as before. The parser gained
  non-destructive `inParticipants`/`inJudge` block-state flags, fixing a latent bug
  where any top-level key after `participants:` discarded the lineup accumulator.
- **Transcript-only judge** (`src/debate.ts`) — the respondeo turn reasons over the
  `debate.md` snapshot **alone** (no repo/worktree access, even in repo mode), in an
  isolated temp dir like any other turn. Recorded as a `Respondeo — <display>` turn in
  both the transcript and the per-turn raw captures.
- **Ask, don't guess** — the judge must open its output with exactly one status line,
  `STATUS: RESOLVED` or `STATUS: NEEDS_INPUT`. When a contested point genuinely cannot
  be settled from the transcript, it emits `STATUS: NEEDS_INPUT`, records the settled
  agreements, then a `## Quaestiones (for the human)` list — and issues no ruling on the
  unresolved points instead of fabricating one. `index.ts` parses that line and surfaces
  NEEDS_INPUT on stderr (exit stays 0 — asking is not an abort). A failed judge turn is
  non-fatal: recorded, status `FAILED`, debate still succeeds.
- **`respondeo.md` artifact** (`src/index.ts`) — written alongside `debate.md`. stdout
  stays the `debate.md` path (agent-native contract); the `respondeo.md` path and any
  NEEDS_INPUT warning go to stderr. `--doctor` now canaries the judge alongside the
  debaters.
- **Correlated-error guard for the judge** — a loud `⚠️` only when the judge's built
  `Participant.display` (adapter+model) exactly matches a debater's (an agent grading its
  own argument); a milder one-line **note** when it merely shares a vendor. The shipped
  lineup — Opus judging the Sonnet+Codex debaters — produces the soft note, no `⚠️`.
- **Default config = `examples/debate.yaml`** (`src/index.ts`) — when `--config` is
  omitted, the example now loads by default (module-relative), falling back to the
  built-in `claude+codex` lineup only if the file is absent. Fixes a real footgun: a
  no-config run used to silently ignore the example's configured `model`/`effort`. Note:
  no-config runs now also spend tokens on the example's Opus respondeo turn.
- **Tests** — +9 (`test/config.test.ts`: judge-block parsing, unknown-key line numbers,
  absence, the shipped example's judge, block-closing; `test/debate.test.ts`: judge runs
  after reactions over a clean context, recorded in turns + transcript, absent when no
  judge arg, NEEDS_INPUT surfaced, failing judge non-fatal). Suite now 42 tests, no real
  agent calls. `--doctor` end-to-end confirmed the three-CLI lineup (incl. Opus) healthy.

## [0.0.6] — Per-participant reasoning `effort` in `debate.yaml`

- **Per-participant `effort`** (`src/config.ts`, `src/adapters.ts`, `src/index.ts`) — a
  new optional `effort` key on each participant doses token/time spend per turn, mapped
  to each CLI's real mechanism: `claude` → native `--effort` (`low|medium|high|xhigh|max`);
  `codex` → config override `-c model_reasoning_effort="…"` (`minimal|low|medium|high`),
  since codex has no dedicated flag; `agy` has NO effort control (effort is baked into
  the model name, e.g. `(High)`), so `index.ts` warns and ignores it. Verified against
  the installed CLIs (`claude --help`, `codex exec --help`) on 2026-06-17.
- **Free-form, version-agnostic** — `effort` is passed through to the CLI as-is; the
  parser does NOT hard-code the allowed values (the CLI validates them, and bad values
  surface in the raw capture / `--doctor`), so it can't drift out of sync with CLI
  versions.
- **Tests** — `test/config.test.ts` parses per-participant `effort`;
  `test/adapters.test.ts` asserts `claude` receives `--effort high` (and nothing when
  unset) and `codex` receives the `model_reasoning_effort="high"` override (and nothing
  when unset), via a new `FAKE_ARGV_FILE` capture in the fake CLI shims.
- **Docs** — `examples/debate.yaml`, `README.md`, and `CLAUDE.md` document the per-CLI
  effort mapping and that agy has no effort key.

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
