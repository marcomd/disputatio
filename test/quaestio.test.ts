// Quaestio input resolution — inline-by-default, --file to read from disk.
// rounds/repo are named flags now, so the quaestio is the ONLY positional and the
// resolver just picks the source + rejects ambiguous/missing/extra input.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveQuaestioInput } from "../src/quaestio.ts";

test("inline is the default: the sole positional IS the quaestio", () => {
  assert.deepEqual(resolveQuaestioInput(undefined, ["Review this branch."]), {
    ok: true,
    source: "inline",
    text: "Review this branch.",
  });
});

test("--file selects the file source (no positional)", () => {
  assert.deepEqual(resolveQuaestioInput("task.md", []), {
    ok: true,
    source: "file",
    path: "task.md",
  });
});

test("no quaestio at all → not ok", () => {
  const r = resolveQuaestioInput(undefined, []);
  assert.equal(r.ok, false);
});

test("both --file and an inline positional → conflict, not ok", () => {
  const r = resolveQuaestioInput("task.md", ["Review this branch."]);
  assert.equal(r.ok, false);
});

test("extra positionals (likely an unquoted prompt) → not ok", () => {
  const r = resolveQuaestioInput(undefined, ["Review", "this", "branch"]);
  assert.equal(r.ok, false);
});
