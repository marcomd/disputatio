# Real run 2026-06-23 - anonymized Phrase removal workflow debate

This note summarizes a local work-project debate preserved under the gitignored
`.debate/` directory. It is intentionally anonymized: organization names, people,
internal paths, exact scale figures, and details of the referenced internal
translation automation document are omitted or generalized. Public vendor and
technology names such as Phrase, Rails, i18n, Psych, and i18n-tasks are kept.

The public value of this run is not the target project itself. It is a compact
example of Disputatio producing useful process architecture while also exposing
where missing evidence should force a `NEEDS_INPUT` outcome.

## 1. Setup

The quaestio asked how to remove Phrase from a large Rails i18n workflow while
preserving a file-based translation process, deterministic merge behavior, and
category-oriented locale ordering. The run used two proposal participants
(`claude` sonnet and `codex`) with two reaction rounds, followed by a `claude`
opus respondeo.

Important limitation: the referenced internal automation document and target
locale tree were not available inside the evidence workspace. Both proposal
agents noticed this and grounded their answers in the prompt plus small local
checks rather than pretending to inspect the real project.

Measured Claude-side cost was about **$0.69** across proposal, reactions, and
respondeo. Codex reported no comparable dollar figure in this artifact.

## 2. Evidence tier

This was **not repo-grounded evidence**. The target repository files, the
internal automation document, and the real `<locale_root>/` tree were missing.

It still had useful executable evidence:

- Codex showed that default local interpreters were not configured without
  explicit version selection in that sandbox.
- Codex showed `Psych.safe_load`/`Psych.dump` preserve Ruby hash order but drop
  comments under normal load/dump.
- Codex showed `Psych.safe_load` silently overwrites duplicate YAML keys after
  loading into hashes.
- Codex showed YAML aliases/merge keys require an explicit support or ban
  policy.
- Codex showed `i18n-tasks` and `ruamel.yaml` were not available by default in
  that environment.

The lesson for Disputatio is that "no files attached" is still actionable
evidence, but it should lower the confidence tier and be visible in the final
artifact.

## 3. Converged design

The debaters converged on a few durable points:

- The Rails repository should become the translation source of truth after
  removing Phrase.
- Automation, not translators, should own canonical locale files.
- Translators should work on small generated translation batches rather than the
  full locale tree.
- New, changed, removed, and renamed keys need first-class workflow semantics.
- Key deletion cannot be a passive orphan report; it must be represented and
  applied intentionally.
- Existing locale layout should be preserved unless the real files prove a
  layout migration is necessary.
- Ordering should follow the English skeleton or another explicit canonical
  skeleton, not ad hoc append behavior.
- CI should hard-block on invalid YAML, interpolation mismatch, pluralization
  shape mismatch, and structurally unsafe locale changes.
- Stale translations and copied-English target values probably need a staged
  warning-to-error rollout rather than immediate hard failure.
- Applied batches need provenance: batch id, base commit or baseline, source
  checksum, generator version, target locale, and applied checksum.

The strongest process conclusion was: replacing Phrase with "people edit files"
is not enough. The replacement is a Git-native state machine: export batch,
translate batch, validate batch, apply batch, normalize canonical files, and
record provenance.

## 4. Reaction-round value

The useful work happened mostly in the reactions.

Claude conceded that a naive `git show HEAD:...` baseline is wrong after merge
and should be replaced by an explicit baseline: merge-base, release tag, stored
snapshot, or applied-batch manifest.

Codex challenged the early "small merge script" estimate with executable YAML
edge cases. The important correction was not "never use Psych"; it was "do not
load YAML into plain hashes before deciding duplicate-key, comment, and alias
policy."

Claude challenged Codex's proposed locale layout split as unjustified without
access to the real `<locale_root>/` shape. That was accepted: preserving existing
structure is the default until evidence says otherwise.

Both agents converged on a narrower Ruby-first recommendation for a Rails
monolith, while still requiring AST/token-level checks or explicit CI bans for
comments, aliases, merge keys, and duplicate keys.

## 5. Respondeo outcome

The judge returned `STATUS: NEEDS_INPUT`, which was the correct outcome. Three
facts could not be resolved from the transcript:

1. Whether translations land synchronously with English changes or asynchronously
   across later cycles.
2. Whether the real locale files contain meaningful comments, anchors, aliases,
   merge keys, or duplicate paths.
3. Whether the translation handoff should be a Git PR by the translator or a
   file handoff to a developer-run apply step.

Those questions gate architecture. In particular, asynchronous translation needs
durable staleness tracking, while synchronous translation can often rely on
batch-time source checks plus stricter PR completeness rules.

## 6. Tool lessons for Disputatio

This run is a good fixture for three product behaviors:

- **Attachment preflight.** If a prompt references a file such as an internal
  automation document, Disputatio should verify that the file is present in the
  evidence workspace before spending turns. Missing files should be reported
  early and carried into the transcript.
- **Evidence tiering.** A final answer can be useful without repo access, but it
  should label itself as prompt-grounded plus local-canary evidence, not
  repo-grounded.
- **Resolvable vs. blocked.** The respondeo should preserve settled agreements
  while explicitly returning `NEEDS_INPUT` for facts that require the human or
  real repository.

This is also a useful example of why reaction rounds matter. The initial
proposals were plausible; the reactions exposed baseline brittleness, YAML data
loss risks, layout overreach, missing deletion semantics, rename carryover, CI
severity, and translator handoff assumptions.

## 7. Scrubbing notes

The public note removes or generalizes:

- organization and person names;
- internal repository and documentation paths;
- exact project scale figures;
- exact locale directory names;
- any content that would have depended on the internal automation document.

The internal automation document itself was not available to agents in the run,
so there are no attachment details to preserve here. This made a public
anonymized note feasible; no `research/private_*` fallback was needed.
