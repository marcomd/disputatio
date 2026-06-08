# Pre-M0 hand-run debate — result (2026-06-07)

The cheapest premise test from `4_PLAN.md` §8/§11: a **manually orchestrated**
*disputatio* debate, run by Claude using the real CLIs, on a **real past design
task whose outcome the user knows** — the original brainstorm that founded this
project (decision actually taken: drop `recursivemas`, build Disputatio on
harness-orchestration). Goal: does grounding an objection in **executable
evidence** change or materially sharpen the call vs. what actually happened?

## Setup

- Isolated working dir (`/tmp/disp-prem0`) with **only** `task.md` (the verbatim
  brainstorm) — so agents could not see the `1`→`4` Disputatio docs (no
  contamination from the already-decided outcome).
- Debaters (cross-vendor): `claude` (Claude Sonnet 4.6) + `agy` (Gemini 3.5 Flash).
- Protocol: gate path — *videtur quod → (verifier with real web tools) → respondeo*.
  `consolidatio`/`humanloop` omitted (N=2, unattended), per plan.

## Round 1 — videtur quod (ungrounded)

Both agents independently concluded **"drop recursivemas, build a thin
subprocess-orchestration debate tool"** — matching the user's actual decision.

But both reached "drop" via an **unverified assumption** about what recursivemas
is: claude said *"almost certainly operates at the API/SDK layer"*; agy said
*"latent-space recursion and API-level coordination."* Neither had checked.

> **Contamination caught live (adapter lesson):** `agy`'s print mode is agentic and
> autonomously **read `rounds/r1-claude.json`** before writing its own proposal
> (*"I will read the contents of rounds/r1-claude.json to see what Claude
> proposed"*). So agy's R1 was **not independent**. → Confirms `3_ADAPTERS.md`: the
> transport layer must run each agent in its **own isolated dir** and keep sibling
> outputs out of the workspace. A real, unplanned finding.

## Verifier — grounded in executable evidence (the moat)

Forced the objection to carry real evidence: an agent fetched recursivemas and
**searched for existing tools**. Independently re-verified by Claude (this session)
with its own fetches — not trusting a single agent.

1. **What recursivemas actually is** (verified): an academic ML framework for
   latent-space multi-agent recursion (RecursiveLink module, hidden-state tensor
   exchange, custom gradient training; arXiv:2604.25917, GitHub, HF models). It
   requires shared model internals → **architecturally cannot** shell out to
   black-box CLIs. → "Drop it" is **correct, now with evidence** (the R1 instinct
   was right; it just needed grounding).

2. **A near-identical tool ALREADY EXISTS** (the decision-relevant finding the
   ungrounded brainstorm and R1 both missed):
   - **Mysti** — `github.com/DeepMyst/Mysti` — VS Code extension that orchestrates
     Claude Code / Codex / Gemini (and more) **as local subprocesses**, with a
     **Brainstorm mode** offering Debate / Red-Team / Perspectives / Delphi
     strategies + synthesis. Apache-2.0/MIT, ~1.1k stars, active (v0.4.0, Mar 2026).
     **Independently verified by Claude's own fetch of the repo + the HN "Show HN"
     thread** — not a hallucination.
   - Also surfaced: CLITrigger, Maestro-Orchestrate, EloPhanto (subprocess/worktree
     multi-CLI orchestration with discussion/review modes).

## Respondeo (determination)

Synthesized by Claude-as-orchestrator (a separate Opus call was skipped — the
determination is unambiguous and the cost was not warranted):

- **On recursivemas:** confirmed drop, now evidence-backed.
- **On "build a new tool":** materially **weakened**. The honest call is no longer
  "build Disputatio"; it is **"evaluate Mysti (and CLITrigger / Maestro /
  EloPhanto) first, and justify building Disputatio only by what they specifically
  lack"** — e.g. headless/non-VS-Code operation, markdown-as-source-of-truth with
  round-by-round transcripts, the scholastic protocol, **evidence-typed/weighted**
  contributions, and an eval-gated premise check.

## Verdict on the premise test

**This run did NOT test the gated hypothesis — and saying it did would be motivated
optimism.** What actually moved the decision was a **web search for prior art**. On
the project's own taxonomy that is *not* the moat:

- **Not executable evidence.** The moat is `command-output` — *running tests,
  reproducing a bug* — what a chatbot cannot do. Nothing was executed here. Web
  search exists in nearly every chat product, including the web-UI the user
  brainstormed in.
- **Not a debate / multi-agent property.** The two agents **agreed** (both: drop +
  build). No disagreement was created or resolved; the adversarial structure
  contributed nothing measurable. If anything, mild evidence *against* the
  multi-agent premise.
- **Replicable single-agent.** One agent *told to verify its assumptions* would
  have found Mysti. The real (weaker, different) lesson: a structured protocol
  forces a verification step humans skip — valuable, but not the stated moat.

A no-code design question has **nothing to execute** and produced no disagreement,
so it structurally **cannot** exercise either differentiator. **Premise status:
still UNVALIDATED** (not "encouraging").

**What IS solid (independently verified): Mysti + ≥3 other tools already do
harness-level multi-CLI orchestration.** This is the real, durable deliverable and
it stands regardless of the premise question.

**Strategic mismatch this exposed:** the MVP scope — *debate over plans, no repo
mutation* — is exactly where the executable-evidence moat is **weakest**, because
plans have nothing to run. The moat lives in **code / implementation review** ("I
ran the suite and it fails"). The cheap/safe scope chosen is the one that cannot
exercise the differentiator. The concept docs (`2_CONCEPT.md` §9, `4_PLAN.md` §8)
have not confronted this.

## Implication for next steps

Before any M0 code:
- **Evaluate Mysti hands-on** (and the others) against Disputatio's intended
  differentiators. Decide build-vs-reuse-vs-contribute on evidence.
- If building proceeds, re-scope `1`→`4` around the *gap* Mysti leaves, not around
  a blank field.
- The premise remains **untested**; what justifies the next step is the **Mysti
  finding** (prior art exists), not a premise signal. Evaluate before building.
