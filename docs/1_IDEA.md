# Disputatio: Structured debate for AI coding agents.

## Vision: Ideas deserve opposition.

Disputatio is a local-first orchestration tool that enables structured debates between multiple AI coding agents such as Claude Code, Codex, Gemini CLI, Aider, and future agentic coding systems.

The goal is not to replace these tools with custom LLM wrappers.

The value comes from leveraging each agent's native capabilities, tooling ecosystem, reasoning style, and code generation workflow while automating the debate process that developers currently perform manually.

---

# Problem Statement

When working on software architecture, implementation plans, technical analyses, or complex code changes, a common workflow is:

1. Ask Agent A (e.g. Claude Code) to produce a solution.
2. Ask Agent B (e.g. Codex) to review the solution and provide criticism.
3. Ask Agent C (e.g. Gemini CLI) to review both previous outputs.
4. Return the collected feedback to Agent A.
5. Repeat multiple rounds until consensus emerges.

This process often produces higher-quality outcomes but is extremely time-consuming because the developer manually:

* copies context between agents;
* maintains discussion history;
* summarizes previous rounds;
* tracks agreements and disagreements;
* manages iteration cycles.

Disputatio automates this workflow.

---

# Core Principles

## 1. Use Real Agent Harnesses

The system should orchestrate existing agent tools rather than replacing them.

Examples:

* Claude Code
* Codex CLI
* Antigravity CLI
* Cursor CLI
* Future coding agents

The debate should happen between actual tool-using agents operating in real repositories.

---

## 2. Local First

All debate data should remain local.

Outputs are stored as files.

No cloud backend is required.

---

## 3. Markdown as Source of Truth

All debate artifacts should be stored in Markdown.

Example:

```txt
.debate/
├── task.md
├── state.json
├── rounds/
│   ├── round-1.md
│   ├── round-2.md
│   └── round-3.md
├── final-report.md
└── metadata.json
```

Benefits:

* human-readable;
* git-friendly;
* AI-friendly;
* easy to inspect and modify;
* future-proof.

The UI should consume these files rather than becoming the primary data source.

---

## 4. Debate Over Chat

The objective is not to build a multi-agent chat.

The objective is to drive convergence toward better decisions.

Every contribution should be structured around:

* proposals;
* evidence;
* risks;
* objections;
* alternative approaches;
* unresolved questions.

---

# Proposed CLI

## Run a Debate

```bash
disputatio run \
  --task task.md \
  --repo . \
  --agents claude,codex,gemini \
  --rounds 2
```

---

## Resume a Debate

```bash
disputatio resume debate-id
```

---

## Open Local UI

```bash
disputatio ui
```

---

## Generate Final Report

```bash
disputatio finalize debate-id
```

---

# Architecture

```txt
                 ┌─────────────────┐
                 │ Debate CLI      │
                 └────────┬────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
   Claude Adapter   Codex Adapter   Gemini Adapter

          │               │               │
          └───────┬───────┴───────┬───────┘
                  ▼               ▼

             Debate Engine
                  │
                  ▼
            State Storage
                  │
                  ▼
              Markdown
                  │
                  ▼
               Local UI
```

---

# Agent Adapter Model

Each supported agent should implement a common interface.

```ts
interface AgentAdapter {
  name: string

  preparePrompt(state): string

  run(prompt, workspace): Promise<AgentResult>

  extractSummary(result): DebateContribution
}
```

The adapter layer isolates agent-specific details from the debate engine.

---

# Debate Workflow

## Round 1

Agent A produces an initial proposal.

Agent B reviews it.

Agent C reviews both.

---

## Round 2

Agents receive:

* original task;
* previous debate;
* unresolved issues.

Agents should not repeat previous content.

They should only address:

* disagreements;
* missing considerations;
* open questions.

---

## Finalization

The system generates:

* consensus decisions;
* unresolved disagreements;
* implementation recommendations;
* risks;
* follow-up actions.

---

# Local UI

The web UI is not responsible for storing debate state.

Its responsibility is to visualize debate artifacts already stored in Markdown.

Possible features:

* round navigation;
* agent comparison;
* agreement/disagreement highlighting;
* decision timeline;
* diff visualization;
* search and filtering.

The UI should be a view layer over existing files.

---

# Future Directions

## Repository-Aware Debates

Allow agents to operate directly on repositories.

Possible workflows:

* architecture reviews;
* implementation reviews;
* PR reviews;
* refactoring proposals.

---

## Parallel Execution

Allow multiple reviewers to run concurrently.

Example:

```txt
Claude → Proposal

       ├─ Codex Review
       ├─ Gemini Review
       └─ Aider Review
```

---

## Consensus Engine

Automatically identify:

* agreements;
* conflicts;
* recurring concerns;
* unresolved blockers.

---

## Branch Isolation

Each agent may operate in its own git worktree.

This enables direct comparison of competing implementations.

---

# Success Criteria

The project succeeds if it:

1. Produces better software decisions than a single agent.
2. Reduces manual context switching between agents.
3. Preserves the strengths of each native AI harness.
4. Remains transparent and inspectable through Markdown artifacts.
5. Scales from solo developers to team workflows.
6. Keeps the debate focused on convergence rather than endless discussion.
