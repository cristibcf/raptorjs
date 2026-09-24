/**
 * Rezolvare de specifiere delegata catre rezolverul Node (createRequire): trateaza
 * corect atat importurile relative cu extensie explicita (`./x.ts`) cat si
 * specifierele bare cu exports map (`@raptor/dom`, `@raptor/dom/jsx-runtime`),
 * inclusiv tinte `.ts` (pachetele @raptor/* isi expun sursa direct in `exports`).
 *
 * Intoarce `null` pentru builtin-uri node: si pentru orice nu se rezolva la un
 * fisier (acele require raman externe si sunt lasate neatinse in output).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BUNDLEABLE = /\.(tsx?|jsx?|mjs|cjs)$/;

/** Rezolva `spec` din `importerFile` la o cale absoluta bundle-abila, sau null. */
export function resolveSpecifier(spec: string, importerFile: string): string | null {
  if (spec.startsWith("node:")) return null;
  try {
    const req = createRequire(pathToFileURL(importerFile));
    const resolved = req.resolve(spec);
    // Doar fisiere sursa reale intra in bundle; orice altceva ramane extern.
    return BUNDLEABLE.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
