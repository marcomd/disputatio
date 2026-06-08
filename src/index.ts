// CLI entry (Kaizen v0). Run with: node src/index.ts <task-file.md> [rounds] [repo-path]

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { claudeAdapter, agyAdapter } from "./adapters.ts";
import { runDebate } from "./debate.ts";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
  console.error("usage: disputatio <task-file.md> [rounds=1] [repo-path]");
  console.error("  task-file  markdown file describing the task/quaestio");
  console.error("  rounds     number of reaction rounds after proposals (default 1)");
  console.error("  repo-path  optional: run agents in this repo so they can gather read-only evidence");
  process.exit(args.length === 0 ? 1 : 0);
}

const [taskFile, roundsArg, repoPath] = args;
const task = await readFile(taskFile, "utf8");
const rounds = Number(roundsArg ?? "1");

// Cross-vendor by design: claude -> Anthropic, agy -> Google. Diversity is the point.
const participants = [claudeAdapter("sonnet"), agyAdapter("Gemini 3.5 Flash (High)")];

const vendors = new Set(participants.map((p) => p.vendor));
if (vendors.size < participants.length) {
  console.error("[disputatio] ⚠️ participants are not all cross-vendor — correlated-error risk (2_CONCEPT.md §2)");
}

const out = await runDebate(task, participants, rounds, repoPath);

const id = `debate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dir = `.debate/${id}`;
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/debate.md`, out, "utf8");

console.error(`[disputatio] done`);
console.log(`${dir}/debate.md`); // stdout = the artifact path (agent-native friendly)
