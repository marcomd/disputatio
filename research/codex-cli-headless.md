# OpenAI Codex CLI — Headless / Automation Mode (research, 2026-06-05)

> Source: research subagent reading `github.com/openai/codex` and
> `developers.openai.com`. Confirmed locally against `codex-cli 0.137.0`.
> Source grade flagged per section: **[primary]** read from source/official docs;
> **[summary]** came through a search summarization layer — confirm at runtime.

> ⚠️ **Local correction (0.137.0):** `codex exec` on this version exposes
> `-s/--sandbox` and `--dangerously-bypass-approvals-and-sandbox` but **no
> `-a/--ask-for-approval`** flag (the general docs describe one). Approval in
> `exec` is governed by the sandbox mode; exec does not prompt interactively.

## 1. Non-interactive invocation **[primary]**

Automation subcommand: **`codex exec`** (alias `e`). The old interactive
`--quiet` flag is gone. Runs one session to completion, emits to stdout/stderr,
exits.

```bash
codex exec "<prompt>"                  # prompt as argument
codex exec --ephemeral "<prompt>"      # don't persist session rollout files
npm test 2>&1 | codex exec "summarize failures"   # stdin appended as <stdin> block
cat prompt.txt | codex exec -          # "-" => read the FULL prompt from stdin
```

Prompt passing: **argument**, **stdin appended as a `<stdin>` block** (pipe +
instruction arg), or **stdin as full prompt** (`codex exec -`). No `--prompt-file`
flag — use stdin. *(Confirmed in 0.137.0 help: "If stdin is piped and a prompt is
also provided, stdin is appended as a `<stdin>` block".)*

## 2. Structured output **[primary — event names from `codex-rs/exec/src/exec_events.rs`]**

Flag: **`--json`** (alias `--experimental-json`). stdout becomes **JSONL** (one
JSON object per line per state change); human progress goes to stderr.

```bash
codex exec --json "task" | jq
```

Top-level event `type` values:
`thread.started`, `turn.started`, `item.started`, `item.updated`,
`item.completed`, `turn.completed`, `turn.failed`, `error`.

Item detail `type` values (inside item events):
`agent_message`, `reasoning`, `command_execution`, `file_change`,
`mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, `error`.

**Where the final answer is:** the assistant's final message is the **last**
`item.completed` whose item type is `agent_message` (there can be intermediate
`agent_message` items — take the last). In non-JSON mode the final message is
printed to **stdout** (progress to stderr).

Example JSONL (shape):
```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"...final answer..."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"output_tokens":122}}
```

Related output flags:
- **`-o, --output-last-message <path>`** — write the assistant's final message to a file.
- **`--output-schema <schema.json>`** — JSON Schema constraining the final
  response shape; combine with `-o` to capture validated structured JSON.

## 3. Sandbox / approval / autonomy flags **[primary, 0.137.0-confirmed]**

- **`-s, --sandbox <mode>`** — `read-only` (default) | `workspace-write` | `danger-full-access`.
- **`--dangerously-bypass-approvals-and-sandbox`** — no approvals, no sandbox;
  "only use inside an externally hardened environment." *(In older docs this had
  a `--yolo` alias and there was `-a/--ask-for-approval`; not present in 0.137.0
  `exec` help.)*
- **`--skip-git-repo-check`** — allow running outside a Git repo.
- **`-C, --cd <dir>`** — set the working directory.
- **`--add-dir <dir>`** — additional writable directories.
- **`--ignore-user-config`** (skip `$CODEX_HOME/config.toml`), **`--ignore-rules`**, **`--ephemeral`**.

Typical unattended invocation:
```bash
codex exec --json -s workspace-write "<prompt>"   # read-only for non-mutating
```

## 4. Model selection & reasoning effort

- **`-m, --model <name>`** **[primary]**.
- Reasoning effort: config key **`model_reasoning_effort`** =
  `minimal | low | medium | high | xhigh` **[primary, config-reference]**. Per run:
  ```bash
  codex exec -c model_reasoning_effort="high" -m gpt-5.5 "<prompt>"
  ```
- **Models [summary — VERIFY at runtime]:** docs show example values `gpt-5.4`,
  `gpt-5.5` ("Latest"). Default model & full catalog not confirmed from primary
  source — resolve live, don't hardcode.

## 5. Config file — `~/.codex/config.toml` (`$CODEX_HOME/config.toml`) **[primary]**

Keys relevant to headless use: `model`, `model_reasoning_effort`,
`approval_policy` (`untrusted | on-request | never`; `on-failure` deprecated),
`sandbox_mode`, `[sandbox_workspace_write]` (`network_access`, `writable_roots`,
`exclude_slash_tmp`, `exclude_tmpdir_env_var`), `model_provider` (default
`openai`), `[mcp_servers.<id>]` (`command`, `args`, `enabled`, `enabled_tools`,
`disabled_tools`). Profiles: `$CODEX_HOME/<name>.config.toml` via `-p/--profile`.
Project overrides: `.codex/config.toml`. Any key override via repeatable
**`-c key=value`** (parsed as TOML, else literal).

## 6. Session continuity / resume **[primary]**

```bash
codex exec resume --last "<follow-up>"   # most recent session
codex exec resume <SESSION_ID> "<follow-up>"
```
`--ephemeral` => no rollout file => not resumable.

> Disputatio decision: run **stateless / `--ephemeral`**; orchestrator owns memory.

## 7. Exit codes / error signaling **[primary, no documented table]**

- `codex exec` exits **0 on success, non-zero on failure** (task failure, rule
  violation, approval denial, or a `required = true` MCP server failing to init).
- **No enumerated exit-code table** documented — branch on zero/non-zero only.
- Historical issue: SIGINT (Ctrl+C) did **not** yield non-zero in exec (issue
  #4721) — verify on your version.

## 8. Authentication for headless/CI **[primary]**

- **Env var (exec-only):** `CODEX_API_KEY=<key> codex exec --json "..."`. Docs:
  "`CODEX_API_KEY` is only supported in `codex exec`." No `codex login` needed.
- **Persistent login** (writes `~/.codex/auth.json`):
  `printenv OPENAI_API_KEY | codex login --with-api-key`,
  `codex login --device-auth` (OAuth device flow), or ChatGPT-managed/enterprise.
- Security: do **not** set `OPENAI_API_KEY`/`CODEX_API_KEY` as job-level env in
  workflows that run repo-controlled code; treat `auth.json` like a password;
  prefer the official Codex GitHub Action over raw CLI in CI.

## 9. Known gotchas for headless/CI **[primary — GitHub issues]**

- **TTY / stdin hang (important):** with a prompt as argument from a
  non-interactive child shell, `codex exec` can **hang waiting for stdin EOF**
  (issue #20919). Mitigate: `codex exec "<prompt>" < /dev/null`.
- **Detached stdio silent crash:** reported on 0.124.0+ when stdio detached from a
  TTY (issue #19945) — test your exact version in the target runner.
- **Non-zero exit from sub-tools:** many dev tools use non-zero to signal
  *findings* not *failures* (issue #1367). Capture stdout/stderr regardless of code.
- **MCP:** configured via `[mcp_servers.*]`; `required = true` server failing to
  start fails the run.
- **Git repo expectation:** exec generally expects a Git repo; pass
  `--skip-git-repo-check` for loose directories.

## Sources
- Non-interactive mode: https://developers.openai.com/codex/noninteractive
- CLI reference: https://developers.openai.com/codex/cli/reference
- Config reference: https://developers.openai.com/codex/config-reference
- Event schema: https://github.com/openai/codex → `codex-rs/exec/src/exec_events.rs`
- GitHub Action: https://github.com/openai/codex-action
- Issues: #20919, #19945, #4721, #1367

**Flagged / unverified:** default model & full catalog (example names only);
enumerated exit codes (only zero/non-zero); per-version TTY/stdin behavior.
