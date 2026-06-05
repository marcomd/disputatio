# Google Gemini CLI — Headless Mode (research, 2026-06-05)

> **Status: reference only.** Gemini CLI is **deprecated** and sunsets for consumer
> tiers on **2026-06-18**, replaced by Antigravity CLI (`agy`). Kept here because
> `agy` inherits parts of Gemini CLI's architecture (Skills/Hooks/Subagents/
> plugins) — useful for anticipating `agy` behavior. **Not installed on this
> machine.** Not a Disputatio adapter target.

> Source: research subagent reading `github.com/google-gemini/gemini-cli` (`main`,
> June 2026) and official docs.

## 1. Non-interactive invocation

- **`-p` / `--prompt`** forces non-interactive mode, prints to stdout, exits.
  ```bash
  gemini -p "Write a poem about TypeScript"
  ```
- **`--prompt-interactive` / `-i`** seeds an *interactive* REPL — not for headless;
  cannot combine with stdin piping.
- A bare `gemini "query"` defaults to **interactive** in a TTY (non-interactive
  only if piped/redirected). Always use `-p` in scripts.
- Prompt passing: argument; or stdin as **context** (the `-p` text is appended to
  piped stdin); or `@path` in-prompt file reference; `--include-directories` adds
  workspace roots.

## 2. Structured output

`--output-format` / `-o`: **`text`** (default) | **`json`** | **`stream-json`**.

```bash
gemini --output-format json -p "..." | jq -r '.response'
```

**`json` — single object** (interface `JsonOutput` in
`packages/core/src/output/types.ts`):

| Field | Type | Notes |
|---|---|---|
| `session_id` | string? | |
| `response` | string? | model's final answer |
| `stats` | object? | typed `SessionMetrics` (tokens, latency) |
| `error` | object? | `{ type, message, code? }` |
| `warnings` | string[]? | |

**`stream-json` — JSONL events** (`JsonStreamEventType`): `init`
`{session_id, model}`, `message` `{role, content, delta?}`, `tool_use`,
`tool_result`, `error`, `result` `{status, error?, stats?}`. The `result.stats`
(`StreamStats`) token schema:
```json
{"type":"result","status":"success","stats":{"total_tokens":1234,"input_tokens":1000,"output_tokens":234,"cached":128,"input":872,"duration_ms":1820,"tool_calls":2,"models":{"gemini-2.5-pro":{"...":"..."}}}}
```

## 3. Autonomy / approval flags

- **`--approval-mode`** (default `default`): `default` | `auto_edit` | `yolo` |
  `plan`. Use **`--approval-mode=yolo`** for unattended runs.
- **`--yolo` / `-y`** — deprecated alias for the above.
- `--allowed-tools` deprecated (use Policy Engine); `--allowed-mcp-server-names`;
  `--sandbox` / `-s`.

## 4. Model selection

- **`-m` / `--model`**, default `auto` (env `GEMINI_MODEL`). Aliases: `auto`/`pro`
  → `gemini-2.5-pro` (or `gemini-3-pro-preview` if preview enabled), `flash` →
  `gemini-2.5-flash`, `flash-lite` → `gemini-2.5-flash-lite`. Concrete names
  (e.g. `gemini-3-pro-preview`) accepted.

## 5. Session / resume

- **`-r` / `--resume [id]`** — `latest` | index | UUID. `--list-sessions`,
  `--delete-session <index>`. Checkpointing via settings.

## 6. Exit codes (from `docs/cli/headless.md`)

`0` success · `1` general error / API failure · `42` input error · `53` turn
limit exceeded. With `--output-format json`, errors also in the `error` object.

## 7. Authentication for headless/CI

Headless reuses a cached credential or needs env-var auth — **Gemini API key**
(`GEMINI_API_KEY`) or **Vertex AI** (`GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`
+ ADC / service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_API_KEY`).
Interactive Google OAuth is unsuitable for CI.

**Free-tier limits:** Gemini API key free = **250 req/user/day, Flash only**;
Google login = 1,000/day; AI Pro 1,500/day; Ultra 2,000/day.

## 8. Gotchas

- **Folder-trust gate:** set `GEMINI_CLI_TRUST_WORKSPACE=true` or `--skip-trust`
  for unattended runs (else it can hang/refuse).
- positional-args interactive-in-TTY trap (use `-p`); stdin = context;
  `-i` can't combine with stdin.
- Usage statistics opt-out via `usageStatisticsEnabled`; OpenTelemetry off by default.

## Sources
- Headless: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
- Automation: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/automation.md
- CLI reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md
- Output types: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/output/types.ts
- Auth: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx
- Quotas: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md

**Flagged:** `json`-mode `stats` interior not fully enumerated (uses `StreamStats`
shape); concrete `gemini-3.x` ids beyond `gemini-3-pro-preview` not enumerated.
