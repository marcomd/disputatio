# Quaestio — I Love Coding v0.9: the optional local AI character layer

## Context

*I Love Coding* is a turn-based strategy tycoon (Godot 4.5, GDScript) about running a
software company through 60 years of computing history. The codebase you are looking
at is the real game repository (read-only, HEAD).

Two architectural rules dominate this project and are non-negotiable:

1. **`src/core/` is engine-agnostic, deterministic simulation.** It is pure GDScript
   (`RefCounted`, no `Node`), driven by a **seeded PRNG** held on `GameState`. The
   contract is literal: *same seed → same game*. This is what makes replay and bug
   reproduction possible, and the integration tests rely on it.
2. **Markdown/JSON saves are forward-and-backward portable.** A save is a versioned
   JSON snapshot of `GameState`; it must round-trip and migrate cleanly.

v0.7 already shipped the **Developer Personality Core**: six stable traits + five
dynamic-state values per developer, a bounded 12-entry short-term memory, and
deterministic compaction of overflow into long-term *theme counters*. Crucially, v0.7
**reserved a plug-in point for the AI layer** — a static `Callable`:

- `PersonalityEngine.set_llm_summarizer(cb)` / `_llm_summarizer`
  (`src/core/systems/personality_engine.gd`)
- It is invoked during memory compaction (`_compact_*` → `_safe_llm_call` →
  `_merge_llm_themes`), and **any invalid output falls back to the deterministic
  theme map**.

## The feature under debate (v0.9 MVP)

> **Optional local AI character layer.** Plug a *small local model* into
> `PersonalityEngine.llm_summarizer` so memory compaction and developer "thoughts"
> can vary their **wording** on top of the v0.7 deterministic simulation. A
> deterministic fallback always ships, so gameplay never depends on a model being
> available. (No cloud calls — local inference only.)

The intended player-visible value is **flavor**: developers that *sound* alive
(varied phrasing, short in-character "thoughts"), not new game mechanics.

## The central question

**How should v0.9 be implemented so that the local AI layer enriches *presentation*
without ever altering the *simulation*?**

That is the whole debate. Before proposing a runtime or a model, resolve the boundary
problem, because the obvious wiring violates it. Concretely, investigate and take a
position on:

1. **The leak in the current hook.** The reserved hook does not feed presentation —
   it feeds `_merge_llm_themes`, i.e. the developer's **long-term theme counters**,
   and those themes influence simulation (theme-driven trait drift → morale / burnout
   / quit-risk). If a local model is plugged in as-is, **AI-on and AI-off produce
   different games from the same seed**, and a save written with AI on loads
   differently with AI off. Read the code and confirm or refute this. *Where exactly,
   today, can `_llm_summarizer` output flow into state that affects the simulation or
   the save file?* Cite `file:line`.

2. **Where the boundary should live.** If wording variety must not touch themes,
   should the LLM hook be **moved off the compaction path entirely** (a separate
   presentation-only "voice" layer the UI calls), kept where it is but **stripped to
   non-semantic rephrasing** (themes stay deterministic; only their *display string*
   varies), or something else? Argue for one. Be concrete about what changes in
   `personality_engine.gd`, the serializer, and the presentation layer.

3. **Determinism & saves.** State the invariant you are protecting in one sentence,
   then show the minimal design that guarantees it (e.g. AI output is never
   serialized; the seed/RNG never advances through the model; loading a save never
   depends on a model). What must a test assert to *prove* AI-on and AI-off are the
   same game?

4. **Threading & performance.** Local inference can take hundreds of ms to seconds.
   Godot's main thread must not block on it. Propose the concurrency model (when the
   model runs, what the player sees while it runs, what happens if it is slow) that
   keeps the deterministic turn cycle untouched.

5. **The fallback contract.** Today, invalid output ⇒ deterministic path. Define the
   full set of failure modes for a *local* model (absent, slow/timeout, malformed,
   unsafe/over-long output) and confirm each one lands on the deterministic fallback
   with identical resulting state.

6. **Bounded "thoughts".** The feature promises *bounded* developer thoughts. What
   bounds (length, frequency, content constraints) and where are they enforced so a
   model cannot emit unbounded or off-tone text into the UI?

7. **Runtime/model choice (secondary).** Only after the above: what local-inference
   approach fits a Godot game shipping to players' machines (e.g. llama.cpp via GDExtension,
   an external process, an embedded tiny model), and how does it stay optional and
   hardware-adaptive?

## How to argue

- **Read the repository.** The relevant code is real and present:
  `src/core/systems/personality_engine.gd` (the hook, compaction, theme merge),
  `src/core/state/developer.gd` and `game_state.gd` (what is stored / seeded),
  `src/persistence/state_serializer.gd` (what is saved), and the v0.7 tests under
  `test/`.
- **Ground objections in evidence.** Prefer a `file:line` citation over an assertion.
  If you can run a read-only command to confirm a claim, do it and report what you ran.
  (Note: this is a Godot/GUT project; the headless test runner may not be available in
  this sandbox — a precise code citation is the expected evidence here.)
- Be concrete and opinionated. Name the design you would ship for the v0.9 MVP, and be
  explicit about the trade-off you are rejecting.
