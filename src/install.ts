// Install / setup phase (Kaizen). Two jobs, both about making Disputatio portable
// across the two ways it runs — from source (`node src/index.ts`) and as the installed
// binary (`npm install -g disputatio` → `disputatio`):
//
//   1. resolveConfigText — the runtime config lookup. ONE canonical user config,
//      `~/.config/disputatio/config.yaml`, read identically in both modes. The shipped
//      `examples/debate.yaml` is a copy-me TEMPLATE, never auto-loaded (that coupling was
//      the P2 footgun: its host-specific `bin:` broke no-config runs on other machines).
//
//   2. runInit (`disputatio --init`) — probe the lineup, resolve each CLI's real binary
//      (the stale-asdf-shim dance), and WRITE that user config. Explicit command, not an
//      npm postinstall hook: it canaries, so it needs the CLIs authenticated first.

import { readFile, writeFile, copyFile, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runIsolated } from "./debate.ts";
import { CANARY_PROMPT, CANARY_TIMEOUT_MS } from "./doctor.ts";
import { parseDebateConfig, serializeDebateConfig, type ParticipantSpec, type DebateConfig } from "./config.ts";
import type { Participant } from "./adapters.ts";

const execFileAsync = promisify(execFile);

// XDG-aware canonical config home. Both run modes read/write the SAME file, so the
// installed binary and a source checkout never disagree on which config is live.
export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "disputatio", "config.yaml");
}

// Runtime config resolution, in precedence order:
//   1. explicit --config <path>  → read it; a missing file HARD-FAILS (caller's choice).
//   2. ~/.config/disputatio/config.yaml exists → read it.
//   3. neither → text:null, meaning "use the built-in lineup" (claude + codex, no judge).
// ENOENT on step 2 is the only swallowed error: a malformed/unreadable user config still
// surfaces (parse throws downstream, or a non-ENOENT fs error rethrows here).
export async function resolveConfigText(
  configArg: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ text: string | null; source: string }> {
  if (configArg) return { text: await readFile(configArg, "utf8"), source: configArg };
  const userPath = userConfigPath(env);
  try {
    return { text: await readFile(userPath, "utf8"), source: userPath };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { text: null, source: "built-in lineup (no config)" };
  }
}

// --- binary resolution ---------------------------------------------------------------

export type BinResolution = { ok: boolean; bin?: string; tried: string[] };

// Find the binary that actually works. Try `defaultBin` (PATH) first; if its canary
// fails, try each alternative in order. PIN (return `bin`) ONLY when a non-default
// candidate is the one that worked — a working PATH binary needs no override, so the
// generated config stays minimal and as portable as the machine allows. The canary is
// the full adapter round-trip, not `--version`: the codex 0.1.x stale shim is runnable
// and reports its version, but the repo is version-agnostic by design, so the only
// honest test of "is this the right binary" is whether it answers the real canary.
export async function resolveBinary(
  defaultBin: string,
  alternatives: string[],
  canary: (bin: string) => Promise<boolean>,
): Promise<BinResolution> {
  const tried = [defaultBin];
  if (await canary(defaultBin)) return { ok: true, tried };
  for (const alt of alternatives) {
    if (alt === defaultBin) continue;
    tried.push(alt);
    if (await canary(alt)) return { ok: true, bin: alt, tried };
  }
  return { ok: false, tried };
}

// Candidate binaries to fall back to when the PATH one fails: everything `which -a`
// knows about, plus the usual Homebrew/local locations (where the real codex hides
// behind a stale asdf shim on this machine). Best-effort: a missing `which` or dir
// just yields fewer candidates.
const KNOWN_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
export async function findAlternatives(bin: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const { stdout } = await execFileAsync("which", ["-a", bin]);
    for (const line of stdout.split("\n")) { const p = line.trim(); if (p) found.push(p); }
  } catch { /* `which` absent or no match — fall through to known dirs */ }
  for (const dir of KNOWN_BIN_DIRS) {
    const p = join(dir, bin);
    try { await access(p); found.push(p); } catch { /* not here */ }
  }
  return [...new Set(found)];
}

// --- init orchestration --------------------------------------------------------------

// Adapters that honor a `bin:` override can be repointed when a stale shim shadows
// the real install; other adapters can canary PATH but cannot be repointed.
const BIN_OVERRIDABLE = new Set<string>(["codex", "pi", "copilot-cli"]);
const DEFAULT_BIN = new Map<string, string>([["copilot-cli", "copilot"]]);

export type InitDeps = {
  // Inject the lineup factory (it lives in index.ts, the composition root) so install.ts
  // doesn't import index.ts. Tests pass a factory returning stub participants.
  buildParticipant: (spec: ParticipantSpec, timeoutMs: number) => Participant;
  canary?: (p: Participant) => Promise<boolean>;
  findAlternatives?: (bin: string) => Promise<string[]>;
};

const defaultCanary = async (p: Participant): Promise<boolean> => (await runIsolated(p, CANARY_PROMPT)).result.ok;

export type InitResult = { exitCode: number; configPath: string; serialized: string; report: string };

// Probe each participant, resolve its working binary, seed the judge, and write the
// user config. Returns the artifact + a human report; exit 1 if any participant has no
// working binary (doctor remains the auth/health gate, but a lineup with a dead CLI
// should not be written as "ready").
export async function runInit(
  specs: ParticipantSpec[],
  judge: ParticipantSpec | undefined,
  configPath: string,
  opts: { force?: boolean; deps: InitDeps },
): Promise<InitResult> {
  const canary = opts.deps.canary ?? defaultCanary;
  const findAlts = opts.deps.findAlternatives ?? findAlternatives;
  const build = opts.deps.buildParticipant;

  const lines: string[] = [];
  const resolved: ParticipantSpec[] = [];
  let allOk = true;

  for (const spec of specs) {
    const overridable = BIN_OVERRIDABLE.has(spec.adapter);
    const defaultBin = spec.bin ?? DEFAULT_BIN.get(spec.adapter) ?? spec.adapter;
    const probe = (bin: string) => canary(build({ ...spec, bin }, CANARY_TIMEOUT_MS));
    const alts = overridable ? await findAlts(defaultBin) : [];
    const res = await resolveBinary(defaultBin, alts, probe);

    // Pin an auto-detected alt; otherwise preserve any bin the caller already set.
    const out: ParticipantSpec = { ...spec };
    const pinned = res.bin ?? spec.bin;
    if (pinned) out.bin = pinned; else delete out.bin;
    resolved.push(out);

    if (!res.ok) {
      allOk = false;
      lines.push(`  ✗ ${spec.adapter}: no working binary (tried ${res.tried.join(", ")})`);
    } else if (res.bin) {
      lines.push(`  ✓ ${spec.adapter}: pinned bin ${res.bin} (PATH binary failed)`);
    } else {
      lines.push(`  ✓ ${spec.adapter}: ${defaultBin} (on PATH)`);
    }
  }

  const cfg: DebateConfig = { participants: resolved };
  if (judge) cfg.judge = judge;
  const serialized = serializeDebateConfig(cfg);

  if (allOk) {
    await mkdir(dirname(configPath), { recursive: true });
    // Never clobber silently: back up an existing config unless --force.
    if (!opts.force) {
      try { await access(configPath); await copyFile(configPath, `${configPath}.bak`); lines.push(`  backed up existing config → ${configPath}.bak`); }
      catch { /* nothing to back up */ }
    }
    await writeFile(configPath, serialized, "utf8");
    lines.push(`  wrote ${configPath}${judge ? " (judge seeded)" : ""}`);
  } else {
    lines.push(`  not written — authenticate the failing CLI(s) and re-run`);
  }

  const report = [`disputatio init — ${specs.length} participant(s)`, ...lines].join("\n");
  return { exitCode: allOk ? 0 : 1, configPath, serialized, report };
}

// Re-exported so index.ts can parse a probed --config basis without importing config.ts twice.
export { parseDebateConfig };
