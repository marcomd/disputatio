# Real run 2026-06-11 - repo-grounded debate

This run pointed Disputatio at a real repository for read-only evidence gathering.
The specific repository, task, artifact path, and account details are intentionally
omitted from the public notes; the durable lessons below are the parts relevant to
the tool.

## 1. Lineup policy must be explicit

The initial lineup was not appropriate for the target repository's credential and
account policy. This is a process/configuration failure, not an adapter bug.
**Fixes:** `--config debate.yaml` makes the lineup explicit per run; the default
lineup is now `claude+codex`; optional adapters require explicit config.

## 2. Claude proposal: `FAILED: is_error=true` (diagnosed: budget)

The adapter discarded the envelope, leaving an unactionable message. The
budget-exceeded canary (see `canary-results.md` addendum) shows the message lives
in `errors[]` when there is no `result` field. One repo-grounded turn approached
the old $1 cap, so the previous default was too tight. **Fixes:** adapter reads
`errors[]`; default cap raised to **$2** (config `maxBudgetUsd`); every turn's raw
stdout/stderr is now persisted under `.debate/<id>/raw/`.

## 3. agy proposal: `FAILED: timeout`

The 5-minute wall-clock cap, including agy's own `--print-timeout` default, is too
tight for evidence gathering in a large repository. **Fixes:** default timeout
**10m**, config `timeoutMinutes`, and agy gets a matching `--print-timeout`.

## 4. The debate continued as a monologue

With both proposals dead, the orchestrator ran the reaction round anyway: two agents
"reacted" to a transcript containing only the task and two failed markers. The
artifact looked plausible, but no cross-vendor debate happened. **Fix:** fewer than
2 successful proposals now aborts with exit 1 while keeping the partial transcript
and raw captures.

## 5. Writes inside the target repo

During the run, an unsandboxed evidence-gathering CLI executed project commands and
wrote local runtime artifacts into the target repository. The confirmed writes were
logs, temporary files, and command state, not source edits. **Fixes:** repo mode now
runs each turn in a detached throwaway git worktree (stray writes die with it; the
real checkout is never the cwd); `agy --sandbox`; codex runs `-s read-only`; claude
keeps the read-only allowlist plus `--permission-mode dontAsk`, with comma-separated
rules.

## Residual risks (known, accepted for v0)

- A worktree shares the repository object store; CLI-level sandboxes are the second
  layer. Full clone isolation would be the stricter third layer.
- Worktrees contain tracked files only; untracked dependencies and local artifacts
  are absent, so some test suites will not run there.
- Project commands that access external local state are blocked only by the per-CLI
  sandbox flags, not by the worktree itself.
