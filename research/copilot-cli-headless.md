# GitHub Copilot CLI headless notes

Verified locally on 2026-06-28 with `npx --yes @github/copilot --help` / `help permissions` and package `@github/copilot` 1.0.65.

## Binary and install

- Package: `@github/copilot`
- Binary: `copilot` (the adapter id is `copilot-cli` to avoid confusing it with the package name)
- Version can be checked with `copilot --version` or `copilot version`.

## Headless invocation

```bash
copilot -p "<prompt>" \
  --output-format json \
  --stream off \
  --no-color \
  --no-remote \
  --no-remote-export \
  --no-auto-update \
  --no-ask-user \
  --disable-builtin-mcps \
  --available-tools view,glob,grep \
  --model auto \
  --effort medium \
  </dev/null
```

Findings from `--help`:

- Non-interactive / print mode: `-p, --prompt <text>` (executes a prompt and exits).
- Prompt channel: command-line argument to `-p` / `--prompt`.
- Model selection: `--model <model>`; `auto` lets Copilot choose automatically.
- Machine-readable output: `--output-format json` emits JSONL (one JSON object per line). `text` is the default.
- Reasoning effort: `--effort, --reasoning-effort <level>`; choices are `none`, `low`, `medium`, `high`, `xhigh`, `max`.
- Session/noise controls useful for automation: `--stream off`, `--no-color`, `--no-remote`, `--no-remote-export`, `--no-auto-update`, `--no-ask-user`.

## Read-only mechanism

`help permissions` says tool availability is controlled by `--available-tools` / `--excluded-tools`; permission prompts are controlled separately by `--allow-tool`, `--deny-tool`, and `--allow-all-tools`. The safe read-only route is to restrict tool availability to the read-only built-ins seen in the CLI's own configuration output:

- `view`
- `glob`
- `grep`

The adapter also passes `--disable-builtin-mcps`, so GitHub MCP tools are not available, and does **not** pass `--allow-all-tools`, `--allow-all`, or `--yolo`. With `--available-tools view,glob,grep`, the CLI reported these mutating/external tools disabled in a canary: `bash`, `create`, `edit`, `web_fetch`, plus several task/session/bash management tools.

## JSONL shape and success classification

A simple canary (`-p "Reply with exactly pong."`) emitted:

- setup/configuration events (`session.*`)
- `user.message`
- `assistant.turn_start`
- one or more `assistant.message` events; final prose is in `data.content`
- `assistant.turn_end`
- `result` with top-level `exitCode: 0` and `usage`

Success should be structural: process exit code `0`, a `result` event with `exitCode: 0`, and a non-empty final `assistant.message.data.content`. Use the **last** assistant message because earlier assistant messages can contain tool-use narration.

Early configuration failures (for example an unavailable model) exit non-zero and print a plain stderr line such as `Error: Model "does-not-exist" from --model flag is not available.` before any JSONL stream.

## Canary: read-only file read

Command:

```bash
mkdir "$tmp" && printf 'hello-copilot\n' > "$tmp/a.txt"
cd "$tmp"
npx --yes @github/copilot \
  -p "Read a.txt and reply exactly with its content." \
  --output-format json --stream off --no-color \
  --no-remote --no-remote-export --no-auto-update --no-ask-user \
  --disable-builtin-mcps --available-tools=view,glob,grep --model auto
```

Observed:

- configuration event: `Disabled tools: bash, create, edit, ... web_fetch`
- tool call: `view` on `a.txt`
- final assistant message: `hello-copilot`
- result event: `exitCode: 0`
