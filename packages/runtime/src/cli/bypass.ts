/**
 * Detectarea accesului care ocoleste capability broker-ul.
 *
 * Pe motorul de bootstrap, brokerul este **consultativ**: `import fs from
 * "node:fs"` ajunge la disc fara sa treaca pe la el. Izolarea reala apartine
 * host-ului nativ, unde `node:*` pur si simplu nu exista.
 *
 * Pana atunci, regula traieste aici, o singura data, ca `doctor` si `run` sa
 * spuna acelasi lucru.
 *
 * **Sunt DOUA feluri de probleme, si al doilea a fost invatat pe pielea
 * noastra.** Prima trecere de audit a inchis ocolul vizibil - un `import` de
 * `node:fs` pe care graful static il vede. A doua trecere a aratat ca gate-ul
 * se ocoleste banal:
 *
 * ```js
 * const nume = ["node", "fs"].join(":");
 * const fs = await import(nume);      // graful nu vede niciun `node:`
 * ```
 *
 * Specificatorul calculat nu apare in `hostImports`, deci aplicatia rula in
 * politica `production` cu manifestul gol si citea orice. `doctor` il raporta
 * (ca eroare!), `run` nu se uita la el.
 *
 * De aceea contractul de aici nu mai e „lista de ocoluri", ci „ce **stiu** si ce
 * **nu pot sti**". Un import pe care nu-l pot rezolva nu e o dovada ca totul e
 * in regula; e absenta unei dovezi, si in regim strict absenta dovezii nu e
 * suficienta.
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

/** Ceva ce nu putem verifica static - deci nici nu putem declara in regula. */
export interface Unverifiable {
  readonly from: string;
  readonly what: string;
  readonly message: string;
}

export interface BypassReport {
  /** Ocoluri dovedite: importuri `node:` vizibile in graf. */
  readonly bypasses: readonly BypassFinding[];
  /** Locuri in care nu putem demonstra ca NU exista un ocol. */
  readonly unverifiable: readonly Unverifiable[];
  /** Graful nu a putut fi construit deloc; mesajul spune de ce. */
  readonly graphError: string | null;
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
 * Ce se stie despre ocoluri in graful static al aplicatiei.
 *
 * Nu inghite erori: daca graful nu poate fi construit, asta intra in raport ca
 * `graphError`, si apelantul decide. Un `catch` care intorcea o lista goala
 * spunea „n-am gasit nimic" cand adevarul era „n-am putut sa ma uit".
 */
export async function inspectBypasses(projectRoot: string, entry: string): Promise<BypassReport> {
  try {
    const graph = await buildStaticGraph(projectRoot, entry);
    return {
      bypasses: graph.hostImports.filter(isBypass).map(describeBypass),
      unverifiable: graph.unresolved.map((problem) => ({
        from: problem.from,
        what: problem.specifier,
        message: `${problem.from}: ${problem.specifier} - ${problem.reason}`,
      })),
      graphError: null,
    };
  } catch (error) {
    return { bypasses: [], unverifiable: [], graphError: (error as Error).message };
  }
}

/**
 * Ce face `run` cu ce a aflat, in functie de politica.
 *
 * In `production` refuzam si ocolul dovedit, si imposibilitatea de a verifica:
 * intreg rostul regimului strict e ca nimic nu trece nedeclarat, iar un import
 * pe care nu-l putem citi e exact un acces nedeclarat care ar putea reusi.
 * In `development` mergem inainte, dar spunem ce am vazut - altfel portarea ar
 * fi imposibila inainte ca host-ul nativ sa fie gata.
 */
export function bypassSeverity(policy: PolicyMode): "error" | "warn" {
  return policy === "production" ? "error" : "warn";
}

/** Toate motivele pentru care politica `production` ar opri pornirea. */
export function blockingReasons(report: BypassReport): readonly string[] {
  const reasons = report.bypasses.map((bypass) => bypass.message);
  for (const item of report.unverifiable) {
    reasons.push(`${item.message} - nu pot demonstra ca nu ocoleste brokerul`);
  }
  if (report.graphError !== null) {
    reasons.push(`graful static nu a putut fi construit: ${report.graphError}`);
  }
  return reasons;
}
