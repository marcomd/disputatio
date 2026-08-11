# Real run, 2026-08-04 — shell-less adapters × worktree isolation

**Scrubbed.** The debate reviewed a merge request on a private work repository. Nothing
about that MR — file paths, field names, the vulnerability mechanism — is recorded here.
Every fact below is about *Disputatio's own behaviour*, taken from
`.debate/debate-2026-08-04T10-47-28-963Z/raw/` (gitignored).

## Run shape

Four participants, repo mode, 1 reaction round, opus judge. Verdict RESOLVED, and the
`respondeo` + `final-report` were genuinely good: the judge retracted one participant's
top finding on another's evidence, downgraded two, upheld a late one, and ruled against a
"well-tested" claim. **The protocol worked.** What follows are the instrumentation and
capability gaps the same run exposed.

Counted with the real event shapes — codex `item.completed` where `item.type ===
"command_execution"`; pi `tool_execution_start`; copilot `tool.execution_start`; claude's
envelope `num_turns` / `permission_denials`. (A first pass regexed the raw JSON and
inflated every figure — codex 17→34 by double-counting `item.started`, pi 24→476 by
matching `message_update` deltas. Counting requires the per-CLI extractor, which is
exactly why step 3 belongs in the classifier and not in a script.)

| Turn | ok | exit | `ranCommands` | tool calls |
| --- | --- | --- | --- | --- |
| proposal claude | ✅ | 0 | — | 21 (`num_turns`), 0 denials |
| proposal codex | ✅ | 0 | **17** | 17 |
| proposal pi | ✅ | 0 | 0 *(not permitted)* | 24 |
| proposal copilot | ✅ | 0 | 0 *(not permitted)* | **7** |
| reaction claude | ✅ | 0 | — | 11 (`num_turns`), 0 denials |
| reaction codex | ✅ | 0 | **14** | 14 |
| reaction pi | ❌ | **null** | — | — |
| reaction copilot | ✅ | 0 | 0 *(not permitted)* | 23 |
| respondeo opus | ✅ | 0 | — | 1 (`num_turns`) |
| redactio opus | ✅ | 0 | — | 12 (`num_turns`), **1 denial** |

Codex is the only participant that executed anything. Copilot's proposal — the turn that
fabricated — did 7 tool calls; its reaction, handed the transcript, did 23.

## Finding 1 — shell-less adapters cannot see git at all in a worktree

Two of the four adapters grant no shell by invariant:

- `copilot-cli`: `--available-tools view,glob,grep`
- `pi`: `--tools read,grep,find,ls` (no OS sandbox, so the allowlist *is* the sandbox)

They therefore cannot run `git`. Worse, they cannot fall back to reading git metadata off
the filesystem either — **in a `git worktree`, `.git` is a *file* containing a
`gitdir:` pointer, not a directory.** So the usual paths do not exist.

Copilot's proposal turn is the signature, in order:

1. `grep "<mr-id>" ./` — the MR id was the only handle it had; returned ~61 KB of unrelated
   CSV/changelog rows, spilled to a temp file.
2. `view .git/HEAD` → `Path not absolute` (its `view` tool requires absolute paths).
3. `view .git/logs/HEAD` → `Path not absolute`.
4. `glob .git/refs/heads/**` → **`No files matched the pattern.`** ← the worktree tell.
5. retry `view <abs>/wt/.git/HEAD` → `Path does not exist`.

It then reported "the repository checkout here has no `.git` metadata, so branch/commit
history is unavailable" — and **fabricated a review of an entirely different MR**,
inferring the subject from the CSV/changelog grep hits. In Round 1, given the transcript,
it reversed itself and produced correct line-level findings. So the capability gap costs a
whole proposal turn *and* injects a fabrication the judge must spend a paragraph refuting.

Meanwhile `codex` (`-s read-only`, full shell) reported the checkout "contains the MR
branch, `master`, and full history" — same worktree, shell present, no problem.

This is an interaction between two *individually correct* shipped invariants (worktree
isolation; least-privilege read-only tools), and it is not recorded anywhere else.

**Trigger worth naming:** the quaestio was `Review the MR id <mr-id>, the changes in this
branch and find issues.` An MR id resolves to nothing inside a detached worktree — no ref,
no MR metadata, no remote. `proposePrompt` only says "if a repository or files are present
in your working directory", and never states that cwd is a detached worktree of HEAD or
what the diff base is. The orchestrator knows `repoPath` and could just supply the diff.

## Finding 2 — a signal-killed turn is undiagnosable

`pi`'s reaction returned `code: null`, `timedOut: false`, **empty stdout and empty
stderr**. Cause not determinable, because `runCli`'s close handler drops Node's second
argument:

```js
child.on("close", (code) => { finish({ code, stdout, stderr, timedOut }); });
//                    ^^^^ signal discarded
```

A spawn error would have surfaced (`child.on("error")` writes `String(e)` into `stderr`);
stderr is empty, so this was a signal death. Which signal is unrecoverable.

Ruled out by measurement: **prompt size.** The reaction prompt was ~9.8 KB against a
1 MB `ARG_MAX` — not remotely an `E2BIG`/argv problem. Do not re-litigate this without
`signal` in the capture.

**Reproduced live, 2026-08-11.** While validating the v0.8.0 fix, a smoke run
unintentionally hit the *real* `pi` 0.80.2 (asdf's node bin dir precedes `test/fakes/` on
PATH, and `pi` is an npm global installed there — the shims shadowed the fake for `pi`
only, not for `codex`/`claude`). Its reaction turn died with the identical signature:
`code: null`, empty stdout and stderr, `timedOut: false` — and the new capture reported
`signal: "SIGKILL"`, error `signal=SIGKILL`, in ~30 ms. So the failure is real,
reproducible, fast, and now named. What kills it is still open; the capture no longer
hides it.

Note for future smoke runs: `npm test` IS hermetic (`test/adapters.test.ts` sets
`process.env.PATH` *inside* the node process, so the fakes win). Ad-hoc shell smoke runs
under `useAll` are NOT — pass an explicit minimal `PATH` via `env` if the fakes must win.

## Finding 3 — `ranCommands` needs a capability flag, not just a count

`5_METRICS.md` §8 step 3 counts executed commands per turn. This run shows a raw count
misfires on exactly the lineup that ran: copilot (7 tool calls) and pi (24) both executed
**zero** commands, and both are *forbidden* to. A bare count scores pi — which read real
files and produced findings the judge upheld — identically to a genuinely evidence-free turn.

So the turn record needs `canExecute` (per-participant, known at adapter construction)
alongside `ranCommands`. Do **not** resolve this by granting pi `bash`; that breaks the
stated no-OS-sandbox invariant.

Step 3 would still have paid for itself here: copilot's 7-call proposal is precisely the
evidence-free turn the check exists to flag, and flagging it at proposal time is cheaper
than the judge refuting it later.

## Finding 4 — the redactio was denied a command it tried to run

The final-report turn shows `Bash` 1 / `permission_denials` 1. `runFinalize` *does* pass
`repoPath` and run repo-grounded, but the judge participant is built from the config's
judge entry, whose allowlist blocked the command it wanted. Worth confirming the
finalizer's tool grant matches its repo-grounded intent.

Related doc drift: `CLAUDE.md`'s deferred-follow-ups list said "`runFinalize` is
transcript-only". The code passes `repoPath` (`src/debate.ts` `runFinalize`) and
`4_PLAN.md` §11 correctly listed the redactio as "repo-groundable". Per the §11-wins rule,
`CLAUDE.md` was the stale one — corrected in v0.8.0. The tool-grant mismatch itself is
still open.

## What this run says about priority

It is direct support for `4_PLAN.md` §11's own **P1** — the evidence-validity check plus
Tier-0 KPIs — and against adding a sixth adapter. The judge's settled point 7 ("no
test-execution evidence exists for this branch") was reached *by reading prose*, not from
instrumentation; the orchestrator could not have reported it. The table at the top of this
note had to be reconstructed by hand from raw captures, which is exactly the gap §8 step 3
closes.

**Outcome:** findings 2 and 3 shipped in **v0.8.0** (signal capture; `canExecute` +
per-turn evidence counts + `summarizeEvidence`), which closes P1 and unblocks the M2 gate.
Finding 1 (diff-context injection for shell-less participants) and finding 4 (the
finalizer's tool grant) are still open.
