# Disputatio: Implementation Plan

> The bridge from concept to code. Builds on `1_IDEA.md` (vision), `2_CONCEPT.md`
> (the *disputatio* protocol, roles, executable evidence, convergence),
> `3_ADAPTERS.md` (the headless-integration design grounded in `../research/`), and
> `5_METRICS.md` (the protocol KPIs that instrument a run).
>
> Scope of this document: the **MVP** — debate over a text artifact or a real
> repository, no repository mutation, no UI, whose job is to **validate the premise**
> that cross-vendor debate beats a single strong agent. Everything past that is
> sketched, not specified.
>
> **This document describes what is TRUE TODAY.** It was refreshed on 2026-08-03
> because it had drifted badly: it still specified a stack and a module hierarchy the
> MVP deliberately never built, while the code had shipped several things this plan
> filed under "M3"/"Later". §11 is the single status table; if any other section
> contradicts it, §11 wins and the other section is a bug.

---

## 0. The fixed goal

Everything below serves one sentence:

> **Cross-vendor adversarial review, grounded in independently gathered executable
> evidence, catches material risks that a strong single-agent review misses.**

This is deliberately **narrower** than `2_CONCEPT.md` §2's premise ("a debate across
diverse harnesses produces *better decisions* than a single strong agent"). "Better
decisions" is not measurable without a decision oracle. "Catches material risks a
strong single-agent review misses" **is** measurable: you can enumerate the risks each
condition surfaced and check them. The narrowing is the point — it converts the premise
into something the M2 gate can actually pass or fail.

Three consequences that ripple through the whole document:

1. **The moat is executable evidence, not "more voices."** A second opinion is cheap
   and already available to any user via a web chat. Independently *gathered* evidence
   (each agent reads the repo and runs read-only commands in its own isolated
   worktree) is what no API-level multi-agent framework reproduces easily.
2. **Missed-risk surfacing is the primary metric** (§8), not blind preference.
3. **Anything that makes the gate unmeasurable is deferred**, however attractive —
   see the `humanloop` exclusion (§6) and the meta-orchestrator verdict (§11).

---

## 1. Stack & rationale (as built)

**Language: TypeScript. Runtime: Node ≥ 24. Runtime dependencies: zero.**

| Choice | Why |
| --- | --- |
| **TypeScript** | The author of the code is an AI; the human supervises by *reading*. The user reads TS fluently, so review is effective from day one. A real type system is the safety net that catches the AI's mistakes the high-level reviewer won't — decisive for an adapter layer full of failure modes. |
| **Node ≥ 24** (native TS type-stripping) | Runs `.ts` directly with **no build step** in the daily loop (`node src/index.ts`, `npm test` on `.ts` files). `.tool-versions` pins `nodejs 24.16.0`. |
| **`esbuild`, publishing only** | `npm run build` bundles to `dist/index.js` via the `prepack` hook. **Not optional:** Node refuses to type-strip `.ts` under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the published `bin` must be the bundle. `devDependency` only. |
| **`node:child_process`** (subprocess) | `runCli` in `src/adapters.ts`: separate stdout/stderr capture, `stdio:["ignore",…]`, wall-clock timeout, **process-group** kill. |
| **Hand-written classifiers + a minimal YAML subset** (`src/config.ts`) | Strict, line-numbered config errors; no parser to keep in sync with a dependency. |
| **Flags on a single entry point** (`src/index.ts`) | The whole CLI surface is one arg loop (§9). |
| **`node:test`** | Built-in runner, fixtures captured from real runs + fake CLI shims in `test/fakes/`. |

**Recorded deviation from the original plan (why the dependencies went away).** The
first version of this section specified **Bun** (for `bun build --compile` single
binaries and `bun test`), **`execa`**, **`zod`**, and **`citty`**. None of them shipped,
and the reasoning is worth keeping rather than erasing:

- **Bun → Node 24.** Node's native type-stripping delivered the same buildless loop
  without a second runtime, and `npm` distribution turned out to be the right
  packaging (an `npm install -g` reaches every user; a compiled binary needs a release
  pipeline nobody had). Standalone binaries remain possible later and are not needed now.
- **`execa` → `node:child_process`.** The subprocess needs turned out to be *more*
  specific than `execa` covers, not less: the one bug that actually bit was a leaked
  worker holding the stdout pipe open, fixed by `detached:true` + signalling `-pid`.
  Hand-rolling that was clearer than layering it on a wrapper.
- **`zod` → hand-written classifiers.** The parsing that matters is per-CLI output
  classification, and every one of those decisions is a structural check on a specific
  field (`is_error`, `turn.completed`, `result.exitCode`) — not schema validation. A
  schema library would have validated the shape while leaving the actual judgement calls
  exactly as hand-written as they are now.
- **`citty` → a plain arg loop.** The surface stayed small enough (§9) that a dependency
  would have been the larger cost.

The result — **zero runtime dependencies** — is what made these drops worth it: nothing
to audit, nothing to update, no supply-chain surface in a tool that runs against private
repositories.

**Design invariants carried from the concept (non-negotiable, all still hold):**

1. **Markdown is the source of truth; the orchestrator owns memory.** Agents are
   invoked **statelessly** — pure functions of `(task, curated state)`. No `--resume`.
2. **Raw prose is the source of truth; any structured index is only an index.** The
   `respondeo` reads verbatim prose.
3. **No native schema-constraint on debaters** (`--json-schema` / `--output-schema`) —
   it flattens the free-form reasoning. (In practice no schema-constraint is used
   anywhere yet; see §7.)
4. **Backends MUST span model families** for premise validation, or false consensus is
   baked in: `claude`→Anthropic, `codex`→OpenAI, `agy`→Google/Gemini, `pi`→multi-LLM
   harness, `copilot-cli`→GitHub Copilot. `src/index.ts` warns when the lineup is not
   all-distinct `vendor`s.

---

## 2. Architecture & modules (as built)

The MVP is **seven files**, not the module tree this section used to specify:

```
src/
├── index.ts       # CLI entry (shebang; npm bin runs the bundled dist/index.js).
│                  # Arg parsing, quaestio resolution, config resolution, lineup
│                  # building, cross-vendor check, artifact writing, exit codes.
│                  # --doctor / --init / --continue / --finalize branch here.
├── quaestio.ts    # pure quaestio-input resolution (inline positional vs --file)
├── install.ts     # config resolution precedence + the --init setup phase
├── doctor.ts      # preflight: canary every participant through its own classifier
├── config.ts      # debate.yaml parse + serialize (minimal YAML subset, no deps)
├── adapters.ts    # TRANSPORT: spawn a CLI, capture output, classify ok/failure
└── debate.ts      # ORCHESTRATION: proposals → reactions → respondeo → redactio
test/
├── fakes/         # fake CLI shims per adapter (offline, deterministic)
└── fixtures/      # outputs captured from real runs
```

Data flow: `index` builds `Participant[]` → `runDebate` → per-turn `runIsolated` (temp
dir, or a throwaway git worktree in repo mode) → `Participant.run` → `runCli` (spawn).
Results accumulate into a transcript string + per-turn `Turn[]` records.

**What survived from the original design:** the dependency arrow points **down** and the
**anti-corruption boundary holds** — `debate.ts` never learns which vendor it is talking
to; every CLI quirk is hidden behind `Participant` (`{ id, display, vendor, run }`).
That was the load-bearing idea, and it is intact.

**What was planned and does NOT exist** (stated so this section stops implying it does):

| Planned module | Status | Where its job lives today |
| --- | --- | --- |
| `transport/jsonl.ts` | not built | inline in each adapter's classifier |
| `normalize/` (trailer, extraction) | **not built** | nothing normalizes; prose is used as-is (§5) |
| `contract/` (zod schemas) | not built | the `AgentResult` union in `src/adapters.ts` |
| `engine/phases.ts`, `convergence.ts` | not built as modules | `runDebate` in `src/debate.ts` |
| `engine/respondeo.ts` | **shipped, different home** | `runDebate` + `runFinalize` in `src/debate.ts` |
| `engine/humanloop.ts` | not built (deliberate, §6) | `--continue` is the manual stand-in |
| `state/store.ts`, `state.json` | **not built** | nothing; the run lives in memory (§3) |
| `prompts/` | not built as a layer | prompt builders are top-level consts in `debate.ts` |
| `eval/` (premise harness) | **not built — this is the P0** | §8 specifies it; nothing implements it |

Flattening to seven files was the right call for an MVP and should not be treated as
debt to repay reflexively. Extract a module when a second caller or a real test seam
demands it (`quaestio.ts` was extracted exactly that way), not to match this table.

---

## 3. Domain model & data

### `.debate/` on-disk layout — as built

```txt
.debate/debate-<timestamp>/
├── debate.md            # the full transcript: task, proposals, reactions, respondeo
├── respondeo.md         # the judge's ruling ON the debate
├── respondeo-2.md …     # --continue versions the verdict; highest number is current
├── final-report.md      # the REDACTIO: the deliverable born FROM the debate
└── raw/                 # per-turn raw CLI captures — the only way to diagnose a turn
```

**Not built:** `task.md`, `config.yaml`, `state.json`, `rounds/`, `contributions/`. The
original layout separated a human-readable record from a machine-readable index; today
there is only the record. Two consequences, both real:

- **`state.json` was the resumable spine** — `{ debateId, phase, status, openQuestions[],
  participants[], roundsCompleted }` plus per-run provenance (bin path, version, argv,
  model, exit code, cost). Without it there is **no crash-resume**: `runDebate`
  accumulates in memory and `index.ts` writes at the end, so a mid-debate crash loses
  the run. It is also where §5's contribution index and `5_METRICS.md`'s Tier-0 metrics
  would naturally land — one artifact, three motivations, still unbuilt.
- **`contributions/`** presupposes the normalization layer (§5), also unbuilt.

### The shipped contract

`src/adapters.ts` — this is the real type, and it is deliberately smaller than the
`AgentOutcome` union this section used to sketch:

```ts
export type AgentResult =
  | { ok: true;  text: string; costUsd?: number; raw?: CliCapture }
  | { ok: false; error: string; budgetExhausted?: true; raw?: CliCapture };
```

The planned six-way discriminated union (`api_error` / `timeout` / `no_final_message` /
`spawn_error` / `nonzero_exit`) collapsed into `ok:false` + a human-readable `error`
string, with the raw capture attached for diagnosis. That was the right MVP trade —
every failure mode ends in the same place (record it, keep going or abort) — but note
what it costs: **failure modes are not machine-classifiable**, so the per-adapter
failure-rate KPI (`5_METRICS.md`) can only separate *setup* failure from *agent* failure
by string-matching the error today. A structured `kind` field is the natural fix when
that metric gets built.

The richer target shapes (`DebateContribution`, the adapter manifest) remain **sketches,
not code**. They belong to §5 and are only worth building when something consumes
them — which `5_METRICS.md` Tier-1 finally provides.

---

## 4. Transport layer (the risky core)

The one place all per-CLI difference lives (`src/adapters.ts`). Output: a uniform
`CliCapture { stdout, stderr, code }` classified into `AgentResult`.

Hard rules — every one canaried in `../research/`, several learned from a run that broke:

- **`stdio: ["ignore", "pipe", "pipe"]`** on every spawn. Codex hangs waiting for stdin
  EOF otherwise. Do not switch to inheriting or piping stdin.
- **Capture stdout and stderr separately** (codex reports progress on stderr).
- **Wall-clock timeout** per call (`DEFAULT_TIMEOUT_MS` = 10 min), and on expiry
  **kill the process GROUP, not the child**: `detached:true` makes the child a group
  leader, then `SIGTERM` to `-pid`, escalating to `SIGKILL` after `KILL_GRACE_MS`
  (2 s). A real run (2026-06-12) hung ~45 min at ~0 CPU because killing only the direct
  child left an orphaned worker holding the stdout pipe open, so `close` never fired.
  Regression test: `test/adapters.test.ts` "leaked worker holding the pipe".
- **Classify success from BOTH the exit code AND the in-band signal** — never one alone:
  - `claude`: `code === 0 && json.is_error === false` (⚠️ **ignore `subtype`** — it stays
    `"success"` on error). Read `errors[]` **first** for the message: budget-exhaustion
    envelopes have no `result` string.
  - `codex`: `code === 0 && saw turn.completed && no error/turn.failed`; answer = the
    **last** `agent_message`. No `costUsd` under ChatGPT-account auth (tokens, not dollars).
  - `agy`: `code === 0 && stdout non-empty` (text-only; trimmed stdout *is* the answer).
  - `pi`: `--mode json` event stream; answer = last assistant `message_end`; failures in
    `auto_retry_end.finalError`.
  - `copilot-cli`: `--output-format json` JSONL; `result.exitCode` + last
    `assistant.message`.
- **Read-only evidence is per-CLI, and so is effort** — see `CLAUDE.md`'s invariants for
  the exact per-CLI mapping. There is no uniform flag for either; pretending otherwise is
  how a sandbox silently stops being read-only.
- **Exit 126/127 is a setup failure, not an agent failure** (stale asdf shims shadow real
  binaries; `codex` needs an explicit `bin:`). The hint lives in `spawnFailure`.

**`--doctor` (as built, `src/doctor.ts`)** canaries each participant with a trivial
"pong" run **through the same classifiers** a debate uses, so a green doctor means the
real path works. Success is `r.ok`, never a text match; failures carry the raw error.

**Not built:** the planned **version-drift check** (resolve the installed binary's
version against a `testedVersions` field and fail loudly on drift). This was motivated by
`agy` self-updating 1.0.4→1.0.5 mid-investigation — a real hazard that is currently
undetected. Also unbuilt: **per-run provenance recording**, which has nowhere to go
without `state.json` (§3).

---

## 5. Normalization layer — NOT BUILT

Planned: turn `text` into a `DebateContribution` via a three-level contract —
**A** native JSON envelope (transport only), **B** a self-emitted fenced
` ```disputatio ` YAML trailer parsed deterministically (the primary, works even for
text-only `agy`), **C** cheap-LLM extraction as a last resort, flagged in metadata so a
smoothed objection is never silent.

**Only level A shipped** (as transport classification, §4). Levels B and C do not exist:
today the debate passes **verbatim prose** between phases and the judge reads prose. That
is fully consistent with invariant 2 and cost nothing to skip — the phases work.

**What skipping it actually costs, and why it is now earnable.** Without a structured
index there is no *claim ledger*, so nothing can count objections, detect duplicates, or
tell a genuinely new objection from a restatement. That was an acceptable gap while the
trailer was speculative architecture. It stops being acceptable the moment the protocol
needs to be **measured**: the trailer is exactly the **Tier-1 prerequisite** in
[`5_METRICS.md`](./5_METRICS.md). It should be built **when and because** those metrics
are built — driven by a consumer, not by this document's original ambition.

---

## 6. Debate engine

As built (`src/debate.ts`), a run is:

```
quaestio
  → Round 1   proposals (videtur quod)   all propose independently, in parallel,
  │                                      each isolated so no one peeks. <2 ok → ABORT.
  → Rounds 2…N reactions (sed contra)    each agent reacts adversarially to the full
  │                                      transcript snapshot, evidence encouraged
  → respondeo (consolidatio)             judge rules, or returns NEEDS_INPUT
  → redactio                             judge synthesizes the deliverable (RESOLVED only)
```

- **Statelessness holds:** each turn builds a fresh prompt from the curated transcript;
  no agent carries session memory.
- **Isolation is a correctness requirement, not hygiene:** temp dir always, and a
  **detached throwaway git worktree of HEAD** in repo mode. Without the temp dir, agentic
  CLIs read sibling files and contaminate the debate (`../research/pre-m0-handrun.md`);
  without the worktree, evidence commands write logs and test state into the target repo.
- **Convergence, as built:** the judge emits a mandatory first `STATUS:` line, parsed by
  `parseRespondeoStatus`. `NEEDS_INPUT` + a `## Quaestiones (for the human)` list is the
  honest-escalation path — the judge must **ask rather than invent a verdict**. There is
  no separate `convergence.ts`, no numeric open-question tracking, and no automatic
  stopping rule: `--rounds N` is fixed by the caller. (An evidence-based stopping rule is
  precisely the *efficiency* KPI in `5_METRICS.md` — new-objection yield per round.)

**Two pieces are excluded from the gate path on purpose, and both remain excluded:**

- **`humanloop` (mid-debate clarification + arbitration) is built AFTER the gate.** If a
  human can clarify or arbitrate mid-debate, the gate stops measuring "debate vs single
  agent" and starts measuring "debate + human vs single agent" — the measurement is
  contaminated. The M1→M2 path must run **unattended**. This removes it from the *gate*,
  not from the *product*; `--continue` is the deliberately weaker stand-in (it acts
  *after* a verdict, not inside the debate).
- **`consolidatio` (merging N proposals into one object the skeptics attack) is
  degenerate at N=2** and earns its complexity only at N≥3. **Deferred post-gate** — see
  §11 and §12, which now agree with this section.

So the **gate path** is: `proposals → reactions → respondeo`, unattended, 2 cross-vendor
agents, with executable evidence. It exercises the real differentiator. The fuller
protocol in `2_CONCEPT.md` §3 is the *product*, built once the premise holds.

---

## 7. Respondeo & redactio (both shipped)

- **Respondeo** (`respondeoPrompt`, `src/debate.ts`) — the judge (an opus judge is
  seeded by `--init`) reads the **verbatim transcript** and produces `respondeo.md`:
  the settled agreements, then a ruling on each contested point, **preferring positions
  backed by executable evidence over rhetoric**. Transcript-only **by invariant** — no
  repo access even in repo mode — because a judge that can go gather its own evidence
  becomes a participant, and the ruling stops being a ruling on *the debate*.
- **Redactio** (`runFinalize`) — a phase the original plan did not contain at all,
  added because real use exposed the gap: `respondeo.md` holds the ruling **on** the
  debate, not the work-product born **from** it, so it lacked what you need to start
  working. On a RESOLVED respondeo the judge switches role to **synthesizer** and writes
  `final-report.md`: the actual deliverable (plan, review, proposal…), self-contained,
  built from the settled decisions. Repo-grounded when the debate ran with `--repo`.
- **Continuation** (`runContinuation`, `--continue`) — after a NEEDS_INPUT verdict the
  human answers and the judge re-rules, versioning the verdict. If the answers open
  ground the debaters never argued, it returns NEEDS_INPUT again rather than inventing a
  verdict — that is the signal a fresh reaction round is needed (§11, deferred).
- **Native schema-constraint was never used.** The plan reserved `--json-schema` for the
  determination; in practice a mandatory `STATUS:` first line parsed by
  `parseRespondeoStatus` proved sufficient and kept the verdict readable prose. Keep it
  that way unless a real consumer needs a rigid object.
- **Budget:** judge/synthesizer turns carry a per-turn cap (default **$5**, overridable
  with `--budget`) after real runs exhausted $1 and then $2. `agy` has no cap flag at all.

---

## 8. The premise-validation gate (M2) — the P0, NOT STARTED

Per §0 and `2_CONCEPT.md` §2, the premise is unproven and the project is pointless if the
delta is absent. This is a **gate**, not a feature — the riskiest, load-bearing
measurement in the plan, and the only milestone whose absence actually matters.

**Pre-M0 finding (recorded faithfully, 2026-06).** The cheap discriminating question was
asked. Answer: in the user's manual rounds, later agents **confirm** the decision, they
do not change it — because the user front-loads the call with a first agent plus an
upfront web-UI brainstorm, and only debates *implementation* by hand (design-stage debate
is too laborious manually). By the pre-registered rule, "confirm" **leans against** the
big-bet premise ("debate → better decisions") and toward the smaller proposition
("automate manual effort"). The manual cost is a real **confound** — but only a partial
one: the user already has cheap extra perspectives at the design stage and *still*
converges early. So the prior goes **down** and "automate effort" rises relative to
"better decisions." This is leans-negative-but-confounded, **not** encouraging.

**Why the goal in §0 is the hypothesis that survives it.** The user's
brainstorm-then-confirm flow is single-model multi-turn reasoning with **no
executable-evidence grounding**. The one thing their experience has never tested is
Disputatio's actual moat: adversarial objections backed by **running the code**. §0 is
that hypothesis, stated so it can fail.

### Corpus: review tasks first, plan/design second (decided 2026-08-03)

| | Primary corpus | Secondary probe |
| --- | --- | --- |
| **Tasks** | 5–10 real diffs / branches / PRs whose outcome is now **known** (a bug that later surfaced, a review comment that mattered, an incident traced to a merged change) | 3–5 plan/design tasks, the original corpus |
| **Why** | Matches §0's wording, and largely **dissolves the scoring problem**: "was the flagged risk real?" has an answer outside the debate. Also lets executable evidence actually run against the code under test — the moat is exercised, not simulated | Checks whether the moat generalizes beyond code review, where ground truth is unavailable and scoring stays subjective |
| **Ground truth** | **Partial but real** — retrospect adjudicates | None |

This reordering is why the gate is now scoreable at all. The original corpus (plan/design
only) forced the scoring protocol to carry the entire burden of a missing oracle.

### Conditions — and what the gate therefore isolates

Three arms. The middle one is the comparator that matters, and getting it wrong is the
easiest way to produce a confidently meaningless result.

| Arm | What it is | Role |
| --- | --- | --- |
| **A0** | Single agent, **no repo/tool access**, brainstorm + self-critique — mirrors the user's actual status quo (§ pre-M0 finding) | Cheap **reference point**, not the comparator |
| **A1** | Single agent, **fully matched to B**: same HEAD worktree, same read-only tool allowlist, same "gather executable evidence" instruction, self-critique, comparable token/call budget | **The primary comparator** |
| **B** | Disputatio, unattended gate path (§6), cross-vendor, comparable-tier lineup | The treatment |

**Why A1 must be tool-armed** — this follows from the plan's own rule, not a new one.
§8 already forbids a strawman baseline, and a *strong* single-agent code review in 2026
has tool access natively. An A without repo access is therefore not a matched baseline;
it is the strawman, wearing the word "strong."

**So write down what the gate actually measures.** With A1 matched, the isolated factor is
**cross-vendor adversarial review (F1), holding executable evidence (F2) constant.** Note
that §0's goal sentence bundles F1 and F2, which reads as though evidence is the
differentiator — under matched-A it is a property of *both* arms. A0 exists precisely to
decompose them.

**Pre-registered interpretation rule (fix this now, before any data exists):**

| Observed | Honest conclusion |
| --- | --- |
| B ≫ A1 | **The premise holds.** Cross-vendor adversarial review adds risk-catching power on top of an evidence-armed single agent. |
| B ≈ A1, and A1 ≫ A0 | **The moat is tool-armed review, not debate.** A real, valuable, *much cheaper* finding: ship a single evidence-armed reviewer and delete the debate. |
| B ≈ A1 ≈ A0 | Neither debate nor evidence pays off on this corpus. Stop. |
| B < A1 | Debate actively hurts — most likely via the amplification path (`5_METRICS.md` §3.1). Diagnose with the KPIs before concluding. |

Pre-registering this matters because the second row is the outcome most likely to be
re-narrated after the fact ("well, debate still helped somewhat"). It is a **success** for
the user and a **failure** for the debate premise, and it must be allowed to say so.

**Budget parity, recorded:** A1 gets a token/call budget comparable to B's *total* across
all participants and rounds — otherwise a B win may be bought with compute rather than
with adversarial structure. Record actual spend per arm (`5_METRICS.md` §4); an unmatched
budget makes the trial descriptive, not comparative.

**Model-strength parity is mandatory:** comparable tiers across vendors (e.g. Sonnet vs
GPT-5.x vs Gemini Pro — *not* Sonnet vs Flash). A weaker second debater stacks the deck
against debate: its objections are shallower, and a null result then means "the cheap
model is weak," not "debate doesn't help." Pin the lineup in the eval's `debate.yaml`,
and use the **same model** for A1 as B's strongest debater.

### The evidence precondition — and whether it is enforceable

Condition B is only exercising the moat if the debate **actually ran commands**. Today the
orchestrator merely *encourages* evidence in prose (`reactPrompt` in `src/debate.ts`);
there is no verifier phase and no evidence ledger, so **a zero-execution debate succeeds
and looks identical to a grounded one.** That is a hole in the treatment, not a
documentation nit: it would let the gate "test" the moat without the moat present.

**Rule: a B run in which no participant executed a command is VOID, not failed** — excluded
and re-run, the same way a trial with a broken instrument is excluded. Record the void rate;
a high one is itself a finding (the prompt does not reliably induce evidence gathering).

**How much of that is checkable today** (verified against a real repo-grounded capture,
2026-06-12, structure only):

| Adapter | Evidence-execution signal in the raw capture | Verdict |
| --- | --- | --- |
| `codex` | `item.completed` items of type **`command_execution`** — a real turn carried 26 | **Directly countable now** |
| `claude` | Envelope is a *summary*: no tool log. `num_turns > 1` (a repo-grounded turn showed 5) and `permission_denials` are usable **proxies**; a real log needs `--output-format stream-json` | Proxy only |
| `agy` | Plain text, nothing | Not checkable |
| `pi`, `copilot-cli` | Event streams expose tool/session events; **unverified** for real evidence-gathering runs | Unknown |

**Therefore, two cheap decisions:** (1) **pin the M2 lineup to adapters whose captures
prove execution** — with `codex` in the lineup the validity check is available immediately,
with no claim ledger and no new phase; (2) treat the full per-objection accounting
(*which* objection rests on *which* command) as Tier-1 work (`5_METRICS.md` §5). The
run-level check is the one the gate actually needs, and it exists.

### Scoring protocol (non-circular)

Plan/design artifacts have no objective reference, and **an LLM judge reintroduces the
very sycophancy the gate exists to detect**. So:

- **Metric 1 — missed-risk surfacing (PRIMARY), scored as a PAIR.** Regardless of whether
  the headline decision changed: *did the arm surface a risk / objection / **failing test**
  the other missed, and was it material?* On the review corpus this is checkable against
  what actually happened. This metric **is** the goal in §0 restated as a measurement —
  but it must be scored as two numbers, never one:
  - **1a — true material risks found** (the numerator everyone remembers).
  - **1b — adjudicated false alarms**, and **precision** = 1a ÷ (1a + 1b).
  - ⚠️ **Without 1b the metric rewards shotgun reviewing.** An arm that lists twenty
    speculative concerns will "catch more risks" than a careful one, and a debate is
    structurally prone to exactly that — each participant is prompted to find flaws, and
    the judge sees volume as thoroughness. A gate that passes on 1a alone would be
    measuring verbosity. **A B win requires 1a up without precision materially down.**
  - **Negative controls are part of the corpus, not an extra:** include 2–3 changes with
    **no material risk** (clean, well-tested, later uneventful). The correct output is "no
    material risk found." An arm that manufactures findings there is penalized, and this
    is the only part of the design that can detect a confidently-wrong debate.
- **Blinding applies to Metric 1 too** — it is now the primary metric, so it carries the
  primary bias risk. Adjudicating "was this risk material?" while knowing which arm
  produced it is precisely the bias that excluding LLM judges was meant to avoid.
  Concretely: **pre-register the materiality rubric and the false-alarm rule before
  running**; then **pool all arms' findings**, strip attribution, randomize order, and
  adjudicate **source-blind** — with the adjudicator **not told which corpus items are
  negative controls**.
- **Metric 2 — blind A/B preference (SECONDARY, directional).** Two outputs side by
  side, labels stripped, order randomized; the human records which they would rather
  execute **before** labels are revealed. Win-rate of B over A.
  - ⚠️ Kept as secondary on purpose: if debate *confirms* the decision (as the pre-M0
    finding predicts), this metric lands ~50/50 and reads as "no value" **even when
    debate surfaced a material risk worth seeing.** It informs; it does not decide.
  - *(Earlier versions of this plan had these two metrics in the opposite order, while
    also warning that Metric 1-as-then-ordered would false-negative the gate. §0 resolves
    the contradiction: the primary metric must be the one that measures the stated goal.)*
- **No LLM as the deciding judge.** An LLM may pre-extract claim lists for the human to
  check; both verdicts are the human's.
- **KPIs are instrumentation, never the verdict.** `5_METRICS.md`'s process metrics
  explain *why* a result came out as it did (did the debate merely agree? did round 2 add
  anything?) and they are what makes a null result diagnosable instead of just
  disappointing. They do not score the gate. See that document's anti-circularity rule.
- **Output:** a verdict — *where* (which task types) the moat pays off, or that it
  doesn't (a valid, money-saving finding).
- **Pre-registered honesty about power:** ~10 review tasks plus controls, three arms. That
  is enough to see a **large** effect and nowhere near enough for statistical
  significance. The gate's output is **directional**, and 6/10 vs 4/10 must not be read as
  a win. Decide the effect size worth acting on *before* looking (e.g. "B must find a
  material risk A1 missed on at least half the tasks, at no worse precision"), and if the
  result lands inside the noise, the honest report is "inconclusive at this sample size" —
  which is a legitimate outcome and still worth the money.

**Cost budget (real).** One debate is dozens of frontier-agent calls. A single
repo-grounded turn cost **$0.91** (2026-06-11), judge turns exhausted $1 then $2 (the cap
is now $5), and **`agy` has no spend cap at all** — budget control is per-vendor
asymmetric. M2 = that matrix × 8–15 tasks × 2 conditions, re-run during development. Cap
per-turn spend, reuse the prompt cache within its TTL, prefer cheap models where the phase
allows. Budget the eval explicitly: cost bites precisely at the gate.

**Prerequisites, both cheap** (`5_METRICS.md` §8): the **evidence-validity check** — without
it a run cannot be shown to have exercised the moat at all, so condition B is unverified —
and **Tier-0 metrics**, without which a gate run produces a verdict with no explanation
attached and a null result cannot be diagnosed.

---

## 9. CLI surface (as built)

The surface landed as **flags on one entry point**, not subcommands:

```bash
disputatio "<quaestio>" [--rounds N] [--repo path] [--config debate.yaml]
disputatio --file <task.md> [--rounds N] [--repo path] [--config debate.yaml]
disputatio --continue "<answers>" [--debate <dir>] [--repo path] [--config debate.yaml]
disputatio --finalize [--debate <dir>] [--repo path] [--budget <usd>]
disputatio --doctor [--config debate.yaml]
disputatio --init [--config debate.yaml] [--force]
```

`--budget` overrides the judge/synthesizer per-turn cap. **`resume` does not exist** —
crash-resume needs `state.json` (§3, §11); `--continue` is a *workflow* step (the human
answers a verdict's questions), not crash recovery. The two are often conflated; they are
different features.

**Agent-native parity** (a project value, upheld): **stdout is the artifact path only**
— the deliverable when one exists, else the transcript — and everything else goes to
stderr, so another agent can drive Disputatio and consume its output. Exit 1 on abort.

---

## 10. Testing strategy

As built, and matching the plan closely:

- **Unit (fast, offline):** the classifiers are the highest-risk code and are tested
  against **fixtures captured from real runs** (`test/fixtures/`), including the
  "`subtype` lies on error" regression, budget-exhaustion envelopes, and the read-only /
  effort / `bin`-override flag surfaces per adapter.
- **Fake CLI shims** (`test/fakes/`, one per adapter) emulate each framing (envelope /
  JSONL / raw text) and on demand hang (timeout + leaked-worker test) or exit non-zero.
  The whole orchestration runs deterministically offline.
- **Build regression** (`test/build.test.ts`): the bundle must keep exactly one shebang.
- **Smoke:** the real "pong" canaries, run by `--doctor`.
- **Real debate runs remain the integration test**, captured in `../research/real-run-*`.

Per repo policy, changes to `src/` are TDD'd: failing test first, minimum code, refactor.

---

## 11. Status

Replaces the old milestone table. **Three buckets only.** "Validating now" means a
measurement is actually running — an item may not sit there because work is *planned*.

### Shipped

| Capability | Evidence |
| --- | --- |
| Transport + classifiers, group-kill timeout | `src/adapters.ts`, `test/adapters.test.ts` |
| Five adapters: `claude`, `codex`, `agy`, `pi`, `copilot-cli` | `src/adapters.ts`, `../research/*-headless.md` |
| `--doctor` preflight through real classifiers | `src/doctor.ts` |
| `--init` + config resolution precedence | `src/install.ts`, `src/config.ts` |
| Isolation: temp dir + detached throwaway worktree | `src/debate.ts` `runIsolated` |
| Proposals + N reaction rounds; **<2-proposal abort** | `src/debate.ts`, `../research/real-run-2026-06-11-*` |
| Respondeo (verdict, incl. NEEDS_INPUT escalation) | `src/debate.ts` `respondeoPrompt` |
| Redactio (`final-report.md`, repo-groundable) | `src/debate.ts` `runFinalize` |
| `--continue` (re-judge + versioned verdicts), `--finalize` | `src/index.ts` |
| Per-turn raw captures | `.debate/*/raw/` |
| Offline test suite; npm packaging (`prepack` → `dist/`) | `test/`, `package.json` |

**M0 is complete:** the transport round-trips with correct classification and `doctor`
reports status.

**M1 is complete as a phase sequence, but NOT as the gate treatment.** A cross-vendor
lineup does run proposals → reactions → respondeo unattended and produce a deliverable.
What is missing is the part §8's condition B depends on: **the tool cannot enforce, or even
report, that any executable evidence was gathered.** Evidence is encouraged in prose
(`reactPrompt`), there is no verifier phase and no evidence ledger, so a zero-execution
debate succeeds and is indistinguishable from a grounded one. Until a run-level
execution check exists (§8 — cheap, and available today for `codex`), "M1 runs the gate
path" overstates it: it runs the *phases* of the gate path. Nothing above required the
premise to be true.

### Deviations, recorded honestly

Almost everything in the Shipped table arrived **out of roadmap order** — pulled forward
from "M3", "post-gate", or "Later" while the gate itself never ran. Each had a local
reason; the pattern is the problem, and naming it is the point of this subsection.

| What | When | Why it was pulled forward |
| --- | --- | --- |
| `codex` adapter (was M3) | 2026-06-11 | Repo-grounded runs need an explicit, policy-appropriate lineup; `agy` is not usable on every repository. Default became `claude+codex`. |
| Worktree isolation (was "Later") | 2026-06-11 | Not a feature — a **bug fix**. Evidence commands wrote logs and test state into the target repo. |
| <2-proposal abort, per-turn raw captures, config file, first offline test suite | 2026-06-11 | Hardening of the M1 gate path after a real run: a one-voice "debate" was silently producing plausible artifacts, and failed turns were undiagnosable. |
| Process-**group** kill on timeout | 2026-06-12 | A run hung ~45 min at ~0 CPU (orphaned worker holding the stdout pipe). Also a bug fix. |
| **Respondeo** (was M1-ish, judged fine) | — | Without a verdict the transcript is homework, not an answer. Legitimately on the gate path. |
| **Redactio** (never in the plan at all) | 2026-06-27 | Real use exposed the gap: the verdict is a ruling *on* the debate, not the deliverable born *from* it. Product value, not premise value. |
| `--continue` / `--finalize` | 2026-06-27 | Close the loop after NEEDS_INPUT without re-running a whole debate. Product plumbing. |
| npm packaging (`prepack` → `dist/`) | — | Distribution. Product plumbing. |
| `pi` adapter | 2026-06 | Adapter breadth. **Not needed by the gate** — the gate needs two comparable-tier cross-vendor agents, which already existed. |
| `copilot-cli` adapter | 2026-07 | Same. |

**None of it advanced the premise.** Adapters four and five, the deliverable phase, the
continuation flow, and packaging all made Disputatio a better *product* while the single
question that decides whether the product is worth having stayed unanswered. The bug fixes
were mandatory and the respondeo/redactio work was arguably earned by real use — but
adapter breadth in particular is the clearest case of building sideways instead of
forward, and it is why §8 is now labelled the P0 rather than one milestone among several.

### Validating now

| Item | State |
| --- | --- |
| Dogfooding on real tasks | Ongoing, informally. Three captured runs: `../research/real-run-2026-06-11-repo-grounded.md`, `real-run-2026-06-12-ilovecoding-v0.9.md`, `real-run-2026-06-23-phrase-removal-anonymized.md`. These are **bug-finding and workflow evidence, not premise evidence** — no baseline condition, no scoring protocol. |

That is the whole bucket, and it should stay small. Listing planned work as "validating"
is the exact failure this refresh exists to correct.

### Deferred pending evidence

| # | Item | Blocked on / why deferred |
| --- | --- | --- |
| **P0** | **M2 premise-validation gate** (§8) | **NOT STARTED.** Every other row waits behind it. Two real prerequisites, both in P1: the evidence-validity check (without it condition B cannot be shown to have exercised the moat) and Tier-0 KPIs (without them a null result is undiagnosable). |
| **P1** | **Evidence-validity check + Tier-0 KPI instrumentation** (`5_METRICS.md` §8) | **Gate-blocking, and small.** Needs real code: per-turn timings and `promptBytes` are not recorded, and nothing counts executed commands — though codex's raw capture already carries `command_execution` items, so the check is cheap. **Next increment.** |
| P2 | Tier-1 KPIs + the `disputatio` trailer / normalization layer (§5) | Needs a claim ledger; design work + extra per-debate calls. Do it when Tier-1 metrics are wanted, not before. |
| P3 | `state.json` + crash-resume, per-run provenance, version-drift check (§3, §4) | One artifact serves all three. Painful only on long runs so far. |
| P4 | `--continue` **re-debate** path (re-engage debaters with human input) | Today `--continue` re-judges alone and honestly says so by returning NEEDS_INPUT again. |
| P5 | `consolidatio` (pre-debate N-proposal merge) | Degenerate at N=2; earns complexity at N≥3. **Post-gate** (§6, §12 — these now agree). |
| P6 | `humanloop` (mid-debate clarification + arbitration) | **Contaminates the gate measurement** (§6). Post-gate by construction. |
| P7 | Repo-grounded respondeo | Would make the judge a participant (§7). Open question, not obviously desirable. |
| P8 | **Adaptive meta-orchestrator** (decide *whether* to debate, which topology, how many agents, which models — then execute) | See the verdict below. |
| P9 | Local UI over the markdown; repository mutation + diff debate; parallel reviewers; Cursor/Aider adapters | Beyond MVP. |

**Sequencing rule (unchanged, and it is what this refresh reasserts):** do **not** build
the N-agent framework — specifically not `consolidatio` or `humanloop` — before M2. The
premise is unvalidated; two cross-vendor agents, unattended, test it. Building the full
engine before the gate is the exact trap this document exists to avoid.

### Verdict on the adaptive meta-orchestrator (P8)

The idea: an interactive setup phase above the config that answers *"what is the minimal
topology that maximizes value for this task?"* — decide whether a debate is needed, the
topology, the agent count, the model assignment, and only then execute. Turning Disputatio
from a debate protocol into an adaptive meta-orchestrator.

**It is a strong destination and it distorts the project now.** Three reasons, ascending:

1. It is an N-agent framework feature, so it is exactly what the sequencing rule above
   forbids pre-M2.
2. **It destroys the gate's measurability** — the decisive objection, and structurally
   identical to the `humanloop` exclusion in §6. If topology varies per task, condition B
   is no longer a fixed treatment, so a null result cannot be attributed to debate rather
   than to the router. Worse than a delay: it removes the ability to learn.
3. **It cannot be designed honestly yet.** "Minimal topology that maximizes value"
   presupposes a measured value/cost curve per topology. Nobody has that curve — which is
   precisely what `5_METRICS.md` produces. So the KPI work is the prerequisite that makes
   this **earnable on evidence** post-M2 instead of guessed.

**The version that survives today** (optional, small, zero premise risk): deterministic
**topology *advice*** — a `--doctor`-style heuristic pass over quaestio shape, repo
presence, and available participants that **prints a recommendation** ("this looks like a
narrow factual question — a single agent is probably enough"). No extra agent calls, no
LLM meta-reasoning, no automatic decision, so it cannot vary the treatment in an eval.
Not part of the current pass.

---

## 12. Open decisions carried in

1. **`consolidatio` mechanism** — how N Round-1 proposals merge into the one object the
   *sed contra* attacks. (Needed **post-gate**, at N≥3 — §6, §11 P5. Previously this
   entry said "M1", contradicting both; the contradiction is resolved in favour of
   post-gate.)
2. **Arbitration thresholds** — when the respondeo determines vs escalates. (Needed
   **post-gate**, with `humanloop` — §11 P6. Partially answered in practice: the shipped
   judge escalates on its own judgement via `STATUS: NEEDS_INPUT`, with no numeric
   threshold, and that has been adequate.)
3. **`disputatio` trailer schema** — the exact fields and YAML shape. (Needed for §5,
   now driven by Tier-1 KPIs — §11 P2.)
4. **Execution ownership** — Option A (user executes the plan) vs Option B (return to
   Disputatio to debate the diff). *Partially resolved:* the **redactio**
   (`final-report.md`) hands off a self-contained deliverable to start the work (A), and
   `--continue` lets the human re-enter without re-running. Debating the produced diff
   (B) remains open and is a natural fit for the review corpus in §8.
5. **Claude cost under subscription auth** — `--bare` is unavailable (canaried); rely on
   prompt-cache reuse within the TTL, or run with `ANTHROPIC_API_KEY`. (Operational.)
6. **Gate corpus generalization** — the review corpus is primary because it has partial
   ground truth (§8). If the moat shows up on review tasks but not on plan/design tasks,
   is Disputatio a *review* tool that also debates plans, or a debate tool? A positioning
   question the gate's output should answer, not this document.
