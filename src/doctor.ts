// doctor — the M0 preflight (docs/4_PLAN.md). Before a real debate spends tokens,
// check that every participant's CLI actually round-trips: spawned, runnable, and
// AUTHENTICATED. The canary is a trivial "pong" prompt run through the SAME adapter
// classifiers a real turn uses, so it surfaces the exact failures that would abort a
// debate — missing binary, stale asdf shim (exit 126/127), expired auth, broken CLI —
// but fast and (for spawn failures) free, before any agent reasoning happens.
//
// This is the canary half of M0 ("version + canary status"). A cheap `--version`
// probe (is it installed, regardless of auth) and a Node >= 24 check are the natural
// next increment and belong on the adapter, behind the anti-corruption boundary.

import { runIsolated } from "./debate.ts";
import type { Participant } from "./adapters.ts";

// A preflight that can hang for the full 10m debate timeout is broken as a preflight:
// "pong" is near-instant, and a hang (stuck auth prompt, cold start) is exactly what
// we want surfaced fast. Build doctor's participants with this short timeout.
export const CANARY_TIMEOUT_MS = 90 * 1000;

// Deliberately rigid so a healthy CLI answers in one cheap token; we never assert the
// returned text equals "pong" (that would make doctor flaky on verbosity/punctuation)
// — a well-formed success envelope (`ok`) is the whole question doctor answers.
export const CANARY_PROMPT =
  'Reply with exactly the single word "pong" and nothing else. This is a connectivity check.';

export type Diagnosis = {
  id: string;
  display: string;
  vendor: string;
  ok: boolean;
  // canary text excerpt on success, or the raw adapter error on failure. The raw
  // error must survive here so the codex stale-shim footgun (0.1.x shadowing
  // 0.139.0, an exit-127 hint) stays diagnosable from doctor output alone.
  detail: string;
};

function excerpt(s: string, n = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function diagnose(p: Participant): Promise<Diagnosis> {
  const base = { id: p.id, display: p.display, vendor: p.vendor };
  try {
    const r = await runIsolated(p, CANARY_PROMPT);
    return r.ok
      ? { ...base, ok: true, detail: excerpt(r.text) || "(empty success)" }
      : { ...base, ok: false, detail: excerpt(r.error) };
  } catch (e) {
    // runIsolated itself failing (e.g. temp-dir creation) is still a doctor finding,
    // not a crash — report it so the run can grade the whole lineup.
    return { ...base, ok: false, detail: excerpt(String(e)) };
  }
}

// Canary every participant in parallel (independent checks; isolation is per-turn).
export async function runDoctor(participants: Participant[]): Promise<Diagnosis[]> {
  return Promise.all(participants.map(diagnose));
}

export function allHealthy(ds: Diagnosis[]): boolean {
  return ds.length > 0 && ds.every((d) => d.ok);
}

// Human-readable report for stderr (stdout stays the artifact channel — doctor has
// no artifact, so it prints nothing there; the exit code is the machine signal).
export function formatDiagnoses(ds: Diagnosis[]): string {
  const healthy = ds.filter((d) => d.ok).length;
  const lines = ds.map((d) => {
    const mark = d.ok ? "✓" : "✗";
    return `  ${mark} ${d.display} [${d.vendor}]: ${d.detail}`;
  });
  const verdict = allHealthy(ds) ? "OK" : "FAIL";
  return [
    `disputatio doctor — ${ds.length} participant(s)`,
    ...lines,
    ``,
    `${healthy}/${ds.length} healthy — ${verdict}`,
  ].join("\n");
}
