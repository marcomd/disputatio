# Disputatio

**Structured debate between real AI coding-agent CLIs.**

Disputatio is an experimental local-first CLI that orchestrates debate between
native coding-agent CLIs such as `claude`, `codex`, and optionally `agy`. It runs
the real harnesses, not raw LLM API calls.

## Install

```bash
npm install -g disputatio
```

## Quick start

Authenticate the participant CLIs first, then run:

```bash
disputatio --init
disputatio --doctor
disputatio "Review changes in this branch and find issues."
disputatio "Review changes in this branch and find issues." --rounds 1 --repo /path/to/repo
disputatio --file path/to/task.md     # long quaestio from a file instead
```

`--init` writes `~/.config/disputatio/config.yaml`. `--doctor` canaries the
configured participants before a debate spends tokens.

Debate transcripts are written under `.debate/debate-<timestamp>/`; stdout prints
only the transcript path, while progress and diagnostics go to stderr.

## Documentation

Full usage, design notes, adapter details, and development instructions live in
the GitHub repository:

https://github.com/marcomd/disputatio

## Status

Experimental early MVP. Use on repositories and accounts that each configured CLI
is allowed to access.
