# Claude Code — Headless / Non-Interactive Mode (research, 2026-06-05)

> Source: research subagent reading official docs. Confirmed locally against
> `claude 2.1.165`. Docs moved to **code.claude.com/docs**; Agent SDK reference at
> **platform.claude.com**. Anthropic now frames headless mode as "the Agent SDK
> via the CLI."

> Billing note from the docs: **Starting June 15, 2026, Agent SDK and `claude -p`
> usage on subscription plans draw from a separate monthly "Agent SDK credit"**,
> distinct from interactive usage limits.

---

## 1. Non-interactive invocation

- Flag: **`-p` / `--print`** — print response without interactive mode, then exit.
- **Prompt as argument:** `claude -p "What does the auth module do?"`
- **Prompt via stdin (pipe):** `cat build-error.txt | claude -p 'explain the root cause' > output.txt`
  - Piped stdin is **capped at 10MB** (v2.1.128); exceeding exits non-zero. For
    larger input, write a file and reference its path in the prompt.
- **Prompt via file:** no dedicated flag — pipe a file in, or reference the path
  in the prompt and let Claude read it.

**Bare mode (important for CI):** `--bare` skips auto-discovery of hooks, skills,
plugins, MCP servers, auto-memory, and CLAUDE.md, for faster and reproducible
scripted calls. It also **skips OAuth/keychain reads** — auth must come from
`ANTHROPIC_API_KEY` or an `apiKeyHelper` in `--settings`. Docs call it "the
recommended mode for scripted and SDK calls, and will become the default for `-p`
in a future release."
```bash
claude --bare -p "Summarize this file" --allowedTools "Read"
```

---

## 2. Structured output (`--output-format`)

Options: `text` (default) | `json` | `stream-json`.

- `json`: structured JSON with the text result in **`result`** plus session
  metadata. `total_cost_usd` and a per-model cost breakdown included.
  ```bash
  claude -p "Summarize this project" --output-format json | jq -r '.result'
  ```
- **Schema-constrained output:** `--output-format json --json-schema '<JSON Schema>'`
  puts the validated object in a **`structured_output`** field (print mode only):
  ```bash
  claude -p "Extract function names from auth.py" \
    --output-format json \
    --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}},"required":["functions"]}' \
    | jq '.structured_output'
  ```

**JSON result fields** (from the SDK `ResultMessage` schema — same payload the CLI emits):

| Field | Type | Notes |
|---|---|---|
| `subtype` | str | `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` |
| `is_error` | bool | true if ended in error |
| `result` | str \| null | final assistant text (on `subtype="success"`) |
| `structured_output` | any | present when `--json-schema` used |
| `session_id` | str | session identifier (returned in JSON) |
| `total_cost_usd` | float \| null | client-side cost estimate |
| `usage` | dict \| null | `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` |
| `num_turns` | int | agentic turns |
| `duration_ms` / `duration_api_ms` | int | wall-clock / API time |
| `stop_reason` | str \| null | |
| `model_usage`, `permission_denials`, `errors`, `api_error_status`, `uuid` | various | metadata |

Illustrative shape (field names verbatim; values example):
```json
{
  "type": "result", "subtype": "success", "is_error": false,
  "result": "The auth module handles JWT validation and session refresh.",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "num_turns": 3, "duration_ms": 8421, "duration_api_ms": 6234,
  "total_cost_usd": 0.0123,
  "usage": { "input_tokens": 14230, "output_tokens": 312, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 12000 }
}
```

**`stream-json`** — newline-delimited JSON, one event per line. Requires
`--verbose`; add `--include-partial-messages` for token-level deltas:
```bash
claude -p "Explain recursion" --output-format stream-json --verbose --include-partial-messages
```
Event types: `system` (subtypes `init`, `api_retry`, `plugin_install`),
`assistant`, `user`, `stream_event` (partial deltas), final `result`.
- `system/init` is first (model, tools, MCP servers, `plugins`, `plugin_errors`).
- `system/api_retry` before retrying a retryable API error (`attempt`,
  `max_retries`, `retry_delay_ms`, `error_status`, `error` enum:
  `authentication_failed`, `rate_limit`, `overloaded`, `billing_error`, …).
- Related flags: `--include-hook-events`, `--prompt-suggestions`,
  `--replay-user-messages` (all require stream-json).

---

## 3. Input streaming (`--input-format stream-json`)

Options: `text` (default) | `stream-json`. Feeds newline-delimited JSON user
messages into print mode (multi-message / queued input). For richer multi-turn
streaming (images, queued messages, interruption) the docs steer you to the
Agent SDK's streaming-input mode.

---

## 4. Session continuity

- **`--continue` / `-c`**: most recent conversation in the current directory.
- **`--resume <session_id>` / `-r`**: resume a specific session by ID or name.
- The **session id IS returned** in JSON (`session_id`) for capture/reuse:
  ```bash
  session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
  claude -p "Continue that review" --resume "$session_id"
  ```
- **`--session-id <uuid>`**: set a specific session id up front.
- **`--fork-session`**: when resuming, create a new session id.
- **`--no-session-persistence`** (print mode): don't write the session to disk.

> Note for Disputatio: we deliberately run **stateless** (no `--resume`); the
> orchestrator owns memory via Markdown. `--no-session-persistence` fits this.

---

## 5. Model & effort selection

- **`--model`**: alias (`sonnet`, `opus`) or full name (`claude-opus-4-8`).
- **`--effort`**: `low`, `medium`, `high`, `xhigh`, `max` (per-session).
- **`--fallback-model`**: auto-fallback when overloaded (only with `-p`).
- **`--betas`** (API-key users): e.g. `interleaved-thinking`.

---

## 6. Permission / autonomy flags for unattended runs

- **`--allowedTools`**: auto-approve tools, permission-rule syntax with prefix
  matching, e.g. `"Bash(git diff *)"`, `"Read,Edit"`.
- **`--disallowedTools`**: deny rules.
- **`--tools`**: restrict the available built-in toolset (`""` = none).
- **`--permission-mode`**: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
  `bypassPermissions`. For locked-down CI, **`dontAsk`** denies anything not in
  `permissions.allow`.
- **`--dangerously-skip-permissions`**: skip all prompts.
- **`--permission-prompt-tool <mcp_tool>`**: route prompts to an MCP tool.
- **Sandboxing:** no dedicated `--sandbox` CLI flag found; handled via permission
  modes / settings. *(flagged — not in current CLI reference)*

---

## 7. System prompt injection

- **`--system-prompt`** — replace the entire default prompt.
- **`--system-prompt-file`** — replace from a file.
- **`--append-system-prompt`** — append text to the default prompt.
- **`--append-system-prompt-file`** — append file contents.

Append keeps Claude Code's coding identity/safety/tool guidance; replace gives a
fully custom agent (you own all safety/tool instructions).
```bash
gh pr diff "$1" | claude -p \
  --append-system-prompt "You are a security engineer. Review for vulnerabilities." \
  --output-format json
```

---

## 8. Exit codes / error signaling

Docs do **not** publish a full exit-code table for `claude -p`. Confirmed:
- Non-zero exit on stdin > 10MB and on `--max-turns` limit reached.
- `claude auth status` → 0 logged-in / 1 not; `claude daemon status` → 1 if down.
- In JSON/stream output, errors signaled by **`is_error: true`** + **`subtype`**
  (`error_during_execution`, `error_max_turns`, `error_max_budget_usd`,
  `error_max_structured_output_retries`), plus `api_error_status`/`errors`.
- **For robust CI inspect BOTH the process exit status AND the JSON `is_error`/`subtype`.**
- Guards: **`--max-budget-usd <amount>`**, **`--max-turns`**.

---

## 9. Claude Agent SDK (TS & Python) — recommended programmatic interface

Exists and is **recommended over shelling out to the CLI** for
orchestration/CI/production. Old "Claude Code SDK" → renamed **Claude Agent SDK**.

- **TypeScript:** `@anthropic-ai/claude-agent-sdk` (`npm install …`). Bundles a
  native Claude Code binary per platform.
- **Python:** `claude-agent-sdk` (`pip install …`). Requires Python 3.10+.
- Entry points: `query()` (one-shot/async iterator), `ClaudeSDKClient`
  (persistent streaming session). Options object mirrors CLI flags
  (`allowedTools`, `permissionMode`, `resume`, `maxTurns`, `mcpServers`, `hooks`,
  `agents`).
- Final message is a typed `ResultMessage` (same fields as the JSON above);
  `system/init` carries `session_id`.

Why more robust: native message objects + typed result (no stdout parsing),
in-process tool-approval callbacks, hooks as functions, proper streaming-input
mode.

> Disputatio decision: start with **uniform shell-out** for all agents (one
> mental model). Keep the Agent SDK as a later optimization for the Claude
> adapter only if reliability demands it.

---

## 10. Known gotchas for headless / CI

- **Auth:** set `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Foundry env). For
  subscription auth in CI, `claude setup-token` (prints, needs subscription).
  **Bare mode and the SDK skip OAuth/keychain.** Third-party products may not use
  claude.ai login for SDK-built agents — use API-key auth.
- **Use `--bare` in CI** so runs don't pick up a teammate's `~/.claude` hooks or a
  repo `.mcp.json`.
- **stdin 10MB cap** — pipe larger payloads via file reference.
- **TTY assumptions:** some commands require an interactive terminal; built-in
  slash commands/skills (e.g. `/code-review`) are **interactive-only** — in `-p`
  describe the task in prose.
- **Streaming buffering:** `stream-json` needs `--verbose`; deltas need
  `--include-partial-messages`. Use `jq -rj`.
- **Rate limits / billing:** from 2026-06-15, `-p`/SDK on subscription plans use a
  separate Agent SDK credit. `api_retry` events surface `rate_limit`/`overloaded`.
- **Plugin load failures are silent unless checked:** inspect `system/init.plugin_errors`.
- **`--help` is incomplete:** absence from `--help` ≠ unavailable.

## Sources
- Headless: https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK Python (ResultMessage): https://code.claude.com/docs/en/agent-sdk/python
- Streaming modes: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Error reference: https://code.claude.com/docs/en/errors
- SDK + subscription billing: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

**Flagged / unverified:** complete `claude -p` exit-code enumeration; dedicated CLI
sandbox flag (none found — uses permission modes); Python floor stated 3.10+ on
overview only.
