# Disputatio

**Structured debate between real AI coding-agent CLIs.**

![Cover](assets/images/Cover.jpg)

Disputatio is a local-first tool that orchestrates a structured debate between
multiple *real* AI coding agents — Claude Code, Codex CLI, Antigravity (Gemini) —
run as their native CLIs, not as raw LLM API calls. It automates the
copy-paste-between-terminals workflow many developers already do by hand: ask one
agent, have another critique it, iterate, converge.

> **Status: experimental, early MVP (v0).** Rough but runnable. The core premise —
> that cross-harness debate produces materially better decisions than a single
> strong agent — is **not yet validated**; v0 exists to dogfood the workflow on
> real tasks. See [`4_PLAN.md`](./4_PLAN.md) for the honest state and roadmap.

## Why real harnesses (not custom LLM agents)

The value is the *native agent environments* — their tools, memory, and the ability
to **run code**. An objection backed by a failing test ("I ran the suite and it
fails here") beats one backed by rhetoric. That executable-evidence grounding is the
thing API-level multi-agent frameworks cannot easily reproduce, and it is what
Disputatio is built around.

## How to Run

### Prerequisites

- **Node ≥ 24** (runs TypeScript natively — no build step).
- [`claude`](https://code.claude.com) and [`codex`](https://developers.openai.com/codex)
  (default lineup) installed and **already authenticated** (authentication is out of
  scope — log in to each CLI first). [`agy`](https://antigravity.google) is optional,
  via `--config`. **Account hygiene matters:** only point a CLI at repositories its
  credentials and policy are allowed to access.

### Usage

```bash
# one proposal round + one reaction round (pure reasoning, isolated temp dirs)
node src/index.ts examples/task.md

# more reaction rounds
node src/index.ts examples/task.md 2

# point the agents at a real repo so they can gather READ-ONLY evidence
# (this is where the executable-evidence value actually lives);
# agents work in a throwaway git worktree of HEAD, never your real checkout
node src/index.ts path/to/task.md 1 /path/to/your/repo

# choose the lineup/models/budgets explicitly (see examples/debate.yaml)
node src/index.ts path/to/task.md 1 /path/to/your/repo --config examples/debate.yaml

# run the test suite (fixture-based, no real agent calls)
npm test
```

Output: a transcript at `.debate/debate-<timestamp>/debate.md` (its path is printed
to stdout; progress goes to stderr), plus per-turn raw CLI captures under
`.debate/debate-<timestamp>/raw/` for diagnosing failures. If fewer than two
proposals succeed the debate **aborts with exit 1** (a one-voice "debate" is
worthless) — the partial transcript and raw captures are kept.

## How it works (v0)

- **Cross-vendor** participants by design — default `claude` (Anthropic) + `codex`
  (OpenAI); `agy` (Google/Gemini) via config — because diversity of reasoning is the
  whole point.
- Each agent turn runs in **isolation**: a throwaway temp dir, or — when you pass a
  repo — a **detached throwaway git worktree of HEAD**, so agentic CLIs can't read
  each other's outputs, and test runs / stray writes never touch your real checkout.
- `claude` is read via its JSON envelope (success = `exit==0 && is_error==false`);
  `codex` via its JSONL event stream (last `agent_message` + `turn.completed`);
  `agy` is text-only (stdout is the answer). All invocation details are grounded in
  real local runs — see [`research/canary-results.md`](./research/canary-results.md).

## Known v0 limitations (next steps)

- No scholastic `consolidatio` / `respondeo` / structured contribution trailer /
  evidence-typing yet.
- Reaction rounds are parallel snapshots (agents react to proposals, not to each
  other's same-round reactions).
- Timeout kills the direct child only (process-tree kill is a later hardening).
- Evidence mode shows agents **HEAD only** (uncommitted changes are invisible) and
  untracked build artifacts (`node_modules`, …) are absent from the worktree, so
  some test suites won't run there.

## Design documents

| Doc                                | What                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| [`1_IDEA.md`](./1_IDEA.md)         | Original vision                                                                     |
| [`2_CONCEPT.md`](./2_CONCEPT.md)   | Refined concept: the *disputatio* protocol, roles, executable evidence, convergence |
| [`3_ADAPTERS.md`](./3_ADAPTERS.md) | Headless-integration design for each agent CLI                                      |
| [`4_PLAN.md`](./4_PLAN.md)         | Implementation plan, stack rationale, milestones                                    |
| [`research/`](./research/)         | Headless-mode research + real canary runs per CLI                                   |

## License

TBD.
