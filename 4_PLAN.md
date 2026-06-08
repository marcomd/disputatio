# Disputatio: Implementation Plan

> The bridge from concept to code. Builds on `1_IDEA.md` (vision), `2_CONCEPT.md`
> (the *disputatio* protocol, roles, executable evidence, convergence), and
> `3_ADAPTERS.md` (the headless-integration design grounded in `research/`).
>
> Scope of this document: the **MVP** — debate over a **text artifact (a plan)**,
> no repository mutation, no UI, whose job is to **validate the premise** that
> cross-harness debate beats a single strong agent. Everything past that is
> sketched, not specified.

---

## 1. Stack & rationale

**Language: TypeScript. Runtime: Bun.**

| Choice | Why |
| --- | --- |
| **TypeScript** | The author of the code is an AI; the human supervises by *reading*. The user reads TS fluently, so review is effective from day one. A real type system is the safety net that catches the AI's mistakes the high-level reviewer won't — decisive for an adapter layer full of failure modes. |
| **Bun** | Runs TS with no build step (fast iteration); `bun build --compile` emits a **standalone single-binary** (the distribution model the user wants to *continue* with, matching `agy`/`codex`); built-in test runner; `node:child_process` compatibility for battle-tested subprocess patterns. Fallbacks if Bun shows edges: Node + SEA, or Deno (`deno compile`). |
| **`execa`** (subprocess) | Separate stdout/stderr capture, timeouts, clean kills — removes most of the risky-primitive burden. Process-*tree* kill adds `detached:true` + `process.kill(-pid)` where needed. |
| **`zod`** (schema) | Discriminated unions model agent outcomes with **compile-time exhaustiveness** + runtime validation of the `disputatio` trailer and config. This is the safety net (§1 rationale). |
| **`citty`** (CLI) | Small, readable command/flag definitions. |
| **`bun test`** | Built-in, fast, no extra config. |
| **YAML** (debate config) | Human-friendly; validated through zod. |

**Design invariants carried from the concept (non-negotiable):**

1. **Markdown is the source of truth; the orchestrator owns memory.** Agents are
   invoked **statelessly** — pure functions of `(task, curated state)`. No
   `--resume`.
2. **Raw prose is the source of truth; the structured trailer is only an index.**
   The `respondeo` reads verbatim prose, never the normalized struct.
3. **No native schema-constraint on debaters** (`--json-schema` / `--output-schema`)
   — it flattens the free-form reasoning. Schema-constraint is reserved for the
   `respondeo`'s final determination and the optional normalization-repair pass.
4. **Backends MUST span model families** for premise validation (cross-vendor),
   or false consensus is baked in. `claude`→Claude, `agy`→Gemini, `codex`→GPT.

---

## 2. Architecture & modules

```
src/
├── transport/      # spawn agents, capture bytes, classify success/failure
│   ├── runner.ts        # execa wrapper: stdin</dev/null, separate capture, timeout, pgroup kill
│   ├── jsonl.ts         # streaming line-splitter (a chunk can split a JSON line)
│   └── doctor.ts        # version + capability probe per manifest
├── adapters/       # per-CLI manifests + thin escape-hatch code
│   ├── manifest.ts      # the declarative AdapterManifest type
│   ├── claude.ts        # envelope tier
│   ├── agy.ts           # text-only tier
│   └── codex.ts         # JSONL tier (added in M3)
├── normalize/      # bytes -> canonical DebateContribution
│   ├── trailer.ts       # parse the fenced ```disputatio YAML block (Level B)
│   └── extract.ts       # LLM-extraction fallback (Level C, last resort)
├── contract/       # the shared schemas (zod)
│   ├── contribution.ts  # DebateContribution + trailer schema
│   ├── outcome.ts       # AgentOutcome discriminated union
│   └── config.ts        # debate config schema
├── engine/         # the disputatio protocol
│   ├── phases.ts        # videtur quod -> consolidatio -> sed contra -> verifier
│   ├── convergence.ts   # 3 outcomes; open-question tracking
│   ├── respondeo.ts     # determination + ad obiecta
│   └── humanloop.ts     # clarification + arbitration escalation
├── state/          # .debate/ read/write (markdown + state.json)
│   └── store.ts
├── prompts/        # role + trailer-contract prompt fragments (per phase)
├── cli/            # citty commands: run / resume / finalize / doctor
└── eval/           # premise-validation harness
fixtures/           # captured real outputs from research/canary-results.md
test/
```

The dependency arrow points **down**: `engine` depends on `contract` +
`normalize` + `transport`, never the reverse. The engine only ever sees canonical
`DebateContribution` objects (+ the raw prose attached).

---

## 3. Domain model & data

### `.debate/` on-disk layout (refined from `2_CONCEPT.md` §8)

```txt
.debate/<debate-id>/
├── task.md                       # the quaestio (input artifact under debate)
├── config.yaml                   # participants, per-phase models/effort, rounds
├── state.json                    # machine state: phase, status, open questions
├── rounds/
│   ├── round-1-videtur-quod.md   # all participants' raw prose contributions
│   ├── consolidatio.md
│   ├── round-2-sed-contra.md
│   └── round-3-verifier.md
├── contributions/                # one structured trailer per (round, participant)
│   └── r1-claude.yaml …          # the *index*; prose lives in rounds/*.md
├── respondeo.md                  # the determination
└── final-report.md               # consensus / unresolved / follow-ups
```

`state.json` is the resumable spine: `{ debateId, phase, status, openQuestions[],
participants[], roundsCompleted }`. Markdown holds the human-readable record;
`state.json` + `contributions/` hold the machine-readable index.

### Key schemas (illustrative zod/TS sketches — to finalize in code)

```ts
// contract/outcome.ts — exhaustive at compile time
type AgentOutcome =
  | { kind: "success"; text: string; sessionId?: string; costUsd?: number }
  | { kind: "api_error"; status: number; message: string }
  | { kind: "timeout"; afterMs: number }
  | { kind: "no_final_message" }          // codex: no agent_message item
  | { kind: "spawn_error"; message: string }
  | { kind: "nonzero_exit"; code: number; stderr: string };

// contract/contribution.ts — the index, NOT the source of truth
interface DebateContribution {
  round: number;
  phase: "videtur_quod" | "sed_contra" | "verifier";
  participant: string;            // adapter id
  rawProse: string;               // verbatim — what the respondeo reads
  positions: Position[];
  objections: Objection[];        // each carries a `target`
  evidence: Evidence[];           // tagged: assertion | citation | command_output
  openQuestions: string[];
  confidence: number;
  trailerStatus: "parsed" | "repaired" | "extracted"; // provenance of the struct
}
```

### Adapter manifest (data-first, per `3_ADAPTERS.md` §7)

```ts
interface AdapterManifest {
  name: string;
  invoke: { bin: string; base: string[]; prompt: "arg" | "stdin"; stdin: "/dev/null" };
  transport:
    | { kind: "json-envelope"; textPath: string; ok: string; sessionPath?: string; costPath?: string }
    | { kind: "jsonl"; finalItem: "last-agent-message"; ok: string }
    | { kind: "raw-text"; ok: string };
  model: { flag: string; quote?: boolean };
  effort: { kind: "flag" | "config" | "in-model-name"; flag?: string };
  autonomy: string[];
  stateless: string[];
  testedVersions: string;
}
```

---

## 4. Transport layer (the risky core)

The one place all per-CLI difference lives. Output: a uniform
`RawAgentRun { stdout, stderr, exitCode, outcome: AgentOutcome }`.

Hard rules (every one canaried in `research/canary-results.md`):

- **`stdin: '/dev/null'`** on every spawn (Codex hang mitigation).
- **Capture stdout and stderr separately** (progress on stderr for codex).
- **Wall-clock timeout** per call (execa `timeout`), plus **process-group kill**
  on expiry (`detached:true` + `process.kill(-pid)`) so child tools die too.
- **Classify success from BOTH the exit code AND the in-band signal** — never one
  alone. Concretely:
  - claude: `exitCode===0 && json.is_error===false` (⚠️ **ignore `subtype`** — it
    stays `"success"` on error).
  - codex: `exitCode===0 && saw turn.completed && no error/turn.failed`; final text
    from the `-o` file or the **last** `agent_message` item.
  - agy: `exitCode===0 && stdout non-empty` (text-only; EXIT 2 = flag/usage error).
- **Record provenance** per run into `state.json`: bin path, **version**, full
  argv, model, exitCode, costUsd.

### `disputatio doctor`

Resolves each manifest against the installed binary: checks presence, **version
vs `testedVersions`**, and runs a canary probe (the "pong" call). Fails loudly on
drift. Directly motivated by `agy` self-updating 1.0.4→1.0.5 mid-investigation.
Run automatically before `run`, and standalone.

---

## 5. Normalization layer

Turns `RawAgentRun.text` into a `DebateContribution`. Uniform across adapters.

Three-level output contract (`3_ADAPTERS.md` §3), highest-fidelity first:

1. **A — native JSON envelope** (transport only): text + sessionId + cost + error
   flag, where the CLI offers it (claude, codex). Not the contribution struct.
2. **B — self-emitted trailer (primary):** parse the fenced ` ```disputatio `
   YAML block out of the prose, deterministically, validate with zod. Works for
   **every** agent including text-only `agy`. `trailerStatus: "parsed"`.
3. **C — LLM extraction (last resort):** on a parse miss, a cheap model emits the
   struct (schema-constrained). Emits a **warning into the debate metadata** so a
   smoothed or dropped objection is never silent. `trailerStatus: "extracted"`.

Invariant enforced here: `rawProse` is always retained verbatim and is what the
`respondeo` consumes; the struct is routing/consensus-tracking only.

---

## 6. Debate engine

A state machine over the *disputatio* phases (`2_CONCEPT.md` §3). Every
participant acts in every phase (roles are phases, not fixed per agent).

```
quaestio
  → Round 1  videtur quod   (all propose; prose + trailer captured)
  → consolidatio            (respondeo merges N proposals into ONE shared object)
  → Round 2  sed contra     (all attack the consolidated object)
  → Round 3  verifier        (all produce executable, read-only evidence)
  → respondeo               (determine, or escalate to human)
  → ad obiecta              (answer surviving objections; record unresolved)
```

- **Statelessness:** each phase builds a fresh prompt from the curated state +
  the role/trailer contract for that phase; agents never carry session memory.
- **Convergence (`convergence.ts`):** tracks open questions; produces one of three
  outcomes — **consensus**, **unresolved disagreement** (recorded), **stalemate**
  (escalated). Never manufactures a fake consensus.
- **Human-in-the-loop (`humanloop.ts`):** two pause points — **clarification**
  (ambiguous task / blocked participant) and **arbitration** (respondeo cannot
  determine). Rare, focused questions only.

> ⚠️ **The premise-test path is a SUBSET of this, and excludes two pieces — on
> purpose:**
> - **`humanloop.ts` is built AFTER the validation gate, not before.** If a human
>   can clarify/arbitrate mid-debate, the gate stops measuring "debate vs single
>   agent" and starts measuring "debate + human vs single agent" — the
>   measurement is contaminated. The M1→M2 path must run **unattended**. (This
>   removes it from the *gate*, not from the *product*.)
> - **`consolidatio` is degenerate at N=2** and earns its complexity only at N≥3.
>   It is deferred to M3 (when `codex` makes it a 3-way debate).
>
> So the **gate path** is: `videtur quod → sed contra → verifier → respondeo`,
> unattended, 2 cross-vendor agents. It still exercises the real differentiator
> (executable evidence). The full protocol above (with `consolidatio` + human
> loop) is the *product*, built once the premise holds.

> Carries two **open decisions** (`2_CONCEPT.md` §10), to resolve when their
> modules are actually built (consolidatio at M3, arbitration with `humanloop`
> post-gate): the **consolidatio** mechanism and the **arbitration thresholds**.

---

## 7. Respondeo & finalization

- The `respondeo` participant (`claude:opus`, high effort) reads the **verbatim
  prose** of all contributions (not the structs), plus the tracked open questions.
- It produces `respondeo.md` (the determination) and the `ad obiecta` section.
- This is the **one place native schema-constraint is allowed** — the final
  determination may use `--json-schema` to emit a rigid, machine-checkable
  decision object for `final-report.md`.
- `final-report.md`: consensus decisions · unresolved disagreements ·
  implementation recommendations · risks · follow-up actions.

---

## 8. Premise-validation eval harness (the real first deliverable of value)

Per `2_CONCEPT.md` §2, the premise is unproven and the project is pointless if the
delta is absent. The harness is a **gate**, not a feature — the **riskiest,
load-bearing measurement** in the plan.

**Pre-M0 finding (recorded faithfully, 2026-06):** the cheap discriminating
question was asked. Answer: in the user's manual rounds, later agents **confirm**
the decision, they do not change it — because the user front-loads the call with a
first agent plus an upfront **web-UI brainstorm**, and only debates *implementation*
manually (design-stage debate is too laborious by hand). By the pre-registered
rule (§ below), "confirm" **leans against the big-bet premise** ("debate → better
decisions") and toward the smaller prop ("automate manual effort"). The manual
cost is a real **confound** — but only a partial one: the user already has cheap
extra perspectives (the brainstorm) at the design stage and *still* converges
early. So we **update the prior down** and elevate "automate effort" relative to
"better decisions." This is leans-negative-but-confounded, **not** "encouraging."

**The narrower hypothesis that genuinely survives.** The user's brainstorm-then-
confirm flow is **single-model multi-turn reasoning with no executable-evidence
grounding** — the one thing their experience has *never* tested is Disputatio's
actual moat: **adversarial objections backed by running the tests.** So the gate
must isolate the moat, not "more voices":

> **Gated hypothesis:** *adversarial objections grounded in executable evidence
> change or materially sharpen a decision that a strong single-agent + brainstorm
> process already produced.*

**Setup**
- A small set (5–10) of real plan/design tasks.
- Two conditions per task: **(A)** a **strong** single-agent baseline that mirrors
  the user's real process (upfront brainstorm + first agent + self-critique) — not
  a strawman; **(B)** Disputatio (the unattended gate path, with at least one
  objection required to carry `command-output` evidence).

**The scoring problem (must be solved, not hand-waved):** plan/design artifacts
have **no objective known-good reference** the way code-with-tests does, and an
**LLM judge reintroduces the very sycophancy bias we are trying to detect**. So
the scoring is the part most likely to produce a muddy, non-decisive result.

**Scoring protocol (non-circular) — TWO primary metrics, because the pre-M0
finding predicts debate will mostly *confirm*:**
- **Metric 1 — Blind A/B preference.** Two outputs side by side, labels stripped,
  order randomized; the human picks *which plan they would rather execute*,
  recorded **before** labels are revealed. Win-rate of B over A.
  - ⚠️ **This metric alone will false-negative the gate.** If debate confirms the
    decision (as predicted), "which would you rather execute?" lands ~50/50 and
    reads as "no value" — *even when debate surfaced a material risk worth seeing.*
    Hence Metric 2.
- **Metric 2 — Missed-risk surfacing (captures confirm-with-better-awareness).**
  Regardless of whether the headline decision changed: *did B surface a
  risk / objection / **failing test** that A missed, which you are glad to have
  seen?* This is exactly the executable-evidence moat, and it is a legitimate win
  the preference metric throws away.
- **No LLM as the deciding judge.** An LLM may pre-extract claim lists for the
  human to check, but both verdicts are the human's (blind preference + missed-risk
  tally).
- **Output:** a verdict — *where* (which task types) the moat pays off, or that it
  doesn't (a valid, money-saving finding).

**Cost budget (real):** one debate is dozens of frontier-agent calls (a single
word cost $0.10 — `research/canary-results.md`). M2 = that matrix × 5–10 tasks ×
2 conditions, re-run during development. Cap per-debate spend
(`--max-budget-usd`), cache within the TTL, and use cheaper models in the
`verifier` phase. Budget the eval explicitly — cost bites precisely at the gate.

**The test cheaper than building M0–M2 — run it pre-M0 (see §11).** The
questionnaire signal is in (above) and leans negative-but-confounded. The
surviving hypothesis (executable-evidence moat) rests on an experience the user
has **never had** — a real design-stage debate, which manual cost always forbade.
So give them exactly **one instance of it, orchestrated by hand**: Claude drives
`claude` + `agy`(→Gemini) on a **single real *past* design task whose outcome the
user already knows**, with **at least one objection forced to carry
`command-output` evidence**, then ask: *did this change or materially sharpen the
call versus what you actually did?* A few calls and an afternoon vs. weeks of
harness-building. **If it sharpens a real decision, M0 is earned on evidence; if
not, the harness is saved.**

---

## 9. CLI surface (`citty`)

```bash
disputatio run --task task.md --config debate.yaml      # run a debate
disputatio resume <debate-id>                           # continue from state.json
disputatio finalize <debate-id>                         # (re)generate final-report.md
disputatio doctor                                       # version + capability probe
# deferred: disputatio ui
```

Agent-native parity (a project value): anything the CLI does, expose so an agent
can drive it too (structured output on `doctor`, machine-readable `state.json`).

---

## 10. Testing strategy

- **Unit (fast, no network):** the parsers and the transport classifier are the
  highest-risk code → test them against **fixtures captured from real runs**
  (`research/canary-results.md`): the claude success/error JSON, the codex JSONL
  (incl. `turn.failed`), the agy raw text, malformed trailers. The "subtype lies
  on error" case gets an explicit regression test.
- **A `fake-agent` binary:** a tiny script that emulates each adapter's framing
  (envelope / jsonl / raw-text) and on demand: hangs (timeout test), exits
  non-zero, splits a JSON line across writes (line-splitter test), emits a bad
  trailer. Lets the whole engine run deterministically and offline in CI.
- **Smoke (manual / gated):** the real `claude`/`codex`/`agy` "pong" canaries,
  behind a flag, run by `doctor`.

---

## 11. Milestones

| # | Goal | Done when |
| --- | --- | --- |
| **Pre-M0** | One hand-run debate (the real cheap test) | Questionnaire done → **leans-negative-but-confounded** (§8). Now: Claude hand-orchestrates `claude` + `agy`(→Gemini) on one real *past* design task (outcome known), with ≥1 objection carrying `command-output` evidence. Did it change/sharpen the call vs what actually happened? **Earns M0 on evidence, or saves the harness.** |
| **M0** | Transport + `doctor`, one adapter (`claude`) | A "pong" round-trips through the runner with correct success/timeout/error classification; `doctor` reports version + canary status. |
| **M1** | First end-to-end debate — **the gate path only** | `claude` + `agy`(→Gemini, **cross-vendor**) run `videtur quod → sed contra → verifier → respondeo` **unattended** on a text task, producing `final-report.md`. **No `consolidatio`, no `humanloop`** (both contaminate or are degenerate at N=2 — see §6). Crude/hardcoded adapters fine. |
| **M2** | **Premise-validation gate** | The eval harness runs M1's debate vs single-agent self-critique on 5–10 tasks, scored by the blind-A/B protocol (§8), and reports the delta. **Go/No-Go decision point. Stop here if No-Go.** |
| **M3** | Generalize (only if Go) | Add `codex` (→GPT) — now N=3, so build **`consolidatio`**; refactor the three into declarative manifests; harden transport; finalize the trailer schema. |
| **Post-gate** | Product features | **`humanloop.ts`** (clarification + arbitration — deliberately excluded from the gate), local UI (view over markdown). |
| **Later** | Beyond MVP | git-worktree isolation, repository mutation + diff debate, parallel reviewers, Cursor/Aider adapters. |

Sequencing rule (`3_ADAPTERS.md` §8, sharpened): do **not** build the N-agent
framework — and specifically not `consolidatio` or `humanloop` — before M2. The
premise is unvalidated; two cross-vendor agents, unattended, test it. Building the
full engine before the gate is the exact trap this plan exists to avoid.

---

## 12. Open decisions carried in

Tracked, to resolve at the marked points — not now:

1. **`consolidatio` mechanism** — how N Round-1 proposals merge into the one object
   the *sed contra* attacks. (Needed for §6 / M1.)
2. **Arbitration thresholds** — when the `respondeo` determines vs escalates.
   (Needed for §6 / M1.)
3. **`disputatio` trailer schema** — finalize the exact fields + YAML shape.
   (Needed for §5 / M3, draft usable for M1.)
4. **Execution ownership** — Option A (user executes the plan) vs Option B (return
   to Disputatio to debate the diff). (Post-MVP; does not block.)
5. **Claude cost under subscription auth** — `--bare` is unavailable (canaried);
   rely on prompt-cache reuse within the TTL, or run with `ANTHROPIC_API_KEY`.
   (Operational; affects per-run cost, not architecture.)
