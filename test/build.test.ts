// Build/distribution guard. A real `npm install -g disputatio@0.2.0` crashed because the
// bin was a `.ts` file — Node refuses to type-strip TypeScript under node_modules. The fix
// ships a bundled `.js` bin. Then a SECOND bug: a shebang in src + a `--banner:js` shebang
// produced TWO `#!` lines, and the line-2 one is a syntax error. This test guards both:
// the published bin must be runnable JS with exactly one shebang, on line 1.
//
// Depends on esbuild (a devDependency), so it SKIPS on a zero-dep clone (`node --test`
// without `npm install`) and runs once dependencies are installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const esbuildPresent = await access(join(root, "node_modules/.bin/esbuild")).then(() => true, () => false);

test(
  "published bundle: JS bin with a single line-1 shebang that runs",
  { skip: esbuildPresent ? false : "esbuild not installed (zero-dep clone)" },
  async () => {
    await execFileAsync("npm", ["run", "build"], { cwd: root });
    const dist = join(root, "dist", "index.js");
    const lines = (await readFile(dist, "utf8")).split("\n");
    assert.equal(lines[0], "#!/usr/bin/env node", "line 1 must be the shebang");
    assert.ok(!lines.slice(1).some((l) => l.startsWith("#!")), "no second shebang (the double-shebang regression)");
    // The bin must actually load + run (the bundle, end to end). --help exits 0 to stderr.
    const r = await execFileAsync("node", [dist, "--help"]).catch((e: { stdout?: string; stderr?: string }) => e);
    assert.match((r.stderr ?? "") + (r.stdout ?? ""), /usage: disputatio/);
  },
);
