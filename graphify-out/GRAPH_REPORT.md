# Graph Report - Disputatio  (2026-06-18)

## Corpus Check
- 50 files · ~60,218 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 661 nodes · 732 edges · 51 communities (42 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e74d63ff`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Debate Engine & Transport Core|Debate Engine & Transport Core]]
- [[_COMMUNITY_Headless CLI Capabilities|Headless CLI Capabilities]]
- [[_COMMUNITY_Source Code Modules|Source Code Modules]]
- [[_COMMUNITY_Design Principles & Prior Art|Design Principles & Prior Art]]
- [[_COMMUNITY_Scholastic Disputatio Protocol|Scholastic Disputatio Protocol]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_CLI Output Classification|CLI Output Classification]]
- [[_COMMUNITY_Design Document Chain|Design Document Chain]]
- [[_COMMUNITY_Tool Permissions & Aider|Tool Permissions & Aider]]
- [[_COMMUNITY_Graphify Integration|Graphify Integration]]
- [[_COMMUNITY_Claude Hooks Config|Claude Hooks Config]]
- [[_COMMUNITY_Codex Hooks Config|Codex Hooks Config]]
- [[_COMMUNITY_CLI Flag Version Fragility|CLI Flag Version Fragility]]
- [[_COMMUNITY_Stateless Markdown Design|Stateless Markdown Design]]
- [[_COMMUNITY_Research Discipline|Research Discipline]]
- [[_COMMUNITY_Stateless Run Decision|Stateless Run Decision]]
- [[_COMMUNITY_Prompt Caching Cost Lever|Prompt Caching Cost Lever]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]

## God Nodes (most connected - your core abstractions)
1. `What You Must Do When Invoked` - 16 edges
2. `/graphify` - 15 edges
3. `/graphify` - 14 edges
4. `What You Must Do When Invoked` - 14 edges
5. `Disputatio: Implementation Plan` - 13 edges
6. `Disputatio: Implementation Plan` - 13 edges
7. `Claude Code — Headless / Non-Interactive Mode (research, 2026-06-05)` - 12 edges
8. `Changelog` - 11 edges
9. `OpenAI Codex CLI — Headless / Automation Mode (research, 2026-06-05)` - 11 edges
10. `Disputatio: Refined Concept` - 11 edges

## Surprising Connections (you probably didn't know these)
- `README Codex Adapter Deferred Note` --conceptually_related_to--> `codexAdapter`  [AMBIGUOUS]
  README.md → src/adapters.ts
- `Codex Binary Override Example` --references--> `codexAdapter`  [EXTRACTED]
  examples/debate.yaml → src/adapters.ts
- `Graphify Query Path Explain Commands` --conceptually_related_to--> `Claude Graphify Grep Hook`  [INFERRED]
  .agents/skills/graphify/SKILL.md → .claude/settings.json
- `Graphify Update And Hook Workflow` --conceptually_related_to--> `Codex Graphify Hook Check`  [INFERRED]
  .agents/skills/graphify/SKILL.md → .codex/hooks.json
- `Example Debate Config` --references--> `claudeAdapter`  [EXTRACTED]
  examples/debate.yaml → src/adapters.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Agent Adapter Protocol** — adapters_participant_protocol, adapters_agent_result, adapters_run_cli, adapters_claude_adapter, adapters_agy_adapter, adapters_codex_adapter [EXTRACTED 1.00]
- **Debate Execution Flow** — index_cli_entry, config_parse_debate_config, debate_run_debate, debate_run_isolated, debate_worktree_isolation, index_artifact_writing [EXTRACTED 1.00]
- **Graphify Operating Model** — graphify_skill, graphify_query_path_explain, graphify_semantic_extraction, graphify_outputs, graphify_update_hooks [EXTRACTED 1.00]
- **AI Debate Participant Lineup** — Cover_claude_participant, Cover_codex_participant, Cover_gemini_participant [EXTRACTED 1.00]
- **AI Tribunal Visual Metaphor** — Cover_claude_participant, Cover_codex_participant, Cover_gemini_participant, Cover_judge_role, Cover_scales_of_justice, Cover_gavel [INFERRED 0.84]

## Communities (51 total, 9 thin omitted)

### Community 0 - "Debate Engine & Transport Core"
Cohesion: 0.09
Nodes (38): AgentResult, agyAdapter, Antigravity Text-Only Output, claudeAdapter, Claude JSON Envelope Classification, codexAdapter, Codex JSONL Stream Classification, Participant Protocol (+30 more)

### Community 1 - "Headless CLI Capabilities"
Cohesion: 0.11
Nodes (14): AgentResult, DebateOutcome, execFileAsync, gitLock, log(), parseRespondeoStatus(), respondeoPrompt(), RespondeoStatus (+6 more)

### Community 2 - "Source Code Modules"
Cohesion: 0.06
Nodes (30): For --cluster-only, For git commit hook, For /graphify add, For /graphify explain, For /graphify path, For /graphify query, For native CLAUDE.md integration, For --update (incremental re-extraction) (+22 more)

### Community 3 - "Design Principles & Prior Art"
Cohesion: 0.13
Nodes (14): duration_api_ms, duration_ms, errors, is_error, num_turns, permission_denials, session_id, stop_reason (+6 more)

### Community 4 - "Scholastic Disputatio Protocol"
Cohesion: 0.14
Nodes (13): api_error_status, is_error, result, session_id, stop_reason, subtype, total_cost_usd, type (+5 more)

### Community 5 - "Package Manifest"
Cohesion: 0.19
Nodes (14): AdapterId, ADAPTERS, DebateConfig, emitScalar(), emitSpec(), fail(), NUMERIC_KEYS, parseDebateConfig() (+6 more)

### Community 6 - "CLI Output Classification"
Cohesion: 0.31
Nodes (10): AI Agent Adjudication, AI Debate Courtroom, Claude Participant, Codex Participant, Gavel, Gemini Participant, Holographic Interfaces, Judge Role (+2 more)

### Community 7 - "Design Document Chain"
Cohesion: 0.08
Nodes (25): bin, disputatio, bugs, url, description, devDependencies, esbuild, engines (+17 more)

### Community 8 - "Tool Permissions & Aider"
Cohesion: 0.32
Nodes (8): Agent Tooling And Knowledge Graph Release, Claude Graphify Grep Hook, Codex Graphify Hook Check, Graphify HTML JSON Report Outputs, Graphify Query Path Explain Commands, Graphify Semantic Extraction Subagents, Graphify Skill, Graphify Update And Hook Workflow

### Community 9 - "Graphify Integration"
Cohesion: 0.29
Nodes (6): api_error_status, is_error, result, subtype, total_cost_usd, type

### Community 10 - "Claude Hooks Config"
Cohesion: 0.83
Nodes (4): 1_IDEA vision document, 2_CONCEPT refined concept, 3_ADAPTERS integration design, 4_PLAN implementation plan

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (26): 1. Use Real Agent Harnesses, 2. Local First, 3. Markdown as Source of Truth, 4. Debate Over Chat, Agent Adapter Model, Architecture, Branch Isolation, Consensus Engine (+18 more)

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (24): 10. Open risks and decisions, 1. Positioning, 2. Premise and validation, 3. The Disputatio protocol, 4. Roles and participants, 5. Executable evidence, 6. Convergence and human-in-the-loop, 7. Contribution contract (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (21): Adapter takeaways, Adapter takeaways, Adapter takeaways, Addendum — canaries of 2026-06-11 (after a repo-grounded run), agy: `--sandbox` print mode works, Antigravity CLI (`agy`, 1.0.4 → self-updated to 1.0.5 mid-run), `--bare` cost lever — CANARIED, and it does NOT work under subscription auth, Canary Results — Real Local Runs (2026-06-05) (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (35): For --cluster-only, For git commit hook, For /graphify add, For /graphify explain, For /graphify path, For /graphify query, For native CLAUDE.md integration, For --update (incremental re-extraction) (+27 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (17): 10. Testing strategy, 11. Milestones, 12. Open decisions carried in, 1. Stack & rationale, 2. Architecture & modules, 3. Domain model & data, 4. Transport layer (the risky core), 5. Normalization layer (+9 more)

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (5): Context, How to argue, Quaestio — I Love Coding v0.9: the optional local AI character layer, The central question, The feature under debate (v0.9 MVP)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (16): 1. Non-interactive invocation, 1. Non-interactive / scripting, 2. Output — **plain text only; NO JSON**, 2. Structured output — `--output-format <text|json|stream-json>` (default `text`), 3. Autonomy, 3. Autonomy, 4. Model, 4. Model / mode (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (15): 1. Scope, 2. Architecture: separate Transport from Normalization, 3. The output contract — three levels, 4.1 Claude Code (`claude`) — rich JSON envelope, 4.2 OpenAI Codex (`codex`) — rich JSONL stream, 4.3 Google Antigravity (`agy`) — text-only, 4. Per-CLI adapter specs (grounded in canary), 5. Capability tiers → minimum adapter requirement (+7 more)

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (12): 10. Known gotchas for headless / CI, 1. Non-interactive invocation, 2. Structured output (`--output-format`), 3. Input streaming (`--input-format stream-json`), 4. Session continuity, 5. Model & effort selection, 6. Permission / autonomy flags for unattended runs, 7. System prompt injection (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (11): 1. Non-interactive invocation **[primary]**, 2. Structured output **[primary — event names from `codex-rs/exec/src/exec_events.rs`]**, 3. Sandbox / approval / autonomy flags **[primary, 0.137.0-confirmed]**, 4. Model selection & reasoning effort, 5. Config file — `~/.codex/config.toml` (`$CODEX_HOME/config.toml`) **[primary]**, 6. Session continuity / resume **[primary]**, 7. Exit codes / error signaling **[primary, no documented table]**, 8. Authentication for headless/CI **[primary]** (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (10): 1. Non-interactive invocation, 2. Structured output, 3. Autonomy / approval flags, 4. Model selection, 5. Session / resume, 6. Exit codes (from `docs/cli/headless.md`), 7. Authentication for headless/CI, 8. Gotchas (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (9): Architecture, Development Style, Git And Workspace Hygiene, graphify, Non-Negotiable Invariants, Private area, Project Context, Runtime And Commands (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (13): Architecture (five files, clean layers), Architecture (four files, clean layers), Architecture (seven files, clean layers), Architecture (six files, clean layers), Best practices, Commands, Design docs, graphify (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (12): Design documents, Disputatio, How it works (v0), How to Run, Install and use, Known v0 limitations (next steps), License, Prerequisites (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.25
Nodes (7): Implication for next steps, Pre-M0 hand-run debate — result (2026-06-07), Respondeo (determination), Round 1 — videtur quod (ungrounded), Setup, Verdict on the premise test, Verifier — grounded in executable evidence (the moat)

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (7): 1. Lineup policy must be explicit, 2. Claude proposal: `FAILED: is_error=true` (diagnosed: budget), 3. agy proposal: `FAILED: timeout`, 4. The debate continued as a monologue, 5. Writes inside the target repo, Real run 2026-06-11 - repo-grounded debate, Residual risks (known, accepted for v0)

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (6): Google Antigravity (`agy`) — Headless / CLI Capability (research, 2026-06-05), Key conclusions (verified), Part 1 — Web research context (background), Part 2 — VERIFIED locally: `agy 1.0.4 --help`, Sources (web), Still to verify hands-on

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Files, Installed versions on this machine (2026-06-05), Provenance, Research: Headless Invocation & Output Capture of AI Coding-Agent CLIs, Why this discipline matters

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (11): [0.0.1] — Kaizen MVP v0, [0.0.2] — Agent tooling & knowledge graph, [0.0.3] — Hardening after the first real-repo run, [0.0.4] — `doctor` preflight (M0, canary half), [0.0.5] — Process-group kill + first three-vendor repo-grounded run, [0.0.6] — Per-participant reasoning `effort` in `debate.yaml`, [0.1.0] — `respondeo`: the judge stage (first scholastic-protocol step), [0.2.0] — portable config + installable `disputatio` binary (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (26): 1. Use Real Agent Harnesses, 2. Local First, 3. Markdown as Source of Truth, 4. Debate Over Chat, Agent Adapter Model, Architecture, Branch Isolation, Consensus Engine (+18 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (24): 10. Open risks and decisions, 1. Positioning, 2. Premise and validation, 3. The Disputatio protocol, 4. Roles and participants, 5. Executable evidence, 6. Convergence and human-in-the-loop, 7. Contribution contract (+16 more)

### Community 39 - "Community 39"
Cohesion: 0.11
Nodes (17): 10. Testing strategy, 11. Milestones, 12. Open decisions carried in, 1. Stack & rationale, 2. Architecture & modules, 3. Domain model & data, 4. Transport layer (the risky core), 5. Normalization layer (+9 more)

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (15): 1. Scope, 2. Architecture: separate Transport from Normalization, 3. The output contract — three levels, 4.1 Claude Code (`claude`) — rich JSON envelope, 4.2 OpenAI Codex (`codex`) — rich JSONL stream, 4.3 Google Antigravity (`agy`) — text-only, 4. Per-CLI adapter specs (grounded in canary), 5. Capability tiers → minimum adapter requirement (+7 more)

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (5): 1. The deadlock — timeout killed only the direct child (FIXED), 2. The debate itself — premise signal (leans positive, N=1), 3. Evidence tier — citations, not failing tests (as predicted), 4. Cost, Real run 2026-06-12 — I Love Coding v0.9, three-vendor repo-grounded debate

### Community 44 - "Community 44"
Cohesion: 0.15
Nodes (13): args, DEFAULT_JUDGE, DEFAULT_SPECS, execFileAsync, input, participants, positionals, usage() (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (11): ParticipantSpec, BIN_OVERRIDABLE, BinResolution, execFileAsync, findAlternatives(), InitDeps, InitResult, KNOWN_BIN_DIRS (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (11): agyAdapter(), AgyOpts, claudeAdapter(), ClaudeOpts, CliCapture, codexAdapter(), CodexOpts, buildParticipant() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (7): Participant, allHealthy(), diagnose(), Diagnosis, excerpt(), formatDiagnoses(), runDoctor()

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (5): Disputatio, Documentation, Install, Quick start, Status

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (4): backupReadme, npmReadme, repoReadme, root

### Community 51 - "Community 51"
Cohesion: 0.50
Nodes (3): backupReadme, repoReadme, root

## Ambiguous Edges - Review These
- `codexAdapter` → `README Codex Adapter Deferred Note`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **431 isolated node(s):** `name`, `version`, `description`, `type`, `license` (+426 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `codexAdapter` and `README Codex Adapter Deferred Note`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _431 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Debate Engine & Transport Core` be split into smaller, more focused modules?**
  _Cohesion score 0.09103840682788052 - nodes in this community are weakly interconnected._
- **Should `Headless CLI Capabilities` be split into smaller, more focused modules?**
  _Cohesion score 0.11462450592885376 - nodes in this community are weakly interconnected._
- **Should `Source Code Modules` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Design Principles & Prior Art` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Scholastic Disputatio Protocol` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._