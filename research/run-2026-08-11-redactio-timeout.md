# Real run, 2026-08-11 — the redactio timeout, and why it looked like a lost run

**Scrubbed.** The debate answered a product question on a private work repository. Nothing
about that question is recorded here; every fact below is about Disputatio's own behaviour,
taken from the run's raw captures (gitignored).

## What happened

Three participants, 1 reaction round, opus judge, repo mode. Proposals, reactions and the
respondeo all succeeded — `respondeo.md` was written with `STATUS: RESOLVED`. Then the
redactio (the deliverable) hit the per-turn cap and the run ended with:

```
[disputatio] ⚠️ redactio failed: timeout
```

and nothing else. `final-report.md` was never written.

## What the killed turn actually cost

From the partial envelope in `raw/08-final-report-claude-opus.json`:

| field | value |
| --- | --- |
| `duration_api_ms` | 578241 (9m 38s, against a 600s cap) |
| `num_turns` | 34 |
| `stop_reason` | `tool_use` — still working when killed |
| `total_cost_usd` | **3.26** |
| `output_tokens` | 30631 |
| `result` | absent — no deliverable text to salvage |

So the turn was not stuck; it was **9.6 minutes into a 10-minute budget and still going**.
There is no partial deliverable to recover — only the cost.

## Three distinct defects

1. **The recovery existed and was invisible.** `--finalize --debate <dir>` re-runs exactly
   the turn that died, from the saved transcript and RESOLVED respondeo. Verified against a
   copy of this very run: it recovers the quaestio, reads the verdict, drafts, and writes
   `final-report.md`. But `index.ts` printed the retry hint **only when
   `budgetExhausted`** — at all three call sites. A timeout got `""`. The user was told a
   turn failed and given no way forward.

2. **A uniform per-turn cap is structurally wrong for the redactio.** It is the last turn,
   its input is the entire transcript *plus* repo traversal, and it is the only turn whose
   failure discards the run's whole point. Debaters do not have that cost profile.

3. **The spend vanished from every artifact.** The claude adapter returned on `r.timedOut`
   *before* parsing stdout, so `total_cost_usd` and `num_turns` were dropped even though
   the partial envelope carried them. A $3.26 turn recorded as costless is the same class
   of error as an unknown counted as a zero — the thing v0.8.0's evidence check exists to
   avoid.

## Fixed in v0.9.0

`--timeout <minutes>` (per turn; `timeoutMinutes` already existed in config, only the flag
was missing); the synthesizer gets 2x the cap via an optional `synthesizer` participant on
`runDebate`; one `finalizeRetryHint()` shared by all three sites, printed for **every**
redactio failure with the flag that addresses the cause; and the adapter salvages cost +
`num_turns` from a timed-out envelope, rendering `_(spent before failing: $X)_`.

## Rejected: an interactive "continue or exit?" prompt

It was the obvious reading of the problem, and it is the wrong fix. The failure is already
recoverable from disk, so the only useful answer to the prompt is a command the tool can
print unprompted. Blocking on stdin would also break unattended and agent-driven runs —
stdout is the artifact path by invariant — and a question asked ~25 minutes in, when the
user has walked away, is the least useful moment to ask one.

The user's instinct was right about the *symptom* (work appears lost); the cause was a
missing sentence, not missing interactivity.

## Note for the next timeout

v0.8.0's per-turn `agentMs`/`turnMs` now record how close each turn ran to its cap, so the
next one is diagnosable from the artifact instead of the raw envelope. This run predates
that instrumentation, which is why the table above had to be read out of raw JSON.
