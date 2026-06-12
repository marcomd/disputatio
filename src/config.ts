// Debate config (Kaizen v0): `--config debate.yaml` selects the participant
// lineup so each run can choose adapters that match the target repository policy.
//
// This parses a deliberately MINIMAL YAML subset — flat top-level scalars plus
// one `participants:` list of flat maps — with strict, line-numbered errors.
// No dependency, no build step (the repo's standing rule). When config needs
// real YAML (nesting, anchors), switch to a parser library; do not grow this.

export type AdapterId = "claude" | "agy" | "codex";

export type ParticipantSpec = {
  adapter: AdapterId;
  model?: string;        // omit = the adapter's default (codex: the account default)
  bin?: string;          // override the binary path (e.g. a shadowed codex install)
  maxBudgetUsd?: number; // claude only
};

export type DebateConfig = {
  rounds?: number;
  repo?: string;
  timeoutMinutes?: number;
  participants?: ParticipantSpec[];
};

const ADAPTERS = new Set<string>(["claude", "agy", "codex"]);
const TOP_KEYS = new Set<string>(["rounds", "repo", "timeoutMinutes", "participants"]);
const PARTICIPANT_KEYS = new Set<string>(["adapter", "model", "bin", "maxBudgetUsd"]);
const NUMERIC_KEYS = new Set<string>(["rounds", "timeoutMinutes", "maxBudgetUsd"]);

function fail(lineNo: number, msg: string): never {
  throw new Error(`debate config line ${lineNo}: ${msg}`);
}

function scalar(raw: string, key: string, lineNo: number): string | number {
  let v = raw.trim();
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) v = v.slice(1, -1);
  if (v === "") fail(lineNo, `key "${key}" has no value`);
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(lineNo, `key "${key}" must be a number, got "${v}"`);
    return n;
  }
  return v;
}

export function parseDebateConfig(text: string): DebateConfig {
  const cfg: DebateConfig = {};
  let participants: Record<string, string | number>[] | null = null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const noComment = lines[i].replace(/(^|\s)#.*$/, ""); // strip full-line & trailing comments
    if (noComment.trim() === "") continue;

    const top = noComment.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);          // key: value (indent 0)
    const item = noComment.match(/^\s+-\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);  //   - key: value
    const cont = noComment.match(/^\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);      //     key: value

    if (top) {
      const [, key, rest] = top;
      if (!TOP_KEYS.has(key)) fail(lineNo, `unknown key "${key}" (known: ${[...TOP_KEYS].join(", ")})`);
      if (key === "participants") {
        if (rest.trim() !== "") fail(lineNo, `"participants" must be a list (put items on the following lines)`);
        participants = [];
      } else {
        (cfg as Record<string, unknown>)[key] = scalar(rest, key, lineNo);
        participants = null; // a new top-level key ends the participants block
      }
    } else if (item && participants) {
      const [, key, rest] = item;
      if (!PARTICIPANT_KEYS.has(key)) fail(lineNo, `unknown participant key "${key}" (known: ${[...PARTICIPANT_KEYS].join(", ")})`);
      participants.push({ [key]: scalar(rest, key, lineNo) });
    } else if (cont && participants) {
      const [, key, rest] = cont;
      if (!PARTICIPANT_KEYS.has(key)) fail(lineNo, `unknown participant key "${key}" (known: ${[...PARTICIPANT_KEYS].join(", ")})`);
      const current = participants[participants.length - 1];
      if (!current) fail(lineNo, `participant field before any "- " list item`);
      if (key in current) fail(lineNo, `duplicate participant key "${key}"`);
      current[key] = scalar(rest, key, lineNo);
    } else {
      fail(lineNo, `cannot parse "${lines[i].trim()}" (this parser supports only flat "key: value" and a participants list)`);
    }
  }

  if (participants) {
    for (const p of participants) {
      if (typeof p.adapter !== "string" || !ADAPTERS.has(p.adapter)) {
        throw new Error(`debate config: each participant needs "adapter: claude | agy | codex" (got ${JSON.stringify(p)})`);
      }
    }
    if (participants.length < 2) {
      throw new Error(`debate config: a debate needs at least 2 participants (got ${participants.length})`);
    }
    cfg.participants = participants as ParticipantSpec[];
  }
  if (cfg.rounds !== undefined && (!Number.isInteger(cfg.rounds) || cfg.rounds < 0)) {
    throw new Error(`debate config: "rounds" must be a non-negative integer`);
  }
  return cfg;
}
