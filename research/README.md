# Research: Headless Invocation & Output Capture of AI Coding-Agent CLIs

This folder preserves the investigation into how each candidate agent CLI can be
driven **non-interactively (headless)** and how its output can be **captured in a
structured way**. It is the raw evidence behind the adapter design in
`../3_ADAPTERS.md`.

## Provenance

- Gathered: **2026-06-05**, by parallel research subagents reading official
  documentation (vendor docs, GitHub repos), plus local `--help`/version probes
  and canary runs on this machine.
- Each report keeps the original verified/unverified discipline: facts taken from
  **primary sources** (official docs, source code) are trusted; **runtime
  behavior** that only surfaces by executing the binary is flagged separately and
  confirmed by the canary runs in `canary-results.md`.

## Why this discipline matters

Output formats and flags are **version-fragile**. A report saying a flag exists
is not the same as that flag existing on the installed version. Example caught on
this machine:

- `codex 0.137.0`'s `codex exec` has **no** `-a/--ask-for-approval` flag, although
  general docs describe it — approval in exec is governed by `--sandbox` /
  `--dangerously-bypass-approvals-and-sandbox`.
- `agy 1.0.4` (Antigravity CLI) does **not** expose `--output-format`, `--json`,
  or `--model` — it is effectively **text-only**, contradicting the assumption
  that it inherits Gemini CLI's structured-output flags.

Always re-run `disputatio doctor` (version + capability probe) before trusting a
report.

## Files

| File | Scope | Status for Disputatio |
| --- | --- | --- |
| `claude-code-headless.md`     | Claude Code (`claude`)         | **In scope** (primary) |
| `codex-cli-headless.md`       | OpenAI Codex CLI (`codex`)     | **In scope** (primary) |
| `antigravity-cli-headless.md` | Google Antigravity (`agy`)     | **In scope** (primary) |
| `gemini-cli-headless.md`      | Google Gemini CLI (`gemini`)   | Reference only — deprecated, sunset 2026-06-18; kept as a model for `agy` behavior |
| `cursor-and-aider-headless.md`| Cursor (`cursor-agent`), Aider | Deferred — future adapters |
| `canary-results.md`           | Real local runs of the in-scope CLIs | Ground truth on this machine |

## Installed versions on this machine (2026-06-05)

| CLI | Binary | Version |
| --- | --- | --- |
| Claude Code | `/Users/mark/.local/bin/claude` | `2.1.165` |
| Codex CLI   | `/opt/homebrew/bin/codex`        | `codex-cli 0.137.0` |
| Antigravity | `/Users/mark/.local/bin/agy`     | `1.0.4` |
| Gemini CLI  | (not installed)                  | — |
| Cursor      | (not installed)                  | — |
| Aider       | (not installed)                  | — |
