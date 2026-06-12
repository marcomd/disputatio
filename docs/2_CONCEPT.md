# Disputatio: Refined Concept

> This document refines the raw vision in `1_IDEA.md` into a coherent concept.
> It is the bridge between the idea and the implementation plan. It fixes the
> design decisions we have agreed on, names the tensions we have resolved, and
> flags the few questions that remain genuinely open.

---

## 1. Positioning

**Disputatio is a debate engine for producing high-quality plans and technical
decisions.** It orchestrates a structured disputation between multiple real AI
coding agents (Claude Code, Codex CLI, Antigravity/Gemini CLI, and future
agentic systems) and drives them toward a reasoned determination.

### What it is

- An orchestrator of **real agent harnesses**, not raw LLM API calls. The
  debate happens between actual tool-using agents that can read the repository,
  run commands, and execute tests.
- A producer of **decisions and plans**, grounded in **executable evidence**.
- **Local-first**: all artifacts are Markdown files on disk; the UI (later) is a
  view layer, never the source of truth.

### What it is not

- Not a multi-agent chat. The objective is convergence toward a determination,
  not open-ended conversation.
- Not a custom LLM wrapper. We leverage each agent's native reasoning style,
  tooling, and workflow rather than replacing it.
- Not (in the MVP) a code-generation competition. The artifact under debate is a
  **plan**, not a diff. Implementation comes later and is comparatively cheap to
  execute once the plan is correct.

### How it differs from existing multi-agent frameworks

Frameworks such as AutoGen, CrewAI, and LangGraph — and the academic
"multi-agent debate" line — wire together **bare LLMs** at the API level.
Disputatio's two defensible differentiators are:

1. **Harness-level orchestration.** The debaters are agents with tools operating
   in a real repository, not stateless chat completions.
2. **Executable evidence as the moat.** Because the debaters can run commands,
   an objection backed by a failing test outranks an objection backed by
   rhetoric. This is the single capability API-level frameworks cannot easily
   reproduce, and it is the heart of the project.

---

## 2. Premise and validation

The entire project rests on one unproven assumption:

> A debate across diverse harnesses produces **better** decisions than a single
> strong agent performing self-critique with good prompting.

This must be treated as a **hypothesis to validate**, not a given. The
multi-agent-debate literature is genuinely mixed: debate often fails to beat a
single strong model, and can converge *confidently* to wrong answers through
mutual deference (sycophancy).

### Honest caveat on diversity

The argument "different vendors break the correlation of errors" is only *partly*
true. These models share overlapping training data and RLHF-induced sycophancy.
Cross-vendor diversity **reduces** error correlation; it does **not** eliminate
it. We design against false consensus (see §6) rather than assuming diversity
solves it for us.

### Validation approach

The first real deliverable is not architecture — it is a **minimal evaluation
harness**: a handful of real tasks with a known-good answer, comparing
`single agent + self-critique` against `Disputatio`. If the delta is absent,
nothing else matters. If it is present, we also learn *where* (on which task
types) debate pays off.

A useful discriminating signal already exists in the user's lived experience: in
the manual rounds performed today, how often does a later agent *change* the
decision versus merely *confirm* it? That answer tells us whether the core value
is "better decisions" (large) or "less manual context-switching" (smaller, but
still real).

---

## 3. The Disputatio protocol

The medieval scholastic *disputatio* already solved the problem of structured
convergence toward a determination. We adopt its structure directly, and we keep
its Latin phase names as first-class vocabulary.

**Rounds are phases, not fixed per-agent roles.** Every participant takes part in
every round. This is deliberate: it does not chain a harness to a task it may be
weak at, and it adapts automatically as models shift in relative strength across
versions (an agent that is the best *proposer* today may become the best
*verifier* after a model upgrade). We extract the best from each participant in
each phase.

```
Round 1 — videtur quod   All participants propose. ("it seems that…")
            │
            ▼
         consolidatio    The respondeo (or a synthesis step) merges the
                         competing proposals into ONE shared object.
            │
            ▼
Round 2 — sed contra     All participants attack the consolidated object,
                         hunting for flaws. ("but against this…")
            │
            ▼
Round 3 — verifier       All participants produce executable evidence:
                         run tests, reproduce, prototype, verify assumptions.
            │
            ▼
         respondeo       The judge determines the outcome — or escalates to
                         the human if no determination is possible.
            │
            ▼
         ad obiecta      The determination answers the surviving objections
                         point by point. Unresolved disagreements are recorded,
                         not hidden.
```

### Why the `consolidatio` step exists

If all N participants propose in Round 1, we get N competing theses. Sending the
Round 2 skeptics against N scattered proposals fragments the debate. The
consolidation step frames a single shared object for the *sed contra* to attack —
exactly as the scholastic master frames the *quaestio* before the objections.

The precise consolidation mechanism is an **open decision** (see §10).

---

## 4. Roles and participants

A **participant** is a pair (more precisely a triple): `(harness, model, effort)`.

Example configuration:

| Participant      | Harness        | Model            | Effort |
| ---------------- | -------------- | ---------------- | ------ |
| Debater          | Claude Code    | Sonnet 4.6       | normal |
| Debater          | Codex CLI      | GPT-5.5          | normal |
| Debater          | Antigravity    | Gemini Flash 3.5 | normal |
| **respondeo**    | Claude Code    | Opus 4.8         | xhigh  |

The **respondeo** (judge / synthesizer) is a distinct role from the debaters. It
performs the consolidation, the determination, and the *ad obiecta*.

### Model and effort are configured per *phase*, not per role

Because the role is determined by the **round**, we cannot permanently assign a
cheap model to "the skeptic" — in Round 2 *everyone* is a skeptic. The economy
lever is therefore **per-phase**:

- *videtur quod* (ideation) → strongest models / highest effort.
- *verifier* (running tests, more mechanical) → lower effort / cheaper models
  are acceptable.

This reconciles "use the best models" with "spend money only where it counts."

### Caveat on judge bias

The `respondeo` may share a vendor with one of the debaters (e.g. Claude Code
Opus judging while Claude Code Sonnet debates). Using a different model (Opus vs
Sonnet) mitigates this, but vendor-correlated and shared-training bias is not
eliminated. We note it explicitly and may later rotate or diversify the judge.

---

## 5. Executable evidence

This is the moat. Every contribution may carry **claims**, and each claim is
tagged by evidence type:

| Evidence type      | Meaning                                  | Weight   |
| ------------------ | ---------------------------------------- | -------- |
| `assertion`        | Stated from reasoning / priors           | lowest   |
| `citation`         | Backed by a `file:line` reference        | medium   |
| `command-output`   | Backed by an actually executed command   | highest  |

A `command-output` claim (e.g. "I ran the existing test suite and it already
fails here") outranks rhetoric. The judge weights tested claims more heavily.

### Evidence survives a plan-only world

Even though the MVP debates a **plan** and never mutates the repository, the
evidence moat remains intact, because the verification phase uses **read-only**
empirical checks:

- run the existing test suite;
- reproduce a reported bug;
- confirm an API / function / symbol actually exists;
- run a throwaway spike or prototype in a scratch space.

The plan is therefore anchored to **verified facts**, not vibes. This is exactly
what separates Disputatio from "three chatbots brainstorming a plan."

---

## 6. Convergence and human-in-the-loop

Convergence must be **designed**, not asserted. The protocol distinguishes three
possible outcomes, and never manufactures a fake one:

1. **Consensus** — a determination the surviving objections do not defeat.
2. **Unresolved disagreement** — recorded explicitly in the final report.
3. **Stalemate** — escalated to the human rather than forced.

### Two distinct human intervention points

Following the pattern of Claude Code pausing to ask a clarifying question, the
human is pulled in at exactly two moments — **rarely, and with a focused
question** (otherwise we destroy the automation value):

1. **Clarification** — when the task is ambiguous: at the start of the debate,
   or when a participant signals it is blocked on missing information.
2. **Arbitration / tie-break** — when the `respondeo` *cannot* reach a
   determination (persistent disagreement or stalemate). Instead of forcing a
   conclusion, it escalates to the human with a crisp summary of the
   disagreement and the standing positions.

This human-in-the-loop design is the primary antidote to convergence-by-
deference (false consensus).

The exact thresholds that trigger arbitration are an **open decision** (see §10).

---

## 7. Contribution contract

There is a real tension between two of our principles:

- **Leverage native capabilities** — the reason to use real harnesses at all.
- **Enforce a convergence protocol** — the reason the debate produces decisions
  rather than chatter.

The more rigidly we force each agent into our schema, the more we suppress the
native reasoning style we wanted. We resolve this by structuring only the
*record*, not the *reasoning*:

- **Free-form body** — each agent reasons in its own native style. (Mental model:
  we are "analyzing a document that contains other people's opinions" — we read
  it pragmatically, we do not dictate how it was written.)
- **Structured trailer** — each contribution ends with a machine-readable block:

```yaml
positions:        # what this agent advocates
objections:       # each objection, with the target it attacks
evidence:         # claims, tagged by evidence type (§5)
open_questions:   # what remains unresolved
confidence:       # self-reported confidence
```

The **adapter** is responsible for validating and, where possible, repairing this
trailer. This keeps the consensus logic operating on **structured data**, not on
prose parsing.

---

## 8. State model

- **Markdown is the source of truth.** All debate artifacts live on disk.
- **Stateless agent invocations.** Each agent is invoked as a pure function of
  `(task, curated debate state)`. Disputatio owns the memory; agents do not carry
  hidden session state that could fork the source of truth.
- **Authentication is out of scope.** Each CLI manages its own auth; the user
  authenticates each harness *before* invoking `disputatio`.

Proposed on-disk layout (refined from `1_IDEA.md`):

```txt
.debate/
├── task.md              # the question / quaestio
├── config.yaml          # participants, per-phase models/effort, rounds
├── state.json           # machine state: phase, open questions, status
├── rounds/
│   ├── round-1-videtur-quod.md
│   ├── consolidatio.md
│   ├── round-2-sed-contra.md
│   └── round-3-verifier.md
├── respondeo.md         # the determination
└── final-report.md      # consensus, unresolved disagreements, follow-ups
```

---

## 9. MVP scope

The sharpest MVP validates the **premise** with the least possible effort:

> **Debate over a text artifact (a plan / design).** 2–3 debaters + 1
> `respondeo`. Phase-based rounds (*videtur quod → sed contra → verifier*).
> Markdown output. Participants may **read** the repository and run **read-only**
> commands to produce evidence. **No repository mutation. No UI.**

Deferred to later phases:

- repository mutation and competing implementations in isolated git worktrees;
- the local web UI (view layer over the Markdown artifacts);
- parallel reviewers;
- team workflows.

### Open question: where does execution live?

Once the plan exists, *someone* has to implement it. It is not yet decided
whether execution belongs inside Disputatio or to the user:

- **Option A** — execution is left entirely to the user (any agent, even a cheap
  one, acts as executor since the plan carries the intellectual work).
- **Option B (phase 2)** — after the user implements, they return to Disputatio
  to **debate the resulting diff**, reusing the same protocol on an
  implementation artifact.

This is intentionally left open; it does not block the MVP, which ends at a
validated plan.

---

## 10. Open risks and decisions

### Risks to watch

- **Headless integration tax.** Each CLI differs in invocation, output format,
  and session semantics, and many are interactive TUIs. Driving them headlessly
  and capturing structured output is the most likely place for the project to
  stall. **Spike this early.**
- **Cost and context growth.** N participants × R rounds, each receiving task +
  prior debate + repo context, running tool loops. Requires per-round budgets and
  context compaction with provenance.
- **False consensus.** Mitigated by the three-outcome model and human
  arbitration (§6), not by assuming vendor diversity is enough (§2).

### Decisions still open

1. **`consolidatio` mechanism** — exactly how competing Round 1 proposals are
   merged into the single object the *sed contra* attacks (judge-synthesized
   slate vs. skeptics attacking all proposals vs. another scheme).
2. **Arbitration thresholds** — the precise conditions under which the
   `respondeo` determines on its own versus escalates to the human.
3. **Execution ownership** — Option A vs. Option B above (§9).
