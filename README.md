# Disputatio

**Structured debate between real AI coding-agent CLIs.**

![Cover](assets/images/Cover.jpg)

Disputatio is a local-first tool that orchestrates a structured debate between
multiple *real* AI coding agents — Claude Code, Codex CLI, Antigravity (Gemini),
Pi — run as their native CLIs, not as raw LLM API calls. It automates the
copy-paste-between-terminals workflow many developers already do by hand: ask one
agent, have another critique it, iterate, converge.

> **Status: experimental, early MVP — v0.6.0.** Rough but runnable. The core premise —
> that cross-harness debate produces materially better decisions than a single
> strong agent — is **not yet validated**; v0 exists to dogfood the workflow on
> real tasks. See [`4_PLAN.md`](./docs/4_PLAN.md) for the honest state and roadmap.
> Full history: [CHANGELOG](./CHANGELOG.md).

## Why real harnesses (not custom LLM agents)

The value is the *native agent environments* — their tools, memory, and the ability
to **run code**. An objection backed by a failing test ("I ran the suite and it
fails here") beats one backed by rhetoric. That executable-evidence grounding is the
thing API-level multi-agent frameworks cannot easily reproduce, and it is what
Disputatio is built around.

## This project is being talked about

- `EN` [Building a Debate Engine for AI Coding Agents](https://medium.com/@m.mastrodonato/building-a-debate-engine-for-ai-coding-agents-disputatio-5cd1e3e4c5b4?sharedUserId=m.mastrodonato)
- `IT` [Un motore di dibattito per (far litigare) agenti AI](https://open.spotify.com/episode/1UkBpIJLV3uAurOcHnxvl3?si=A5BX6ECXTSaPEPFRHVEPTw)

## How to Run

### Prerequisites

- **Node ≥ 24**.
- [`claude`](https://code.claude.com) and [`codex`](https://developers.openai.com/codex)
  (default lineup) installed and **already authenticated** (authentication is out of
  scope — log in to each CLI first). [`agy`](https://antigravity.google) is optional,
  via `--config`. **Account hygiene matters:** only point a CLI at repositories its
  credentials and policy are allowed to access.

### Install and use

Install the published CLI, then run `disputatio` from any repository:

```bash
npm install -g disputatio
```

After installing (and logging into each CLI), run **`disputatio --init`** once: it canaries
the lineup, resolves each CLI's real binary (handling shadowed/stale installs), and writes a
machine-tuned config to `~/.config/disputatio/config.yaml`. That file — not the shipped
`examples/debate.yaml` (a copy-me **template**) — is what a no-`--config` run reads.

**Config precedence (no `--config` given):** `~/.config/disputatio/config.yaml` if present,
else the built-in lineup (`claude` + `codex`, no judge). An explicit `--config <path>` always wins.

### Usage

```bash
# one-time setup after authenticating each CLI: detect binaries + write the user config
# (with an opus judge seeded). --force overwrites an existing config (otherwise it's backed up).
disputatio --init

# preflight: canary every participant CLI (runnable + authenticated) before
# spending tokens on a real debate. Exit 0 = all healthy, exit 1 = something's off.
# Run this first, especially on a new machine.
disputatio --doctor
disputatio --doctor --config examples/debate.yaml   # check a specific lineup

# one proposal round + one reaction round (pure reasoning, isolated temp dirs).
# the quaestio is given inline — quote it so the shell passes it as one argument
disputatio "Review changes in this branch and find issues."

# for a long quaestio, read it from a markdown file instead
disputatio --file examples/task.md

# more reaction rounds
disputatio "Review changes in this branch and find issues." --rounds 2

# point the agents at a real repo so they can gather READ-ONLY evidence
# (this is where the executable-evidence value actually lives);
# agents work in a throwaway git worktree of HEAD, never your real checkout
disputatio "Review changes in this branch and find issues." --repo /path/to/your/repo

# choose the lineup/models/budgets/effort explicitly (see examples/debate.yaml).
# per-participant `effort` doses token spend — claude: low|medium|high|xhigh|max;
# codex: minimal|low|medium|high; agy: encode it in the model name (no effort key).
disputatio --file path/to/task.md --rounds 1 --repo /path/to/your/repo --config examples/debate.yaml

# --- closing the loop (when a judge ran) ---------------------------------------------

# the judge ended in NEEDS_INPUT? answer its open questions and re-judge the latest
# debate. If it now resolves, the final deliverable (final-report.md) is drafted too.
disputatio --continue "Async translation; files are comment-free; translator hands files to a dev."

# ground that deliverable in your real repo (read-only worktree of HEAD), and/or target
# a specific past debate instead of the latest one:
disputatio --continue "<answers>" --debate /path/to/repo/.debate/debate-<ts> --repo /path/to/repo

# (re)draft final-report.md from an already-resolved debate (no re-judging)
disputatio --finalize --debate .debate/debate-<ts> [--repo /path/to/your/repo]
```

Output lands in `.debate/debate-<timestamp>/` (see [the flow](#the-flow-phases--artifacts)
below for what each file is). The **path printed to stdout** is the primary artifact —
the deliverable (`final-report.md`) when one was produced, otherwise the transcript
(`debate.md`); all progress goes to stderr. If fewer than two proposals succeed the
debate **aborts with exit 1** (a one-voice "debate" is worthless) — the partial
transcript and raw captures are kept.

### Run from source

If you are working from a clone of this repository, Node 24 can execute the TypeScript
entry point directly, so there is no build step for local development. Use the same
commands as above, replacing `disputatio` with `node src/index.ts`:

```bash
node src/index.ts --doctor
node src/index.ts "Review changes in this branch and find issues."
node src/index.ts --file path/to/task.md --rounds 1 --repo /path/to/your/repo --config examples/debate.yaml
```

For local development, `npm run debate -- "<quaestio>"` is equivalent to
`node src/index.ts "<quaestio>"`. Run the fixture-based test suite with `npm test`;
it does not call real agent CLIs.

## How it works (v0)

- **Cross-vendor** participants by design — default `claude` (Anthropic) + `codex`
  (OpenAI); `agy` (Google/Gemini) via config — because diversity of reasoning is the
  whole point.
- Each agent turn runs in **isolation**: a throwaway temp dir, or — when you pass a
  repo — a **detached throwaway git worktree of HEAD**, so agentic CLIs can't read
  each other's outputs, and test runs / stray writes never touch your real checkout.
- `claude` is read via its JSON envelope (success = `exit==0 && is_error==false`);
  `codex` via its JSONL event stream (last `agent_message` + `turn.completed`);
  `pi` ([earendil-works/pi](https://github.com/earendil-works/pi), a minimal,
  low-token multi-LLM harness) via its `--mode json` event stream (last assistant
  `message_end`); `agy` is text-only (stdout is the answer). All invocation details are
  grounded in real local runs — see [`research/canary-results.md`](./research/canary-results.md).

## The flow: phases & artifacts

A run moves through these phases (scholastic names in parentheses — Disputatio models
a medieval *disputatio*). Everything from the respondeo on is **opt-in**: it runs only
when the config defines a `judge` (e.g. the opus judge `--init` seeds).

1. **Proposals** (*videtur quod*, "it seems that…") — every agent independently answers
   the quaestio, in isolation, so no one peeks at another's take. Needs ≥2 to succeed.
2. **Reaction rounds** (*sed contra*, "but against this…") — each agent reacts
   adversarially to the full transcript: where it agrees, where it disagrees (with
   real flaws), what's missing — ideally backed by **executable evidence**. `--rounds N`.
3. **Respondeo** (the judge's *consolidatio*, the determination) — one judge reads the
   whole transcript and renders the verdict: the **settled agreements**, a **ruling on
   each contested point** (favouring positions backed by run code over rhetoric), or —
   when a point genuinely can't be settled from the transcript — a list of
   **questions for you** (status `NEEDS_INPUT`) instead of a guessed answer.
4. **Redactio** (the deliverable) — *only* when the respondeo resolves, the judge then
   acts as **synthesizer** and writes the document you actually start the work from
   (an implementation plan, a review, a proposal…), built from the settled decisions.
   With `--repo` it grounds this in your real files (read-only).

When the respondeo asks for input, you **close the loop** with
`disputatio --continue "<your answers>"`: it folds your answers in and re-judges. If
that resolves, the deliverable is drafted. (If your answer opens a question the
debaters never argued, the judge says so rather than inventing a verdict — re-run the
debate to bring them back in.)

**What you get in `.debate/debate-<timestamp>/`:**

| File              | What it is                                                                    |
| ----------------- | ----------------------------------------------------------------------------- |
| `debate.md`       | the full transcript — proposals, reactions, and the respondeo                 |
| `respondeo.md`    | the judge's ruling **on** the debate (versioned `-2`, `-3`… per `--continue`) |
| `final-report.md` | the **redactio**: the deliverable born **from** the debate — start work here  |
| `raw/`            | per-turn raw CLI captures, the only way to diagnose a failed turn             |

> `respondeo.md` judges the debate; `final-report.md` is the product. They are
> different documents on purpose — the verdict tells you *what was decided*, the
> deliverable gives you *the thing to execute*.

## Known v0 limitations (next steps)

- No scholastic **`consolidatio` as a pre-debate step** (merging N proposals into one
  shared object for the skeptics to attack), no structured contribution trailer /
  evidence-typing yet. The `respondeo` (verdict) and `redactio` (deliverable) phases
  **do** exist.
- `--continue` re-judges **alone**; it does not yet re-engage the debaters when your
  answer opens genuinely new ground (it flags that case instead). A crashed run is not
  resumable — it accumulates in memory and writes at the end, so restart from scratch.
- Reaction rounds are parallel snapshots (agents react to proposals, not to each
  other's same-round reactions).
- Timeout kills the whole **process group** (`SIGTERM`, then `SIGKILL` after a short
  grace), so a slow turn can't wedge the run by leaking a worker that holds the output
  pipe open (lesson from the 2026-06-12 repo-grounded run).
- Evidence mode shows agents **HEAD only** (uncommitted changes are invisible) and
  untracked build artifacts (`node_modules`, …) are absent from the worktree, so
  some test suites won't run there.

## How to add a new adapter

**What an adapter is.** An adapter is Disputatio's anti-corruption boundary around one
agent CLI. It does exactly one job: spawn the CLI in a sandboxed working directory,
capture its output, and classify the run as success (`{ok:true, text}`) or failure
(`{ok:false, error}`). Everything quirky about a given CLI — its flags, its output
format (JSON envelope vs. JSONL stream vs. plain text), how it signals an error — is
hidden here, so the debate logic never has to care which vendor it is talking to. The
contract is the `Participant` type in [`src/adapters.ts`](./src/adapters.ts):

```ts
type Participant = {
  id: string;       // short stable key ("claude", "codex", "pi")
  display: string;  // human label, encodes model ("Pi (anthropic/claude...)")
  vendor: string;   // used for the cross-vendor diversity check — keep it DISTINCT
  run: (prompt: string, cwd: string) => Promise<AgentResult>;
};
```

Two invariants every adapter must honor (both are correctness, not style):

- **Read-only evidence.** The agent may inspect the repo but must never mutate it —
  use the CLI's strongest read-only mechanism (OS sandbox if it has one, otherwise a
  tool allowlist that omits write/edit/shell-exec). Disputatio already isolates each
  turn in a throwaway temp dir / git worktree, but the adapter is the second defense.
- **Cross-vendor diversity.** Give the adapter a `vendor` distinct from the others —
  diversity of reasoning is the entire premise, and `index.ts` warns on a lineup that
  isn't all-distinct vendors.

**The recipe (a prompt you can hand to an agent):**

> Add a new adapter for `<CLI>` to Disputatio, following the existing `codex`/`pi`
> adapters as the template. Work TDD and keep the repo runnable at each step:
>
> 1. **Research the CLI's headless mode first.** Find the flags for: non-interactive /
>    print mode, the prompt argument, model selection, a machine-readable output format
>    (JSON if available), reasoning effort, and read-only/sandbox/tool-allowlist. Verify
>    them against a real `--help` or the official docs — do not guess. Capture findings
>    in `research/` (and a real canary capture if you can run it).
> 2. **Write the adapter** in `src/adapters.ts`: an `xAdapter(model?, opts?)` factory
>    returning a `Participant`. Reuse `runCli`, `spawnFailure`, and the `AgentResult`
>    shape. Parse the output and classify success/failure on a STRUCTURAL signal (exit
>    code + a definite success marker), never a text match. Make `bin` overridable if a
>    stale shim could shadow the binary.
> 3. **Wire it in** (four sites): add the id to `AdapterId` and the `ADAPTERS` /
>    `PARTICIPANT_KEYS` sets + error strings in `src/config.ts`; add a `case` to
>    `buildParticipant` in `src/index.ts`; if `bin` is overridable, add the id to
>    `BIN_OVERRIDABLE` in `src/install.ts`.
> 4. **Test it** like the others: drop a `test/fakes/<cli>` shim (copy `test/fakes/pi`)
>    and a captured fixture under `test/fixtures/`, then add classifier tests to
>    `test/adapters.test.ts` (success, the read-only flags, effort on/off, an error
>    path, a `bin` override). Run `npm test`.
> 5. **Document it**: mention it in this README's "How it works" list and in
>    `docs/3_ADAPTERS.md`, add a commented example block to `examples/debate.yaml`, and
>    bump the version / CHANGELOG / README status line per the rules in `CLAUDE.md`.
> 6. **Open an MR** with a subject `vX.Y.Z <CLI> adapter` and a body summarizing the
>    headless recipe and the read-only mechanism you chose.

## Design documents

| Doc                                     | What                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| [`1_IDEA.md`](./docs/1_IDEA.md)         | Original vision                                                                     |
| [`2_CONCEPT.md`](./docs/2_CONCEPT.md)   | Refined concept: the *disputatio* protocol, roles, executable evidence, convergence |
| [`3_ADAPTERS.md`](./docs/3_ADAPTERS.md) | Headless-integration design for each agent CLI                                      |
| [`4_PLAN.md`](./docs/4_PLAN.md)         | Implementation plan, stack rationale, milestones                                    |
| [`research/`](./research/)              | Headless-mode research + real canary runs per CLI                                   |

## License

Apache License 2.0. See [LICENSE](./LICENSE).
