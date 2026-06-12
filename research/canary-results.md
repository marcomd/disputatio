# Canary Results — Real Local Runs (2026-06-05)

Ground truth from executing the in-scope CLIs on this machine. These **override**
any documentation claim where they differ. Trivial prompt used throughout:
`"Reply with exactly one word: pong"`. All runs redirect `</dev/null` (stdin
closed) and capture stdout/stderr separately.

Versions at start: `claude 2.1.165`, `codex-cli 0.137.0`, `agy 1.0.4`.

> ⚠️ **Version fragility, observed live:** `agy` **auto-updated from 1.0.4 to
> 1.0.5 during this investigation.** Version 1.0.5 added a `--model` flag and a
> `models` subcommand that did not exist in 1.0.4's `--help`. This is the single
> best argument for a `disputatio doctor` capability-probe before every run —
> documentation, and even a `--help` captured minutes earlier, can be stale.

---

## Claude Code (`claude 2.1.165`)

### Success
```bash
claude -p "Reply with exactly one word: pong" --output-format json --model sonnet </dev/null
```
- **EXIT 0**, stderr empty. Single-line JSON. Relevant fields:
```json
{"type":"result","subtype":"success","is_error":false,"api_error_status":null,
 "result":"pong","stop_reason":"end_turn",
 "session_id":"3b1fed94-…","total_cost_usd":0.10388775,
 "usage":{"input_tokens":3,"output_tokens":5,"cache_creation_input_tokens":27681,"cache_read_input_tokens":0}}
```
- **Cost flag:** a one-word reply cost **$0.10** because Claude Code loaded
  ~**27,681** tokens of fixed overhead (core system prompt + tool definitions; no
  `CLAUDE.md` exists in this project) as `cache_creation_input_tokens`.

### `--bare` cost lever — CANARIED, and it does NOT work under subscription auth
```bash
claude --bare -p "…pong" --output-format json --model sonnet </dev/null
# → result: "Not logged in · Please run /login", is_error: true
```
- `--bare` **skips OAuth/keychain** and requires `ANTHROPIC_API_KEY` (or
  `apiKeyHelper`). This machine authenticates Claude via **subscription
  (OAuth/keychain)**, so `--bare` fails outright. **The `--bare` cost lever is
  unavailable under subscription auth.**
- **Real cost lever under subscription auth = prompt caching, not `--bare`.** The
  27k overhead is `cache_creation` on the *first* call (~$0.10) and
  `cache_read` (~10× cheaper) on subsequent calls within the cache TTL (5 min /
  1 h). Across a multi-call debate, keep calls within the TTL to amortize it.
- `--bare` only becomes a lever if the orchestrator runs Claude with an
  `ANTHROPIC_API_KEY` instead of the subscription.

### Error (invalid model `--model not-a-real-model-xyz`)
- **EXIT 1**. JSON:
```json
{"subtype":"success","is_error":true,"api_error_status":404,
 "result":"There's an issue with the selected model …","total_cost_usd":0}
```
- **CRITICAL parsing lesson:** on error, `subtype` is **still `"success"`** while
  **`is_error` is `true`**. → **Detect failure via `is_error` (and the process exit
  code), NOT via `subtype`.** The human-readable error is in `result`.

### Adapter takeaways
- Transport: native JSON envelope, text in `.result`, id in `.session_id`.
- Success = `exit==0 && is_error==false`.
- Add `--no-session-persistence` + `--max-budget-usd` for prod runs. `--bare` only
  if running with `ANTHROPIC_API_KEY` (not subscription) — see above.

---

## Codex CLI (`codex-cli 0.137.0`)

### Success
```bash
codex exec --json -s read-only --skip-git-repo-check -o last.txt "Reply …: pong" </dev/null
```
- **EXIT 0**. stdout is JSONL:
```json
{"type":"thread.started","thread_id":"019e98b8-…"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}
{"type":"turn.completed","usage":{"input_tokens":14707,"cached_input_tokens":3456,"output_tokens":29,"reasoning_output_tokens":22}}
```
- `-o last.txt` file contains exactly `pong` (**no trailing newline**).
- stderr printed `Reading additional input from stdin...` — informational; with
  `</dev/null` it got immediate EOF and **did not hang** (confirms the documented
  stdin-hang mitigation works).

### Error (invalid model `-m not-a-real-model-xyz`)
- **EXIT 1**. JSONL contains **no `agent_message`**; instead:
```json
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{…\"message\":\"The 'not-a-real-model-xyz' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed","error":{"message":"…"}}
```
- The `-o` last-message file is empty/absent on failure.
- **Auth note:** the error reveals this machine's Codex is authenticated via a
  **ChatGPT account** (not an API key). Model availability is therefore tied to
  the ChatGPT plan.

### Adapter takeaways
- Final answer = the **last** `item.completed` with `item.type=="agent_message"`,
  or simply read the `-o` file (cleanest).
- Success = `exit==0 && a turn.completed seen && no error/turn.failed event`.
- Always `</dev/null`; capture stdout (JSONL) and stderr separately.

---

## Antigravity CLI (`agy`, 1.0.4 → self-updated to 1.0.5 mid-run)

### Success (1.0.4)
```bash
agy -p "Reply with exactly one word: pong" </dev/null
```
- **EXIT 0**, stderr empty. stdout is exactly `pong\n` (hexdump `70 6f 6e 67 0a`,
  5 bytes) — **no banner, no preamble**. The cleanest text capture of the three.

### Structured-output probes — confirm TEXT-ONLY
```bash
agy -p "hi" --output-format json   # → "flags provided but not defined: -output-format", EXIT 2
agy -p "hi" --json                 # → "flags provided but not defined: -json",          EXIT 2
```
- Unknown flags are rejected (Go `flag` package), usage printed to stderr, **EXIT 2**.
  → There is **no** structured/JSON output. Antigravity is a **text-only** adapter.

### Model selection — appeared in 1.0.5
- After the self-update, `--help` usage now lists **`--model` ("Model for the
  current CLI session")** and a **`models`** subcommand. `agy models` returns:
  ```
  Gemini 3.5 Flash (Medium) / (High) / (Low)
  Gemini 3.1 Pro (Low) / (High)
  Claude Sonnet 4.6 (Thinking)
  Claude Opus 4.6 (Thinking)
  GPT-OSS 120B (Medium)
  ```
  Note: **effort is baked into the model name** (e.g. "(High)", "(Thinking)") —
  there is no separate effort flag. Model strings contain spaces/parens, so quote
  them.

### Print mode is AGENTIC and auto-reads the workspace
- A probe run (`agy --model foo -p "hi"`) did **not** just answer — it
  autonomously **listed the directory, read project docs and research files,
  and ran a version command**, then produced a
  long summary — **without** `--dangerously-skip-permissions`. → In print mode
  `agy` auto-executes **read-only** workspace tools by default. Good for
  evidence-gathering, but means: (a) it incurs real token/latency cost even for
  "trivial" prompts, (b) it sees whatever is in the working directory.
- An invalid `--model foo` was **not** rejected — it ran with a default model. So
  model validation is lax; pin a known-good name from `agy models`.
- `--print-timeout` defaults to **5m**; cap externally too.

### Adapter takeaways
- Transport: **raw stdout = the answer** (no envelope). No machine-readable
  metadata (no cost, no session id on stdout).
- Success/error signaling: rely on **process exit code** + non-empty stdout
  (EXIT 2 = flag/usage error; needs hands-on confirmation of runtime API-failure
  exit codes — not yet canaried).
- This is the reference implementation of the **text-only path**: prompt in →
  text out → parse the in-band structured trailer (or LLM-extract as last resort).

---

## Cross-cutting lessons

1. **Trust runtime over docs.** `codex` 0.137.0 dropped `-a/--ask-for-approval`;
   `agy` gained `--model` between 1.0.4 and 1.0.5; Claude's `subtype` lies on
   error. None of this is visible without running the binary.
2. **Two error channels, always check both:** process **exit code** AND in-band
   error signal (`is_error` / `error`+`turn.failed` events / EXIT 2 usage dump).
3. **Capability tiers are real:** claude + codex = rich JSON envelope; `agy` =
   text-only. The adapter layer must support both without special-casing the
   debate engine.
4. **`</dev/null` everywhere** — confirmed necessary/harmless.
5. **Fixed-cost overhead matters** (Claude's 27k-token system prompt). Hermetic
   modes (`--bare`, `codex --ignore-user-config`) are cost levers, not just
   reproducibility levers.

---

# Addendum — canaries of 2026-06-11 (after a repo-grounded run)

Triggered by a repo-grounded run (`research/real-run-2026-06-11-repo-grounded.md`):
two turns failed undiagnosably, so the exact failure envelopes were canaried.

## Claude: budget-exceeded envelope (the `is_error=true` mystery, solved)

```bash
claude -p "…pong" --output-format json --model sonnet --max-budget-usd 0.01 </dev/null
```
- **EXIT 1**. Envelope (trimmed): `subtype:"error_max_budget_usd"`, `is_error:true`,
  **NO `result` field at all**, `errors:["Reached maximum budget ($0.01)"]`,
  `total_cost_usd:0.166962` (the budget is checked *after* the spend).
- **Parsing lesson:** on budget exhaustion the human-readable message is in the
  **`errors` array**, not `result`. An adapter reading only `result` reports the
  useless `is_error=true`. Read order: `errors[]` → `result` → fallback.
- Here `subtype` IS informative (`error_max_budget_usd`) — but classification still
  keys on `is_error` (the 2026-06-05 canary showed `subtype` can lie).

## Codex 0.139.0 (Homebrew): recipe re-confirmed

```bash
/opt/homebrew/bin/codex exec --json -s read-only --skip-git-repo-check --ephemeral "…pong" </dev/null
```
- **EXIT 0**, JSONL exactly as on 0.137.0 (`thread.started` → `turn.started` →
  `item.completed`/`agent_message` → `turn.completed`). Adapter recipe unchanged.
- ⚠️ **Stale-shim trap (this machine):** `which codex` resolves to an asdf shim of
  an ancient npm codex (0.1.x, 2025-05) installed under nodejs 22.14.0. From any
  cwd whose `.tool-versions` pins another node, the shim fails with **EXIT 126**
  ("No version is set for command codex"). The real 0.139.0 is the Homebrew cask at
  `/opt/homebrew/bin/codex` — shadowed by the shim. Hence: the codex adapter takes a
  `bin` override (debate.yaml), and exit 126/127 is classified as a *setup* failure
  with a hint, not an agent failure.

## agy: `--sandbox` print mode works

```bash
agy --sandbox -p "…pong" </dev/null   # → "pong", EXIT 0
```
- Output identical to non-sandbox print mode. Required from now on: the repo-grounded run
  showed plain print mode can **auto-execute terminal commands** during evidence
  gathering — not just read-only workspace tools as the 2026-06-05 probe suggested.
