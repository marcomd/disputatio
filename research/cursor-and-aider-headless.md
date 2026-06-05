# Cursor CLI & Aider — Headless Modes (research, 2026-06-05)

> **Status: deferred / future adapters.** Neither is installed on this machine and
> both are out of the initial Disputatio scope. Kept for future onboarding.
> Source: research subagent reading official docs.

---

## A) Cursor CLI (`cursor-agent`)

### 1. Non-interactive invocation
- **`-p` / `--print`** — print responses (scripts / non-interactive).
  ```bash
  cursor-agent -p "Refactor this code to use ES6+ syntax"
  ```
- Prompt passed as argument. Prompt-via-stdin **not confirmed** in official prose.

### 2. Structured output — `--output-format <text|json|stream-json>` (default `text`)
- **`text`** — final assistant message only.
- **`json`** — single object on success; on failure exits non-zero and writes
  error to stderr **without** valid JSON:
  ```json
  {"type":"result","subtype":"success","is_error":false,"duration_ms":1234,"duration_api_ms":1234,"result":"<text>","session_id":"<uuid>","request_id":"<optional>"}
  ```
- **`stream-json`** — NDJSON events: `system` (init), `user`, `assistant`,
  `tool_call` (`started`/`completed`), terminal `result`. `--stream-partial-output`
  streams text deltas.

### 3. Autonomy
- **`-f` / `--force`** (alias `--yolo`) — force-allow commands (required to apply
  file changes in print mode; default proposes but does not apply).
- `--approve-mcps`, `--sandbox <mode>`.

### 4. Model / mode
- `--model <model>`, `--list-models` (catalog is dynamic — not hardcoded).
- `--mode <plan|ask>`, `--plan`.

### 5. Resume
- `--resume [chatId]`, `--continue` (= `--resume=-1`), `agent ls` (flaky per
  community reports).

### 6. Exit codes / auth
- Failure → non-zero + stderr, no JSON. Numeric table not surfaced.
- Auth: `CURSOR_API_KEY` env or `--api-key`; `login`/`logout`/`status`; `-H/--header`.

**Sources:** cursor.com/docs/cli/{headless,using,reference/parameters,reference/output-format}

---

## B) Aider (`aider`)

### 1. Non-interactive / scripting
- **`--message COMMAND` / `-m`** — single message, process reply, exit (disables chat).
- **`--message-file MESSAGE_FILE` / `-f`** — message from a file.
- **`--yes-always`** — auto-confirm everything.
- Target files are **positional arguments**:
  ```bash
  aider --message "add docstrings" --yes-always hello.py
  ```

### 2. Output — **plain text only; NO JSON**
No structured/JSON output mode exists. `--stream` / `--no-stream` controls
streaming (use `--no-stream` for cleaner capture) but output stays human-readable
text/diffs.

### 3. Autonomy
- `--yes-always`; **`--auto-commits`/`--no-auto-commits`** (default **ON** —
  commits LLM changes to git!); `--dirty-commits` (on); `--dry-run`; `--commit`.

### 4. Model
- `--model MODEL` (env `AIDER_MODEL`). Broad provider support (OpenAI, Anthropic,
  Gemini/Vertex, Bedrock, Azure, GROQ, xAI, Cohere, DeepSeek, Ollama, LM Studio,
  OpenRouter, Copilot, any OpenAI-compatible API).

### 5. CLI vs Python API
- Python API (`from aider.coders import Coder`) supports multi-step `coder.run()`
  in one process and auto-confirm via `InputOutput(yes=True)`, **but is officially
  unsupported/unstable**. The CLI (`-m`/`--message-file`) is the stable scripting
  path; each invocation is a fresh process.

### 6. Exit codes / gotchas
- Exit codes **not documented** — gate CI on git state / file changes, not codes.
- May still interactively **ask to add files** even with `--message`; pass all
  files up front. With `--yes-always`, suggested shell commands may not execute
  (issue #3903). `--auto-commits` ON by default — set `--no-auto-commits` in CI.

> Disputatio note: Aider **writes files and auto-commits by default**, violating
> the MVP "read-only / no repo mutation" invariant. Its future adapter must force
> `--no-auto-commits` and run in a throwaway git worktree.

**Sources:** aider.chat/docs/{scripting,config/options,faq}; github Aider-AI/aider#3903

---

## Quick comparison

| Capability | Cursor `cursor-agent` | Aider |
|---|---|---|
| Non-interactive flag | `-p`/`--print` | `-m`/`--message`, `--message-file` |
| Structured output | **Yes** — `json`, `stream-json` | **No** — text only |
| Auto-approve | `-f`/`--force`/`--yolo` | `--yes-always` |
| Model flag | `--model` (+`--list-models`) | `--model` |
| Resume | `--resume`, `--continue` | Python API only |
| Exit codes | non-zero on failure (table unverified) | undocumented |
| Auth | `CURSOR_API_KEY` / `--api-key` | provider API keys |

**Flagged:** Cursor prompt-via-stdin, exact exit codes, per-tool allowlist
unconfirmed; Aider exit codes undocumented, Python API unstable.
