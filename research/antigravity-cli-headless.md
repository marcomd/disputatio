# Google Antigravity (`agy`) — Headless / CLI Capability (research, 2026-06-05)

> Two parts: (1) the original web research, which found that Antigravity CLI is
> official but its invocation specifics were **unverified**; (2) the **local
> `--help` probe of `agy 1.0.4`**, which is now the ground truth and **overrides**
> the speculative third-party flags.

---

## Part 2 — VERIFIED locally: `agy 1.0.4 --help`

```
Usage of agy:
  --add-dir                       Add a directory to the workspace (repeatable)
  -c                              Short alias for --continue
  --continue                      Continue the most recent conversation
  --conversation                  Resume a previous conversation by ID
  --dangerously-skip-permissions  Auto-approve all tool permission requests
  -i                              Short alias for --prompt-interactive
  --log-file                      Override CLI log file path
  -p                              Short alias for --print
  --print                         Run a single prompt non-interactively and print the response
  --print-timeout                 Timeout for print mode wait (default 5m0s)
  --prompt                        Alias for --print
  --prompt-interactive            Run an initial prompt interactively and continue the session
  --sandbox                       Run in a sandbox with terminal restrictions enabled

Available subcommands:
  changelog, help, install, plugin/plugins, update
```

### Key conclusions (verified)

1. **Non-interactive invocation:** `agy -p "<prompt>"` (aliases `--print`,
   `--prompt`). `--print-timeout` defaults to **5m**.
2. **NO structured output.** There is **no** `--output-format`, **no** `--json`,
   **no** `--json-schema`. Print mode emits **plain text only**. → Antigravity is a
   **text-only** adapter; it must use the in-band structured-trailer contract +
   (if needed) LLM extraction. It does **not** inherit Gemini CLI's JSON flags.
3. **NO model-selection flag.** No `--model`/`-m`. Model choice is presumably
   driven by the signed-in account / config, not per-invocation. *(To confirm:
   whether config or a subcommand can pin a model.)*
4. **Convention lineage = Claude Code, not Gemini.** `--dangerously-skip-permissions`,
   `--continue`/`-c`, `--add-dir`, `-p/--print` mirror Claude Code's naming — not
   Gemini's `--yolo`/`--approval-mode`/`--output-format`.
5. **Autonomy:** `--dangerously-skip-permissions` auto-approves all tool
   permission requests (use for unattended runs that need tools). `--sandbox`
   runs with terminal restrictions.
6. **Resume:** `--continue`/`-c` (most recent) and `--conversation <ID>`.
   *(Disputatio runs stateless — not used.)*
7. **Plugins/Skills/Hooks/Subagents** inherited from Gemini CLI (per Google blog).

### Still to verify hands-on
- Exact stdout shape in `-p` mode (just the answer? any banner/preamble on
  stdout vs stderr?). → see `canary-results.md`.
- Exit-code behavior on success/failure.
- Whether a model can be pinned (config/env/subcommand).
- Whether stdin piping is accepted as prompt/context.

---

## Part 1 — Web research context (background)

**Bottom line from the web:** Antigravity is an **agent-first development
platform** (a VS Code fork IDE) launched **2025-11-18** with Gemini 3. A terminal
client, **"Antigravity CLI" (built in Go)**, was announced **2026-05-19** as the
official **replacement for Gemini CLI**, which sunsets for consumer (AI
Pro/Ultra/free) tiers on **2026-06-18**. It retains Gemini CLI's Agent Skills,
Hooks, Subagents, and Extensions (now "plugins").

- Two GUI surfaces: **Editor view** (VS Code-like) and **Manager view**
  (orchestrate multiple parallel agents). Agents produce verifiable "Artifacts"
  (plans, task lists).
- **Models:** primarily **Gemini 3 family** (Gemini 3 Pro / 3.1 Pro / 3 Flash —
  Flash optimized for coding); model optionality also includes **Anthropic Claude
  (Sonnet 4.5 → 4.6 / Opus 4.6)** and **OpenAI GPT-OSS**.
- **Platforms:** macOS 12+, Windows 10+ (64-bit), Linux (64-bit, glibc 2.28+).
  Public preview, free for individuals; enterprise via Gemini Code Assist.
- **Official REST API page exists** (`antigravity.google/docs/rest-api`) and a
  **plugin** page (`antigravity.google/plugin`) — both render as JS-only SPA
  shells; contents could not be read by the research tooling. **The REST API is
  the most promising official automation surface to investigate** as an
  alternative to (or complement of) the CLI.

**What was NOT verifiable from the web (now superseded by Part 2):** the command
name `agy`, the `-p` flag, and any `--output-format json` — these were claimed
only by third-party blogs and an **unverified** GitHub org
(`github.com/google-antigravity`, `is_verified: false`). The local probe confirms
`agy` and `-p` are real, and confirms there is **no** `--output-format json`.

### Sources (web)
- Launch: https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/
- Intro: https://antigravity.google/blog/introducing-google-antigravity
- CLI transition: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- Gemini 3 for developers: https://blog.google/technology/developers/gemini-3-developers/
- Official docs pointer: https://antigravity.google/docs/gcli-migration
- REST API page (unread): https://antigravity.google/docs/rest-api
