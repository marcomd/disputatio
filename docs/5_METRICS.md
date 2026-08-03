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

> ⚠️ **Agent-time and wall-clock are different quantities and must never be mixed.**
> Turns within a round run **concurrently** (`Promise.all` in `runDebate`), so summing
> turn durations measures **resource consumption**, not elapsed time. An earlier draft of
> this section divided summed non-proposal time by summed total time and called the result
> a wall-clock share — that formula is wrong for every run with more than one participant.
> Both quantities are useful; label them.

Let a *phase* be one parallel group (proposals, each reaction round, respondeo, redactio),
and `d(t)` a turn's duration:

| Signal | Definition | Tier |
| --- | --- | --- |
| **Agent-time** | `Σ d(t)` over all turns. What you *consume* — the right denominator for cost-like reasoning and for comparing arm budgets (`4_PLAN.md` §8). | 0 |
| **Coordination share (agent-time)** | `Σ d(t)` over non-proposal turns ÷ agent-time. Round 1 is the irreducible work — N independent answers; everything after is coordination. | 0 |
| **Wall-clock per phase** | `max d(t)` **within** the phase — a round is as slow as its slowest participant, because of the round barrier. | 0 |
| **Run wall-clock (model)** | `Σ_phases max d(t)`, since phases are strictly serial (each reaction round consumes the previous snapshot; the judge waits for all). This is the **critical path** — *not* the slowest single turn, which an earlier draft claimed. | 0 |
| **Coordination share (wall-clock)** | `Σ_{non-proposal phases} max d(t)` ÷ run wall-clock. Usually **higher** than the agent-time share, because the judge and redactio are single-turn phases with no parallelism to hide behind. | 0 |
| **Orchestration overhead** | measured run wall-clock − `Σ_phases max d(t)`. What the *orchestrator* costs: temp-dir setup, worktree add/remove, and the `withGitLock` serialization (see the bracketing note below). Should be small; if it isn't, that is a finding. | 0 |
| **Coordination share (tokens / cost)** | Same ratios in tokens, or dollars where reported — see §6 for what each adapter actually reports. | 0 (partial) |
| **Context growth per round** | Bytes of prompt fed to each participant per round. Reaction rounds re-send the full snapshot, so this grows superlinearly in rounds × participants, and it is the mechanism behind cost blowup. Requires recording prompt bytes per turn (§6). | 0 |

**What the timing must bracket — decide once, and record both.** `runIsolated` wraps
`p.run` in temp-dir creation plus, in repo mode, `git worktree add/remove` under
`withGitLock` — and that lock **genuinely serializes** concurrent turns. So:

- **`agentMs`** — around `p.run` alone. The model's latency. This is what belongs in the
  per-phase `max` above.
- **`turnMs`** — around all of `runIsolated`. Includes worktree setup and lock waiting.

Recording both makes `turnMs − agentMs` the per-turn isolation overhead, and keeps the
git lock from being silently attributed to the model. Timing only `runIsolated` would
inflate "parallel" durations with lock contention; timing only `p.run` would hide real
elapsed cost. Neither alone is honest.

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
| **Command-output-backed ratio** | Objections carrying **executed command output** ÷ total objections, per round. **This — and only this — is the moat measured** (`4_PLAN.md` §0), and it is the single most important number in this document. | 1 |
| **Citation-backed ratio** | Objections carrying a **file/line citation** but no execution ÷ total objections. Real grounding and clearly better than assertion, but it is *reading*, which any API-level framework with a file tool can do. | 1 |
| **Assertion-only ratio** | The remainder: objections resting on neither. The rhetoric the respondeo is instructed to discount. | 1 |
| **Marginal cost per new objection** | Round *N*'s agent-time (or tokens) ÷ its new objections. The number that tells you a round was not worth running. | 0 + 1 |

**Never collapse these three into one "evidence-backed" figure.** The project's own
`3_ADAPTERS.md` §3 types evidence as **assertion | citation | command_output** precisely
because the tiers are not interchangeable, and §0's moat claim is specifically about
*executing* things. A blended ratio would let a debate that only ever *read* files report
a strong moat number — which is the one measurement error that could make the gate pass
for the wrong reason.

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

## 4. Tier 0 — free, no model, no claim extraction

**`Turn[]` alone is not enough** — and saying otherwise was the flaw in this section's
first draft, which listed `DebateOutcome.aborted` and prompt bytes as sources while
claiming derivability from `Turn[]`. Tier 0 needs a **run-level input**:

```ts
type MetricsInput = {
  outcome: DebateOutcome;          // turns + aborted + respondeo.status + finalReport(Error)
  lineup: { id, vendor, model, effort }[];   // config: what actually ran, per participant
  turnMeta: {                      // recorded per turn AT SPAWN TIME — not recoverable later
    phase: "proposal" | "reaction" | "respondeo" | "redactio";
    round?: number;                // stop parsing Turn.title (§6.4)
    promptBytes: number;           // the exact prompt fed in — context growth needs this
    agentMs: number; turnMs: number;          // both brackets (§3.2)
  }[];
  quaestioBytes: number; repoMode: boolean; roundsRequested: number;
};
```

Two of those cannot be reconstructed after the fact, which is the whole reason this is a
recording problem and not a reporting one: **`promptBytes`** (the prompt is built, used,
and dropped — the transcript is not the prompt, since `renderForContext` strips cost
footnotes and error dumps) and the **timings**.

| Metric | Source |
| --- | --- |
| Turn counts by phase; per-participant turn counts | `turnMeta.phase`, `Turn.participant` |
| Per-adapter failure rate; abort rate | `Turn.result.ok`, `outcome.aborted` |
| Setup vs agent failure split | `Turn.result.error` + `budgetExhausted` (string-matching today — §6.3) |
| Agent-time, per-phase wall-clock, critical path, orchestration overhead | `turnMeta.agentMs` / `turnMs` (**needs recording — §6.1**) |
| Cost per turn/phase (dollars) | `Turn.result.costUsd` — **claude only** (§6.2) |
| Tokens per turn/phase | claude `usage`/`modelUsage`, codex `turn.completed.usage` — **in `raw` but not surfaced** (§6.2) |
| Context growth per round | `turnMeta.promptBytes` (**needs recording — §6.1**) |
| Respondeo status; redactio outcome | `outcome.respondeo.status`, `finalReport` / `finalReportError` |
| **Ran-any-command (the §8 validity check)** | `codex`: count `command_execution` items in `raw`; `claude`: `num_turns > 1` + `permission_denials` proxies (§6.4) |

**Separate step — artifact-history aggregation.** Verdict revisions and human-input rounds
(`respondeo-N.md` count, §3.6a) are **not** in `MetricsInput` at all: they accumulate
across *separate `--continue` invocations*, each a different process. That is a reader over
the `.debate/<dir>` directory, not a function of one run's outcome. Keeping the two apart
matters — a pure `MetricsInput → metrics` function stays unit-testable against fixtures
with no filesystem, and the aggregator is the only part that needs disk.

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

All four were checked against the code and against a **real repo-grounded capture**
(2026-06-12, structure only — those captures are gitignored and may hold private material,
so only field names are recorded here). Two of them turned out to be *less* bad than a
first reading suggested, which is exactly why the check was worth doing.

1. **No orchestrator-side timing — but claude reports its own.** `AgentResult`
   (`src/adapters.ts`) is `{ok:true, text, costUsd?, raw?} | {ok:false, error,
   budgetExhausted?, raw?}`: **no duration field**, and `runIsolated` does not time its
   turns. What *is* already in the raw capture: claude's envelope carries `duration_ms`,
   `duration_api_ms`, and `ttft_ms`. That is per-vendor and API-side, so it cannot give the
   per-phase maxima §3.2 needs, and it says nothing about worktree/lock overhead.
   **Recording `agentMs` + `turnMs` in `runIsolated` remains the single highest-value small
   change in this document** — but the honest claim is "no *vendor-neutral,
   orchestrator-side* timing," not "no timing anywhere."
2. **Dollars are claude-only; tokens cover two adapters.** `costUsd` comes from claude's
   `total_cost_usd`. **Tokens, however, are already present** in the raw captures for
   claude (`usage`, `modelUsage`) *and* codex (`turn.completed.usage`, with
   `input`/`cached_input`/`output`/`reasoning` split out) — neither is surfaced on
   `AgentResult`. `agy` is plain text and reports **nothing** (verified); `pi` and
   `copilot-cli` are unverified. So: **wall-clock and turn counts remain the only
   vendor-neutral currency**, tokens are a strong two-adapter signal worth surfacing, and
   dollars are a single-adapter signal that **must never be summed as a run total** — a
   lineup-wide cost figure would be quietly wrong by however much codex spent.
3. **Failure modes are not machine-classifiable.** `ok:false` carries a human-readable
   `error` string, so setup-vs-agent classification means string-matching today. A
   structured `kind` field on the failure branch is the clean fix (`4_PLAN.md` §3 notes
   the same gap from the other direction).
4. **Rounds and phases are not labelled**; the round is encoded in `Turn.title`
   (`"Round 1 reaction — …"`), so per-round aggregation parses prose. A `phase`/`round`
   field is the honest fix (§4's `turnMeta`).
5. **Evidence execution is partly observable today — better news than expected.** `codex`
   emits `item.completed` items of type **`command_execution`** (a single real repo-grounded
   turn carried 26), so counting executions per turn needs **no claim ledger** — just a
   pass over `raw.stdout` that the codex classifier already walks. `claude`'s envelope is a
   summary with no tool log (`num_turns` and `permission_denials` are proxies only; a real
   log needs `--output-format stream-json`), and `agy` offers nothing. This is what makes
   `4_PLAN.md` §8's **run-level validity check** ("did this debate execute anything?")
   available now rather than deferred — and it is the strongest argument for keeping `codex`
   in the M2 lineup.

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

1. **`agentMs` + `turnMs`** — time both brackets in `runIsolated` (`src/debate.ts`), so
   isolation overhead stays separable from model latency (§3.2). Test against `test/fakes/`.
2. **`phase` / `round` / `promptBytes` on the turn record** — stop parsing titles, and
   capture the prompt size at spawn time, since it is unrecoverable afterwards (§4, §6.4).
3. **`ranCommands` per turn** — count codex `command_execution` items in the classifier;
   expose claude's `num_turns`/`permission_denials` as the proxy. This is what makes
   `4_PLAN.md` §8's evidence-validity check enforceable, so it should land **before** the
   gate runs, not after.
4. **`metrics.json`** — a pure function `MetricsInput → Tier-0 metrics` (§4), written next
   to `debate.md`. Pure means unit-testable against captured fixtures with no CLI and no
   filesystem at all.
5. **Artifact-history aggregator** — a separate reader over `.debate/<dir>` for verdict
   revisions, and over `.debate/*/metrics.json` for the cross-run baseline in §7. Kept out
   of the pure function on purpose.

Steps 1–3 are the ones the M2 gate actually depends on; 4–5 are reporting convenience.

Deliberately **not** in that increment: the claim ledger (Tier 1), any threshold, and any
model-in-the-loop metric. Tier 0 first, because it is free, honest, and immediately useful
to the gate.
