# Disputatio: Agent Adapters — Headless Invocation & Output Capture

> Design note for the integration layer: how Disputatio drives heterogeneous
> agent CLIs non-interactively and turns their output into a canonical
> `DebateContribution`. This is the layer the concept (`2_CONCEPT.md`) flagged as
> the project's biggest technical risk.
>
> **Grounding:** every per-CLI claim here is backed by the local runs in
> `../research/canary-results.md` (verified on this machine, 2026-06-05) or the
> official-doc reports in `../research/`. Where a claim is documented but not yet run
> locally, it is marked **[to verify]**.

---

## 1. Scope

**In scope now** (installed, canaried):

| Agent | Binary | Version (canaried) | Output tier |
| --- | --- | --- | --- |
| Claude Code | `claude` | 2.1.165 | rich JSON envelope |
| OpenAI Codex | `codex` | 0.137.0 | rich JSONL stream |
| Google Antigravity | `agy` | 1.0.4→1.0.5 | **text-only** |

**Deferred** (future adapters, research preserved in `../research/`): Cursor
(`cursor-agent`), Aider. **Reference only:** Gemini CLI (`gemini`) — deprecated,
sunsets 2026-06-18; kept because `agy` partly inherits its architecture.

---

## 2. Architecture: separate Transport from Normalization

The only way to keep heterogeneity manageable is to split two problems that look
like one:

```
            ┌─────────────────────────────────────────────────────────┐
            │                     Debate Engine                         │
            │     (works only with canonical DebateContribution)        │
            └───────────────────────────┬─────────────────────────────┘
                                         │  canonical struct + RAW prose
            ┌────────────────────────────┴────────────────────────────┐
            │                    Normalization                          │
            │  parse self-emitted trailer  →  (fallback) LLM-extract    │
            └────────────────────────────┬────────────────────────────┘
                                         │  bytes (stdout/stderr/exit)
            ┌────────────────────────────┴────────────────────────────┐
            │                      Transport                            │
            │  build argv · spawn · stdin</dev/null · capture · classify │
            └──────┬──────────────────┬───────────────────┬───────────┘
                   ▼                  ▼                   ▼
              claude adapter     codex adapter        agy adapter
```

- **Transport** is where *all* per-CLI difference lives (argv shape, prompt
  channel, output framing, success/error classification). It produces a uniform
  `RawAgentRun { stdout, stderr, exit_code, parsed_envelope?, text, ok }`.
- **Normalization** is uniform across agents. It turns `text` into the canonical
  `DebateContribution`.

### Two invariants (carried from `2_CONCEPT.md` §7)

1. **Raw prose is the source of truth; the struct is only an index.** The
   `respondeo` (judge) always reads each contribution's **verbatim prose**, never
   the normalized struct. The struct exists only for routing and
   consensus-tracking. This protects the diverse, sharp reasoning that justified
   using multiple harnesses.
2. **Do NOT use native schema-constrained output on debaters.** Forcing
   `--json-schema` (Claude) / `--output-schema` (Codex) flattens the free-form
   reasoning. Reserve schema-constraint for the *respondeo*'s final determination
   and for an optional normalization-repair pass — never for the debaters'
   arguments.

---

## 3. The output contract — three levels

Ordered by fidelity and cost. Always prefer the highest available.

| Level | Mechanism | Used for | Reliability |
| --- | --- | --- | --- |
| **A. Native JSON envelope** | `claude --output-format json`, `codex --json`/`-o` | Transport + metadata (text, session id, cost, error flag) | High where supported (claude, codex). N/A for `agy`. |
| **B. Self-emitted structured trailer** | We instruct the agent (system/append prompt) to end its prose with a fenced ` ```disputatio ` YAML block; we parse it **deterministically**. | The `DebateContribution` fields | High — faithful, cheap, works for every agent incl. text-only |
| **C. LLM extraction** | A cheap model reads the prose and emits the struct (schema-constrained) | **Last resort** when B is missing/malformed | Lower — risks smoothing/dropping objections |

**Design rule:** Level **A** carries the *transport envelope* (so we get cost,
session id, and a reliable error flag where the CLI offers them). Level **B** is
the *primary* source of the contribution struct for **all** agents, because it is
faithful and uniform. Level **C** runs only on a parse miss, and emits a warning
into the debate metadata so a smoothed/dropped objection is never silent.

> **Why B over C as the default:** an LLM normalizer is itself prone to
> false-consensus at the plumbing layer — it can soften a sharp objection or drop
> a dissent the judge then never sees. Self-emission is deterministic and
> verbatim. C is the fallback, not the path.

### The `disputatio` trailer (draft — to finalize with the contribution contract)

````text
```disputatio
positions:
  - id: P1
    claim: "<one-line stance>"
objections:
  - target: P1            # or another agent's position id
    claim: "<the objection>"
    evidence: [E1]
evidence:
  - id: E1
    type: command-output  # assertion | citation | command-output
    detail: "ran `pytest tests/test_auth.py` → 2 failed"
open_questions:
  - "<unresolved question>"
confidence: 0.7
```
````

Parsing: extract the fenced `disputatio` block, parse YAML, validate against the
contribution schema. On failure → Level C + warning.

---

## 4. Per-CLI adapter specs (grounded in canary)

### 4.1 Claude Code (`claude`) — rich JSON envelope

```bash
claude -p "<prompt>" \
  --output-format json \
  --append-system-prompt "<role + trailer contract>" \
  --add-dir <repo> \
  --model <sonnet|opus|claude-…> [--effort high] \
  --allowedTools "Read Grep Glob Bash(git *) Bash(pytest *) …" \
  --no-session-persistence \
  --max-budget-usd <cap> \
  </dev/null
```

- **Prompt channel:** argument (or stdin ≤10MB).
- **Transport capture:** `.result` = prose; `.session_id`; `.total_cost_usd`.
- **Success classification:** `exit==0 && .is_error==false`.
  - ⚠️ **Do NOT use `.subtype`** — on error it stays `"success"` while
    `.is_error` flips to `true` (canaried). Trust `is_error` + exit code.
- **Cost lever (auth-dependent — canaried):** a one-word reply cost **$0.10** from
  ~27k tokens of fixed overhead (core system prompt + tool defs; no `CLAUDE.md`
  here). **`--bare` would remove most of it BUT requires `ANTHROPIC_API_KEY` — it
  fails under subscription/OAuth auth** (canary: "Not logged in"). So:
  - **Subscription auth:** the lever is **prompt caching** — first call is
    `cache_creation` (~$0.10), later calls within the TTL are `cache_read`
    (~10× cheaper). Keep a debate's Claude calls within the cache window.
  - **API-key auth:** `--bare` + explicit `--append-system-prompt`/`--add-dir`
    becomes available and removes the overhead.
- **Autonomy:** for read-only evidence runs, allowlist read tools; never need
  `--dangerously-skip-permissions` for the MVP (no mutation).
- **Effort:** native `--effort {low,medium,high,xhigh,max}`.

### 4.2 OpenAI Codex (`codex`) — rich JSONL stream

```bash
codex exec --json \
  -s read-only \
  --skip-git-repo-check \
  -o <last-message-file> \
  --ephemeral \
  -m <model> [-c model_reasoning_effort="high"] \
  -C <repo> \
  "<prompt>" \
  </dev/null
```

- **Prompt channel:** argument; or `codex exec -` for full-stdin; piped stdin is
  appended as a `<stdin>` block.
- **Transport capture:** read **`-o` last-message file** for the clean final
  answer (simplest), OR take the **last** `item.completed` with
  `item.type=="agent_message"` from the JSONL (there can be earlier ones).
- **Success classification:** `exit==0 && saw turn.completed && no error/turn.failed event`.
  On failure: `error` + `turn.failed` events, empty `-o` file (canaried).
- **stdin:** `</dev/null` required — exec reads stdin and would otherwise risk a
  hang (canary showed `Reading additional input from stdin...` then clean EOF).
- **Autonomy:** `-s read-only` for non-mutating MVP runs; no separate approval
  flag in 0.137.0.
- **Effort:** `-c model_reasoning_effort="…"`.
- **Auth (this machine):** ChatGPT account → model catalog tied to the plan.

### 4.3 Google Antigravity (`agy`) — text-only

```bash
agy -p "<prompt>" \
  --model "<one of `agy models`>" \
  --add-dir <repo> \
  --print-timeout 10m \
  </dev/null
```

- **Prompt channel:** argument (`-p`/`--print`/`--prompt`).
- **Transport capture:** **raw stdout = the answer** (canary: exactly `pong\n`, no
  banner). No JSON envelope, no cost/session metadata. **No `--output-format`/
  `--json`** (rejected with EXIT 2 — confirmed text-only).
- **Success classification:** rely on **exit code** + non-empty stdout. EXIT 2 =
  flag/usage error. ([to verify] runtime API-failure exit codes — not yet
  canaried; a bad `--model` was silently ignored rather than erroring.)
- **Model/effort:** `--model "<name>"` (added in 1.0.5); effort is **baked into the
  model name** (e.g. `"Claude Opus 4.6 (Thinking)"`, `"Gemini 3.5 Flash (High)"`).
  Discover with `agy models`. Quote names (spaces/parens). Pin a known-good name.
- **Agentic by default:** print mode **auto-executes read-only workspace tools**
  (it read repo files unprompted in canary). Aligns with our read-only evidence
  model, but means real cost/latency on every call and exposure to whatever is in
  the working dir. Scope `--add-dir` deliberately.
- **This is the text-only reference adapter** — it must rely entirely on the
  Level-B self-emitted trailer (Level C fallback), since there is no envelope.

### 4.4 GitHub Copilot CLI (`copilot-cli`) — JSONL stream

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
  --model auto [--effort medium] \
  </dev/null
```

- **Package/binary:** npm package `@github/copilot`; installed binary is `copilot`.
  Disputatio's adapter id is `copilot-cli`.
- **Prompt channel:** argument via `-p` / `--prompt`; non-interactive mode exits after
  completion.
- **Transport capture:** `--output-format json` emits JSONL. The final answer is the
  **last** `assistant.message.data.content`; earlier assistant messages can contain
  tool-use narration. Completion is marked by a `result` event with top-level
  `exitCode` and `usage`.
- **Success classification:** `process exit==0 && saw result.exitCode==0 && last
  assistant.message is non-empty`. Early config/auth failures can print plain stderr
  before any JSONL, so preserve stderr on failure.
- **Autonomy/read-only:** no OS sandbox. Restrict tool availability to read-only
  built-ins with `--available-tools view,glob,grep`, disable builtin GitHub MCP with
  `--disable-builtin-mcps`, and do **not** pass `--allow-all-tools`, `--allow-all`, or
  `--yolo`. The canary showed mutating/external tools (`bash`, `create`, `edit`,
  `web_fetch`, etc.) disabled under this allowlist.
- **Effort:** native `--effort` / `--reasoning-effort` values: `none`, `low`,
  `medium`, `high`, `xhigh`, `max`.

---

## 5. Capability tiers → minimum adapter requirement

The canary proves two tiers coexist, so the engine must not assume an envelope:

- **Tier 1 (envelope):** `claude`, `codex`, `pi`, `copilot-cli` — JSON/JSONL gives
  reliable structural markers (error flags/completion events/result events). Transport
  classifies success from the envelope + exit code.
- **Tier 2 (text-only):** `agy` (and future Aider) — only stdout text + exit code.
  Transport classifies success from exit code + non-empty/parseable output; the
  contribution struct comes from the Level-B trailer.

> **The minimum bar to onboard ANY agent is therefore very low: "can it take a
> prompt and print text to stdout?"** This is the deliberate de-risking of the
> whole heterogeneity concern — and of the Gemini→Antigravity churn. Because `agy`
> is text-only and its flags shifted under us (1.0.4→1.0.5) mid-investigation,
> **`agy` is the first proof of the text-only path, not an afterthought.**

---

## 6. Transport hardening rules (apply to every adapter)

1. **`stdin < /dev/null`** unless deliberately piping (Codex hang mitigation —
   canaried safe).
2. **Capture stdout and stderr separately** (Codex/Cursor put progress on stderr).
3. **Never trust the exit code alone, never trust the envelope alone — check
   both.** Dev tools exit non-zero on mere findings; Claude lies in `.subtype`;
   `agy` returns EXIT 2 for usage errors.
4. **Hermetic where possible:** `codex --ignore-user-config` for reproducibility.
   `claude --bare` is hermetic + cheap **but only under `ANTHROPIC_API_KEY`** — it
   breaks subscription/OAuth auth (canaried), so it is not a default here.
5. **Stateless:** no `--resume`/`--continue`; the orchestrator owns memory
   (`2_CONCEPT.md` §8). Use `claude --no-session-persistence`, `codex --ephemeral`.
6. **External timeout + budget** on every spawn (wall-clock kill;
   `claude --max-budget-usd`; cap `agy --print-timeout`).
7. **Read-only in the MVP:** `codex -s read-only`, Claude read-tool allowlist; no
   mutation. (Aider, when added, must force `--no-auto-commits` in a throwaway
   worktree — it writes/commits by default.)
8. **Record provenance** per run: binary path, version, full argv, model, exit
   code, cost. Versions are fragile — capture them into the debate metadata.

---

## 7. The adapter as a declarative manifest (+ thin code)

Most per-CLI variance is **data**, not logic. End-state: each adapter is a
manifest plus a small amount of escape-hatch code (e.g. Codex's "scan JSONL for
the last `agent_message`").

```yaml
name: claude
invoke:    { bin: claude, base: ["-p"], prompt: arg, stdin: /dev/null }
transport: { kind: json-envelope, text_path: ".result",
             ok: "exit==0 && .is_error==false", session_path: ".session_id",
             cost_path: ".total_cost_usd" }
model:     { flag: "--model" }
effort:    { kind: flag, flag: "--effort" }     # codex: kind: config "-c model_reasoning_effort="; agy: kind: in-model-name
hermetic:  []                                    # "--bare" ONLY if auth==api-key (breaks OAuth/subscription)
stateless: ["--no-session-persistence"]
autonomy:  ["--allowedTools", "Read Grep Glob Bash(git *)"]
tested_versions: "2.1.x"
---
name: agy
invoke:    { bin: agy, base: ["-p"], prompt: arg, stdin: /dev/null }
transport: { kind: raw-text, ok: "exit==0 && stdout_nonempty" }
model:     { flag: "--model", quote: true }     # values from `agy models`
effort:    { kind: in-model-name }
tested_versions: "1.0.5"   # ⚠ 1.0.4→1.0.5 self-updated mid-investigation
```

A `disputatio doctor` command resolves each manifest against the installed binary
(version + capability probe) and **fails loudly on drift** before a debate runs —
motivated directly by the `agy` self-update.

> **Status (2026-08-03): the manifest is NOT built** — it remains the end-state sketch
> above. All five adapters are hand-written `Participant` factories in `src/adapters.ts`;
> the per-CLI *facts* in §4 are what actually got encoded, just as code rather than as
> data. `--doctor` **is** built (`src/doctor.ts`) and canaries each participant through
> its real classifier, but it does **not** do the version-drift check described here —
> so the `agy` self-update hazard is currently undetected. See
> [`4_PLAN.md`](./4_PLAN.md) §4 and §11.

---

## 8. Build sequencing

The manifest model is the right end state, but do not build the 5-agent framework
first. The premise (debate > single agent) is still unvalidated.

1. **Hardcode two adapters crudely** — `claude` (envelope tier) + `agy` (text
   tier). Picking one of each tier proves the abstraction the hard way.
2. **Run one debate end-to-end to a `respondeo` determination** on a text-artifact
   task.
3. **Add `codex`**, then generalize the three into the declarative manifest.
4. Only then consider Cursor/Aider and the `disputatio doctor` polish.

> **Status (2026-08-03): steps 1–3 happened, but out of order and further than planned.**
> Five adapters exist (`claude`, `codex`, `agy`, `pi`, `copilot-cli`) and `--doctor` is
> built, while the manifest generalization never happened and — the part that matters —
> **the premise validation this sequencing exists to protect has still not run.** The
> warning above ("do not build the 5-agent framework first") was, in the event, not
> heeded. The honest record is [`4_PLAN.md`](./4_PLAN.md) §11 "Deviations, recorded
> honestly"; adapter breadth is the clearest case of building sideways instead of forward.
> Adding a sixth adapter should wait for the gate.

> ⚠️ **Backends MUST span different model families for premise validation.**
> `agy models` shows it can run **Claude Sonnet/Opus 4.6** as backends. If `agy`
> is pointed at a Claude model while the `claude` adapter and the Opus `respondeo`
> are also Anthropic, the whole debate becomes single-vendor — correlated errors
> and mutual deference, i.e. the exact false-consensus failure `2_CONCEPT.md` §2
> warns about. This is invisible at the transport layer, so the canary cannot
> catch it. The intended public lineup pins `agy` →
> **Gemini Flash 3.5** and `codex` → GPT; honour that. Diversity is a *config-time*
> property the engine must guard, not assume.
>
> Latent opportunity (post-MVP): because `agy` selects its backend per call via
> `--model`, **one text-only `agy` adapter can host several distinct
> participants** (Gemini, GPT-OSS, …). Useful later; for validation, cross-vendor
> is mandatory, not optional.

---

## 9. Open items to verify next

- **[to verify]** `agy` runtime exit code on an actual API failure (only flag/usage
  EXIT 2 and silent bad-`--model` observed so far).
- **[to verify]** Whether `agy` accepts piped stdin as prompt/context.
- **[to verify]** Codex behavior under `-s read-only` when the agent *wants* to run
  a command for evidence (does it surface a blocked-command event we can read?).
- **[decide]** Exact `disputatio` trailer schema — finalize with the contribution
  contract (`2_CONCEPT.md` §7).
- **[decide]** For Claude under `--bare`, the minimal `--append-system-prompt-file`
  that carries role + trailer contract without re-bloating cost.
