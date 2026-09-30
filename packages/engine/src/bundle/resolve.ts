/**
 * Specifier resolution delegated to the Node resolver (createRequire): it correctly
 * handles both relative imports with an explicit extension (`./x.ts`) and bare
 * specifiers backed by an exports map (`@raptor/dom`, `@raptor/dom/jsx-runtime`),
 * including `.ts` targets (the @raptor/* packages expose their source directly in `exports`).
 *
 * Returns `null` for node: builtins and for anything that does not resolve to a
 * file (those requires stay external and are left untouched in the output).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BUNDLEABLE = /\.(tsx?|jsx?|mjs|cjs)$/;

/** Resolves `spec` from `importerFile` to a bundleable absolute path, or null. */
export function resolveSpecifier(spec: string, importerFile: string): string | null {
  if (spec.startsWith("node:")) return null;
  try {
    const req = createRequire(pathToFileURL(importerFile));
    const resolved = req.resolve(spec);
    // Only real source files go into the bundle; everything else stays external.
    return BUNDLEABLE.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
