# Disputatio: Protocol KPIs

> How to tell a debate that **worked** from one that merely **agreed**.
>
> Companion to [`4_PLAN.md`](./4_PLAN.md) §8 (the M2 premise-validation gate). That
> document decides *whether* Disputatio earns its cost; this one instruments *why* a
> given run came out the way it did.
>
> **Provenance of the framing.** The four metric families below (error amplification,
> coordination overhead, redundancy, efficiency) come from **the user's summary of a
> Google document on multi-agent systems**, which this author has not read. The
> *definitions here are Disputatio's own* — written in the terms of this codebase so
> they are computable. Check them against the source; where they diverge, the source's
> intent should win and these definitions should be corrected.

---

## 1. Why process metrics, and not just quality + cost

The obvious KPIs for a debate tool are final quality and total cost. Both are necessary
and neither is sufficient, because they cannot distinguish the two failure modes that
actually threaten this project:

- **A debate that agreed.** Three agents, one opinion, restated three times. Quality
  looks fine (the single agent's answer was fine), cost looks like a debate. Nothing was
  adversarial. `2_CONCEPT.md` §2 names this directly: models share training data and
  RLHF-induced sycophancy, so cross-vendor diversity *reduces* error correlation without
  eliminating it.
- **A debate that amplified.** A weak claim enters in Round 1, is echoed rather than
  challenged in Round 2, and the judge — seeing apparent consensus — rules for it. The
  output is *worse* than a single agent's while looking more authoritative.

Both are invisible to quality-and-cost and obvious to process metrics. That is the whole
argument for this document.

Concretely, these KPIs exist to make the M2 gate **diagnosable** rather than a single
pass/fail bit. A null result at the gate has at least four distinct causes — the debate
never disagreed; the second debater was too weak; round 2 added nothing new; the judge
overrode the evidence — and the remedies are completely different. Without
instrumentation, a null result is just disappointing. With it, it is informative.

---

## 2. The anti-circularity rule (read this before adding any metric)

> **KPIs instrument the process. They never render the verdict.**

`2_CONCEPT.md` §2 warns that an LLM judge reintroduces exactly the sycophancy bias the
gate exists to detect, and that document's §4 "Caveat on judge bias" says the same about
the respondeo.
Both apply with full force here: a metric where **a model scores the quality of its own
debate** is not a measurement, it is the debate marking its own homework.

Rules that follow, and that any new metric must satisfy:

1. The gate's verdict (Metric 1 missed-risk, Metric 2 blind A/B — `4_PLAN.md` §8) stays
   **human**. No KPI enters that decision.
2. Prefer metrics computable **without a model at all** (Tier 0, §4). Counting turns,
   seconds, and bytes cannot flatter anyone.
3. Where a model is unavoidable (Tier 1, §5 — "is this objection new or a restatement?"),
   confine it to **extraction and matching**, never evaluation. "Are these two claims the
   same claim?" is a comparison a cheap model can make with an auditable answer. "Was
   this objection good?" is not, and must not be asked.
4. Any model-derived number carries its **provenance** and stays separable in reports, so
   a suspicious KPI can be discounted without discarding the run.

---

## 3. Metric families, defined in Disputatio's terms

Each family gets: what it means, how it is computed **here**, what it is good for, and
which tier it needs.

### 3.1 Error amplification

*A claim that enters weak and hardens through repetition rather than through evidence.*

| Signal | Definition | Tier |
| --- | --- | --- |
| **Unsupported-claim rate in the deliverable** | Claims in `final-report.md` with no evidence-backed turn behind them, over total claims. The deliverable is where amplification does damage, because it is what someone executes. | 1 |
| **Judge-vs-evidence divergence** | Contested points where the respondeo ruled for a position that **no participant grounded** in executable evidence. Directly violates the respondeo's own instruction to prefer run code over rhetoric, so a non-zero count is a prompt bug or a genuine hard case — both worth seeing. | 1 |
| **Echo-without-evidence** | A claim restated in a later round by a *different* participant while still carrying no evidence. This is amplification caught in the act, and it is the signal most worth alarming on. | 1 |

**Guard against a false reading:** repetition is not automatically amplification.
Independent agents converging on the same *evidence-backed* finding is exactly the
behaviour we want. Amplification is repetition **without** added grounding — which is why
every signal above is conditioned on evidence, not on similarity alone.

### 3.2 Coordination overhead

*What fraction of the run is spent talking about the work rather than doing it.*

| Signal | Definition | Tier |
| --- | --- | --- |
| **Coordination share (wall-clock)** | Time in non-proposal turns (reactions + respondeo + redactio) ÷ total turn time. Round 1 is the irreducible work — N independent answers; everything after is coordination in the strict sense. | 0 |
| **Coordination share (cost)** | Same ratio in dollars, **where reported** — see the gap in §6. | 0 (partial) |
| **Context growth per round** | Bytes of transcript fed to each participant per round. Reaction rounds re-send the full snapshot, so this grows superlinearly with rounds × participants, and it is the mechanism behind cost blowup. | 0 |
| **Wall-clock vs critical path** | Total elapsed run time ÷ slowest single turn. Rounds run in parallel (`Promise.all` in `runDebate`), so this reveals how much is genuinely serial: the round barriers and the judge. | 0 |

**Good for:** deciding whether a third participant or a third round is affordable, and
whether the round barrier (agents don't see same-round reactions — `4_PLAN.md` §6) is
costing more than it saves.

### 3.3 Redundancy

*How much of the debate is the same argument, again.*

| Signal | Definition | Tier |
| --- | --- | --- |
| **Duplicate-argument count** | Distinct claims restated across turns or rounds, over total claims. Split it two ways, because they mean opposite things: **cross-participant** duplication (independent convergence — often *good*) vs **within-participant** duplication across rounds (an agent padding, which is waste). | 1 |
| **Unique-claim ratio** | Distinct claims ÷ total claims, per round. Falls as a debate saturates. | 1 |

**Good for:** detecting the "debate that agreed" failure mode, and sizing the lineup —
if two participants duplicate ~everything, the second one is buying nothing.

### 3.4 Efficiency

*What each additional round actually buys.* **The most operationally useful family.**

| Signal | Definition | Tier |
| --- | --- | --- |
| **New-objection yield per round** | Objections in round *N* not present in rounds < *N*, ÷ total objections in round *N*. | 1 |
| **Evidence-backed ratio** | Objections carrying command output or a file citation ÷ total objections, per round. **This is the moat, measured** (`4_PLAN.md` §0), so it is arguably the single most important number in this document. | 1 |
| **Marginal cost per new objection** | Round *N*'s cost or wall-clock ÷ its new objections. The number that tells you a round was not worth running. | 0 + 1 |

**Good for — and this is the payoff:** a **convergence stopping rule**. Today `--rounds N`
is fixed by the caller, and `4_PLAN.md` §6 notes there is no automatic stopping rule
because nothing measures convergence. New-objection yield *is* that measurement: stop
adding rounds when yield drops below a threshold. That converts a guess into a control
loop — and it is a product feature that falls out of the instrumentation for free.

### 3.5 Failed reviews (reliability)

*How often the machinery, rather than the reasoning, is what went wrong.*

| Signal | Definition | Tier |
| --- | --- | --- |
| **Per-adapter turn failure rate** | Failed turns ÷ attempted turns, per participant. | 0 |
| **Setup vs agent failure** | **Setup**: exit 126/127 (stale shim shadowing a real binary), auth failure, spawn error — *not the agent's fault, and not a debate signal*. **Agent**: timeout, budget exhaustion, no final message, provider error. | 0 (partial) |
| **Abort rate** | Runs aborted for <2 successful proposals ÷ total runs. | 0 |
| **Human-input rounds** | `--continue` invocations needed before RESOLVED. | 0 |

**Good for:** keeping reliability out of the premise verdict. A gate run where codex died
on a stale shim is a **void trial**, not evidence against debate — and this is exactly the
distinction that `4_PLAN.md` §4's exit-126/127 invariant exists to preserve.

### 3.6 "Judge edits" — the term, made precise

The user's list included "number of judge edits," which is ambiguous as imported (the
judge does not *edit* anything — it rules, then synthesizes). Two useful readings, both
kept, both named:

- **(a) Verdict revisions** — the count of versioned `respondeo-N.md` files, i.e. how
  many rounds of human input the debate needed before it resolved. **Tier 0**, free: count
  the files. High values mean the debate left too much unsettled for the judge to close.
- **(b) Judge-vs-majority divergence** — contested points where the respondeo ruled
  *against* the position most participants held. **Tier 1.** Deliberately **not** framed
  as an error: a judge overruling a sycophantic majority on the strength of evidence is
  the protocol working *exactly* as designed. Read it together with §3.1's
  judge-vs-evidence divergence — divergence *toward* evidence is health, divergence *away
  from* evidence is the bug.

---

## 4. Tier 0 — free, no model, derivable from `Turn[]`

Everything computable from what `runDebate` already returns (`DebateOutcome.turns`) plus
the artifacts on disk. No claim extraction, no extra agent calls, no judgement.

| Metric | Source |
| --- | --- |
| Turn counts by phase (proposal / reaction / respondeo / redactio) | `Turn.title`, `Turn.participant` |
| Per-adapter failure rate; abort rate | `Turn.result.ok`, `DebateOutcome.aborted` |
| Setup vs agent failure split | `Turn.result.error` + `budgetExhausted` (see §6 — string-matching today) |
| Wall-clock per turn; coordination share; critical path | **needs `durationMs` — does not exist yet (§6)** |
| Cost per turn and per phase | `Turn.result.costUsd` (**claude only** — §6) |
| Context growth per round; transcript size | transcript bytes per round in `debate.ts` |
| Respondeo status; verdict revisions; human-input rounds | `DebateOutcome.respondeo.status`, `respondeo-N.md` file count |
| Redactio outcome | `finalReport` / `finalReportError.budgetExhausted` |

**Deliverable shape:** a `metrics.json` written alongside `debate.md` in
`.debate/debate-<ts>/`, machine-readable so an agent can consume it — consistent with the
agent-native parity value (`4_PLAN.md` §9), and the natural companion to the `state.json`
spine if that ever lands (`4_PLAN.md` §3).

---

## 5. Tier 1 — needs a claim ledger

Redundancy, new-objection yield, evidence-backed ratio, and the amplification signals all
require one thing Disputatio does not have: **a list of the claims and objections each
turn made, with a stable identity so the same claim can be recognized across turns.**

That is precisely the **`disputatio` trailer / normalization layer** specified in
`4_PLAN.md` §5 and never built — a fenced ` ```disputatio ` YAML block each agent emits
alongside its prose (positions, objections with targets, evidence typed as
assertion/citation/command-output, open questions), with a cheap-model extraction fallback
when an agent doesn't comply.

**This is the reframe worth noticing.** The trailer has sat deferred for good reason: it
was architecture with no consumer, and building it pre-gate is the exact trap
`4_PLAN.md` §11's sequencing rule forbids. Tier-1 metrics are the **first real consumer**.
So the ordering is: build the trailer *because* these metrics need it, scoped to exactly
the fields they consume — not because the original plan had a `normalize/` directory.

Design constraints when it is built:

- **Invariant 2 is untouchable** — raw prose stays the source of truth; the trailer is an
  index. The respondeo keeps reading prose. If the trailer ever becomes what the judge
  reads, the free-form reasoning that makes debate worth anything is gone.
- **A missing or malformed trailer must never silently drop a claim.** Extraction
  fallback, and flag the provenance (`parsed` / `repaired` / `extracted`) so a smoothed
  objection is visible in the metrics rather than invisible.
- **Matching is extraction, not evaluation** (§2 rule 3). "Same claim as this one?" —
  yes. "Better claim?" — never.
- **Trailer emission costs debater tokens** and mildly constrains their output. Measure
  the cost; if it degrades the prose, the fallback-extraction path (a separate cheap call
  outside the debate) is the safer trade.

---

## 6. Honest gaps — what blocks Tier 0 today

Verified against the code, because a metrics spec that assumes data it doesn't have is
just another aspirational roadmap:

1. **No timing data anywhere.** `AgentResult` (`src/adapters.ts`) is
   `{ok:true, text, costUsd?, raw?} | {ok:false, error, budgetExhausted?, raw?}` — there
   is **no duration field**, and `runIsolated` does not time its turns. Every wall-clock
   metric in §4 needs `durationMs` added first. This is the single highest-value small
   change in this document.
2. **Cost is claude-only.** `costUsd` comes from claude's `total_cost_usd`. `codex`
   reports tokens rather than dollars under ChatGPT-account auth; `agy`, `pi`, and
   `copilot-cli` report neither. **Therefore: wall-clock and turn counts are the
   vendor-neutral currency**, and dollars are a partial, per-vendor signal that must never
   be summed as if it covered the run. A lineup-wide cost total would be quietly wrong.
3. **Failure modes are not machine-classifiable.** `ok:false` carries a human-readable
   `error` string, so setup-vs-agent classification means string-matching today. A
   structured `kind` field on the failure branch is the clean fix (`4_PLAN.md` §3 notes
   the same gap from the other direction).
4. **Rounds are not explicitly labelled** in `Turn` — the round is encoded in
   `Turn.title` (`"Round 1 reaction — …"`). Per-round aggregation works by parsing the
   title, which is fragile. A `phase`/`round` field on `Turn` is the honest fix.

---

## 7. No targets yet — on purpose

This document defines **no thresholds**. Not "coordination overhead below 40%," not
"new-objection yield above 0.3."

Setting targets before any measurement exists would repeat, in a new costume, precisely
the failure that made `4_PLAN.md` need a refresh: confident numbers with nothing behind
them. The sequence is **baseline, then target**:

1. Build Tier 0. Run it over the dogfooding runs already captured, plus new ones.
2. Publish the observed ranges — with the lineup, the rounds, and the task type attached,
   since all three obviously move the numbers.
3. Only then set thresholds, and only for metrics that are about to **drive a decision**
   (the stopping rule in §3.4 is the first plausible candidate).

A metric with no decision attached is a number, not a KPI.

---

## 8. Next increment (specified, not built)

Smallest useful step, in TDD order per repo policy:

1. **`durationMs`** — time each turn in `runIsolated` (`src/debate.ts`) and surface it on
   `AgentResult`/`Turn`. Test against `test/fakes/`.
2. **`round` / `phase` on `Turn`** — stop parsing titles (§6.4).
3. **`metrics.json`** — a pure function `Turn[] → Tier-0 metrics`, written next to
   `debate.md`. Pure means unit-testable against captured fixtures with no CLI at all.
4. **Aggregate across runs** — a small reader over `.debate/*/metrics.json` for the
   baseline in §7.

Deliberately **not** in that increment: the claim ledger (Tier 1), any threshold, and any
model-in-the-loop metric. Tier 0 first, because it is free, honest, and immediately useful
to the gate.
