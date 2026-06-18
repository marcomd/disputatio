// Quaestio input resolution — where the question under debate comes from. Pure (no fs)
// so it is unit-testable: index.ts does the actual readFile. The quaestio is given
// INLINE by default (the sole positional IS the question); --file <path> reads it from a
// markdown file instead. rounds/repo are named flags (--rounds/--repo), NOT positionals,
// so the quaestio source is the only thing to disambiguate here — no positional juggling.

export type QuaestioInput =
  | { ok: true; source: "file"; path: string }
  | { ok: true; source: "inline"; text: string }
  | { ok: false; error: string };

export function resolveQuaestioInput(
  filePath: string | undefined,
  positionals: string[],
): QuaestioInput {
  if (filePath !== undefined) {
    if (positionals.length > 0)
      return { ok: false, error: "pass the quaestio inline OR with --file, not both" };
    return { ok: true, source: "file", path: filePath };
  }
  if (positionals.length === 0) return { ok: false, error: "no quaestio given" };
  if (positionals.length > 1)
    return {
      ok: false,
      error: `unexpected extra arguments — did you forget to quote the quaestio? (${positionals.join(" ")})`,
    };
  return { ok: true, source: "inline", text: positionals[0] };
}
