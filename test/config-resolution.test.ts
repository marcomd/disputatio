// Config resolution tests — the 3-step precedence behind a no-`--config` run, and the
// XDG-aware user config path. This is the P2 regression guard: a bare run on a foreign
// machine must NOT auto-load the host-specific examples/debate.yaml; it must fall through
// to the built-in lineup (text:null).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userConfigPath, resolveConfigText } from "../src/install.ts";
import { parseDebateConfig } from "../src/config.ts";

test("userConfigPath honors XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(
    userConfigPath({ XDG_CONFIG_HOME: "/x/cfg" }),
    join("/x/cfg", "disputatio", "config.yaml"),
  );
  const home = userConfigPath({ HOME: "/home/u" } as NodeJS.ProcessEnv);
  assert.match(home, /[/\\]\.config[/\\]disputatio[/\\]config\.yaml$/);
});

test("no --config + no user config → built-in lineup (text:null) — the P2 guard", async () => {
  const xdg = await mkdtemp(join(tmpdir(), "disputatio-xdg-"));
  try {
    const { text, source } = await resolveConfigText(undefined, { XDG_CONFIG_HOME: xdg });
    assert.equal(text, null); // → index.ts uses DEFAULT_SPECS, no /opt/homebrew assumption
    assert.match(source, /built-in/);
  } finally {
    await rm(xdg, { recursive: true, force: true });
  }
});

test("no --config but user config present → loads it", async () => {
  const xdg = await mkdtemp(join(tmpdir(), "disputatio-xdg-"));
  try {
    await mkdir(join(xdg, "disputatio"), { recursive: true });
    await writeFile(join(xdg, "disputatio", "config.yaml"), "participants:\n  - adapter: claude\n  - adapter: codex\n");
    const { text, source } = await resolveConfigText(undefined, { XDG_CONFIG_HOME: xdg });
    assert.ok(text && text.includes("adapter: claude"));
    assert.equal(source, join(xdg, "disputatio", "config.yaml"));
    assert.equal(parseDebateConfig(text!).participants?.length, 2);
  } finally {
    await rm(xdg, { recursive: true, force: true });
  }
});

test("explicit --config that does not exist → hard-fails (does not silently fall back)", async () => {
  await assert.rejects(() => resolveConfigText(join(tmpdir(), "does-not-exist-xyz.yaml"), {}));
});

test("a malformed user config still surfaces (parse throws downstream, not swallowed)", async () => {
  const xdg = await mkdtemp(join(tmpdir(), "disputatio-xdg-"));
  try {
    await mkdir(join(xdg, "disputatio"), { recursive: true });
    await writeFile(join(xdg, "disputatio", "config.yaml"), "participants:\n  - adapter: bogus\n  - adapter: codex\n");
    const { text } = await resolveConfigText(undefined, { XDG_CONFIG_HOME: xdg });
    assert.ok(text !== null); // resolution returns the text...
    assert.throws(() => parseDebateConfig(text!)); // ...and the bad adapter fails at parse, not here
  } finally {
    await rm(xdg, { recursive: true, force: true });
  }
});
