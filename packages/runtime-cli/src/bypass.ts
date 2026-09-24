/**
 * Detectarea importurilor care ocolesc capability broker-ul.
 *
 * Pe motorul de bootstrap, brokerul este **consultativ**: `import fs from
 * "node:fs"` ajunge la disc fara sa treaca pe la el. Izolarea reala apartine
 * host-ului nativ, unde `node:*` pur si simplu nu exista.
 *
 * Pana atunci, regula asta era stiuta doar de `doctor` - iar `run` pornea vesel
 * o aplicatie in politica `production` cu manifestul gol, scria in jurnalul de
 * audit "1 capability refuzata" si nu spunea nicaieri ca acelasi fisier fusese
 * citit pe cealalta cale. Un jurnal de audit care arata refuzul si nu arata
 * reusita e mai rau decat niciun jurnal (audit 2026-09-24, S5).
 *
 * Aici traieste regula, o singura data, ca ambele comenzi sa spuna acelasi
 * lucru.
 */
import { buildStaticGraph } from "@raptor/runtime";
import type { PolicyMode } from "@raptor/runtime";

export interface BypassFinding {
  /** Specificatorul importat, ex. `node:fs`. */
  readonly specifier: string;
  /** Echivalentul din spatiul `raptor:`, daca exista unul. */
  readonly replacement: string | null;
  readonly message: string;
}

/**
 * Ce modul `raptor:` acopera fiecare builtin folosit in practica.
 *
 * Lista e scurta si onesta: propunem un inlocuitor doar acolo unde chiar
 * exista unul. Pentru `node:worker_threads` nu scriem `raptor:tasks`, fiindca
 * `tasks` inca nu e legat la izolat in host-ul nativ.
 */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "node:fs": "raptor:files",
  "node:fs/promises": "raptor:files",
  "node:path": "raptor:files",
  "node:http": "raptor:serve",
  "node:https": "raptor:net",
  "node:net": "raptor:net",
  "node:child_process": "raptor:process",
  "node:process": "raptor:process",
  "node:os": "raptor:process",
};

/** `true` daca specificatorul ajunge la sistem fara sa treaca prin broker. */
export function isBypass(specifier: string): boolean {
  return specifier.startsWith("node:");
}

export function describeBypass(specifier: string): BypassFinding {
  const replacement = REPLACEMENTS[specifier] ?? null;
  const suffix = replacement === null ? "" : `; foloseste ${replacement}`;
  return {
    specifier,
    replacement,
    message: `${specifier} ocoleste capability broker-ul si nu va exista in host-ul nativ${suffix}`,
  };
}

/**
 * Importurile din graful static al aplicatiei care ocolesc brokerul.
 *
 * Intoarce o lista goala daca graful nu poate fi construit: absenta unei dovezi
 * nu e o dovada de absenta, iar comanda care ne-a chemat raporteaza separat
 * problema de graf.
 */
export async function findBypasses(projectRoot: string, entry: string): Promise<readonly BypassFinding[]> {
  const graph = await buildStaticGraph(projectRoot, entry);
  return graph.hostImports.filter(isBypass).map(describeBypass);
}

/**
 * Ce face `run` cu un ocol, in functie de politica.
 *
 * In `production` refuzam: intreg rostul regimului strict e ca nimic nu trece
 * nedeclarat, iar un ocol e tocmai un acces nedeclarat care reuseste. In
 * `development` mergem inainte, dar il spunem si il scriem in audit - altfel
 * dezvoltarea devine imposibila inainte ca host-ul nativ sa fie gata.
 */
export function bypassSeverity(policy: PolicyMode): "error" | "warn" {
  return policy === "production" ? "error" : "warn";
}
