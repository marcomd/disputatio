# Changelog

All notable changes to Disputatio are documented here.

## [0.0.1] — Kaizen MVP v0

First runnable cut: orchestrate a structured debate between *real*, cross-vendor AI
coding-agent CLIs and capture it as a single markdown transcript.

- **CLI entry** (`src/index.ts`) — `node src/index.ts <task.md> [rounds] [repo-path]`;
  runs on Node ≥ 24 with native TypeScript (no build step); stdout = artifact path,
  stderr = progress.
- **Adapter / transport layer** (`src/adapters.ts`) — spawn a CLI, capture output,
  classify success/failure. `claude` read via its JSON envelope
  (`is_error` + exit code, *not* `subtype`); `agy` read as plain trimmed stdout.
- **Debate orchestration** (`src/debate.ts`) — Round 1 parallel independent proposals,
  followed by N reaction rounds against the full transcript snapshot.
- **Isolation** — each agent turn runs in a throwaway temp dir (or the passed repo),
  preventing cross-agent contamination caught during the hand-run.
- **Cross-vendor lineup** — `claude` (Anthropic) + `agy` (Google/Gemini) by design,
  with a sanity check that warns on correlated-error risk.
- **Read-only evidence gathering** — when pointed at a repo, agents can read files and
  run read-only commands (tests, `git diff`) under a tool allowlist and a USD budget cap.
- **Design docs & research** — `1_IDEA` → `2_CONCEPT` → `3_ADAPTERS` → `4_PLAN`, plus
  `research/` with per-CLI headless findings and verified canary runs.
