# Graph Report - .  (2026-06-11)

## Corpus Check
- Corpus is ~32,514 words - fits in a single context window. You may not need a graph.

## Summary
- 140 nodes · 163 edges · 17 communities (11 shown, 6 thin omitted)
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.8)
- Token cost: 189,919 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `Claude Code CLI (claude)` - 10 edges
2. `Disputatio` - 8 edges
3. `claudeAdapter` - 6 edges
4. `runDebate` - 6 edges
5. `index.ts CLI entry` - 6 edges
6. `Headless CLI Research Corpus` - 6 edges
7. `Google Antigravity CLI (agy)` - 6 edges
8. `agyAdapter` - 5 edges
9. `Participant` - 5 edges
10. `Canary results (verified local runs)` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Reaction` --semantically_similar_to--> `Sed contra (attack phase)`  [INFERRED] [semantically similar]
  src/debate.ts → 2_CONCEPT.md
- `Per-turn isolation` --semantically_similar_to--> `False consensus / sycophancy`  [INFERRED] [semantically similar]
  src/debate.ts → 2_CONCEPT.md
- `Participant` --implements--> `Participant (harness, model, effort)`  [INFERRED]
  src/adapters.ts → 2_CONCEPT.md
- `index.ts CLI entry` --references--> `Quaestio (the question/task)`  [INFERRED]
  src/index.ts → 2_CONCEPT.md
- `claudeAdapter` --implements--> `Transport layer`  [INFERRED]
  src/adapters.ts → 3_ADAPTERS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Scholastic disputatio protocol phases** — concept_videtur_quod, concept_consolidatio, concept_sed_contra, concept_verifier, concept_respondeo, concept_ad_obiecta [EXTRACTED 0.85]
- **Transport success/failure classification invariants** — adapters_runcli, concept_is_error_classification, concept_stdin_devnull, concept_canary_results [EXTRACTED 0.85]
- **Disputatio data-flow pipeline** — index_cli_entry, debate_rundebate, debate_runisolated, adapters_participant, adapters_runcli [EXTRACTED 0.85]
- **Headless CLI Integration Research** — research_claude_code_headless_claude_cli, research_codex_cli_headless_codex_cli, research_antigravity_cli_headless_agy, research_gemini_cli_headless_gemini_cli, research_cursor_and_aider_headless_cursor_agent, research_cursor_and_aider_headless_aider [EXTRACTED 0.90]
- **Disputatio Working Principles (TDD/DDD/Kaizen)** — claude_tdd, claude_ddd_ubiquitous_language, claude_kaizen, claude_disputatio [EXTRACTED 0.85]
- **Scholastic Disputatio Protocol** — research_pre_m0_handrun_videtur_quod, research_pre_m0_handrun_respondeo, claude_isolation_invariant, claude_executable_evidence [INFERRED 0.75]

## Communities (17 total, 6 thin omitted)

### Community 0 - "Debate Engine & Transport Core"
Cohesion: 0.10
Nodes (25): AgentResult, agyAdapter, claudeAdapter, CliResult, Participant, runCli, AGENTS.md agent instructions, CHANGELOG (+17 more)

### Community 1 - "Headless CLI Capabilities"
Cohesion: 0.15
Nodes (19): agy is Text-Only, agy Print Mode is Agentic, Google Antigravity CLI (agy), agy Convention Lineage = Claude Code, agy Text-Only Output (No JSON), Canary Runs (Real Local Ground Truth), Capability Tiers (JSON vs Text-Only), Claude Agent SDK (+11 more)

### Community 2 - "Source Code Modules"
Cohesion: 0.15
Nodes (12): AgentResult, agyAdapter(), claudeAdapter(), CliResult, Participant, log(), render(), runDebate() (+4 more)

### Community 3 - "Design Principles & Prior Art"
Cohesion: 0.15
Nodes (17): Adapter Anti-Corruption Boundary, Cross-Vendor Diversity Premise, Scholastic Ubiquitous Language (DDD), Disputatio, Executable Evidence (The Moat), Isolation (Throwaway Temp Dir per Turn), Kaizen (Continuous Improvement), stdin Ignored Invariant (+9 more)

### Community 4 - "Scholastic Disputatio Protocol"
Cohesion: 0.15
Nodes (15): Ad obiecta (answer surviving objections), Consolidatio (merge proposals), Disputatio (debate engine), Executable evidence (the moat), Participant (harness, model, effort), Premise validation gate, Proposal, Reaction (+7 more)

### Community 5 - "Package Manifest"
Cohesion: 0.22
Nodes (8): description, engines, node, name, scripts, debate, type, version

### Community 6 - "CLI Output Classification"
Cohesion: 0.25
Nodes (8): Classify claude Success on is_error + Exit Code, Two Error Channels (Exit Code + In-Band), is_error + subtype Error Signaling, Claude JSON Envelope (ResultMessage), agent_message Item (Final Answer), codex exec Subcommand, Codex JSONL Event Stream, Codex Sandbox Mode (-s read-only)

### Community 7 - "Design Document Chain"
Cohesion: 0.60
Nodes (6): 1_IDEA vision document, 2_CONCEPT refined concept, 3_ADAPTERS integration design, 4_PLAN implementation plan, Codex adapter (deferred), README

### Community 8 - "Tool Permissions & Aider"
Cohesion: 0.50
Nodes (4): Read-Only Allowlist for claude, --allowedTools Permission Allowlist, Aider CLI (aider), Aider Auto-Commits by Default

### Community 9 - "Graphify Integration"
Cohesion: 0.50
Nodes (4): Project CLAUDE.md graphify Integration, EXTRACTED/INFERRED/AMBIGUOUS Audit Trail, Knowledge Graph (Communities + Audit Trail), graphify Skill

### Community 12 - "CLI Flag Version Fragility"
Cohesion: 0.67
Nodes (3): No -a/--ask-for-approval in 0.137.0, disputatio doctor (Capability Probe), Version Fragility of CLI Flags

## Knowledge Gaps
- **36 isolated node(s):** `name`, `version`, `description`, `type`, `debate` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runDebate` connect `Scholastic Disputatio Protocol` to `Debate Engine & Transport Core`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `index.ts CLI entry` connect `Debate Engine & Transport Core` to `Scholastic Disputatio Protocol`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Claude Code CLI (claude)` (e.g. with `OpenAI Codex CLI (codex)` and `Cursor CLI (cursor-agent)`) actually correct?**
  _`Claude Code CLI (claude)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Debate Engine & Transport Core` be split into smaller, more focused modules?**
  _Cohesion score 0.10333333333333333 - nodes in this community are weakly interconnected._
- **Should `Headless CLI Capabilities` be split into smaller, more focused modules?**
  _Cohesion score 0.14619883040935672 - nodes in this community are weakly interconnected._
- **Should `Design Principles & Prior Art` be split into smaller, more focused modules?**
  _Cohesion score 0.14705882352941177 - nodes in this community are weakly interconnected._