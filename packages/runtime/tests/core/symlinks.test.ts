/**
 * Regresie pentru auditul din 2026-09-24 (S6): continerea de cai era pur
 * lexicala, deci o legatura simbolica asezata in domeniul acordat scotea accesul
 * in afara lui.
 *
 * Testele construiesc legaturi REALE pe disc. Pe Windows, un symlink obisnuit
 * cere Developer Mode sau drepturi ridicate, dar o **jonctiune** de director nu
 * cere nimic si e rezolvata de `realpath` la fel - deci cazul principal (un
 * DIRECTOR legat, inauntrul domeniului acordat) se verifica peste tot. Legatura
 * catre un fisier ramane conditionata, iar cand nu se poate face, testul ei se
 * sare cu un motiv scris. Un test de securitate care raporteaza verde pentru ca
 * n-a putut construi atacul e mai rau decat niciunul.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containsPath,
  containsPathReal,
  createBroker,
  createFiles,
  createObserver,
  createTaskFabric,
  normalizePath,
  realPath,
} from "../../src/core/index.ts";
import type { CapabilityDeclarations, HostContext, RuntimeManifest } from "../../src/core/index.ts";

interface Teren {
  /** Radacina proiectului: `<tmp>/proiect`. */
  readonly root: string;
  /** In afara proiectului: `<tmp>/secrete/parola.txt`. */
  readonly secretPath: string;
  /** `true` daca s-a putut face si o legatura catre un FISIER, nu doar un director. */
  readonly hasFileLink: boolean;
  dispose(): void;
}

/**
 * `<tmp>/proiect/date/spre-secrete` -> `<tmp>/secrete`.
 *
 * Adica exact situatia reala: o legatura care arata inofensiv, asezata inauntrul
 * unui director pe care aplicatia chiar are voie sa-l citeasca.
 */
function teren(): Teren | null {
  const base = mkdtempSync(join(tmpdir(), "raptor-link-"));
  const root = join(base, "proiect");
  const secrete = join(base, "secrete");
  mkdirSync(join(root, "date"), { recursive: true });
  mkdirSync(secrete);
  writeFileSync(join(secrete, "parola.txt"), "hunter2\n");
  writeFileSync(join(root, "date", "cuminte.txt"), "date obisnuite\n");

  // Directorul legat: symlink unde se poate, jonctiune unde nu (Windows).
  let director = false;
  for (const kind of ["dir", "junction"] as const) {
    try {
      symlinkSync(secrete, join(root, "date", "spre-secrete"), kind);
      director = true;
      break;
    } catch {
      /* incercam urmatorul fel */
    }
  }
  if (!director) {
    rmSync(base, { recursive: true, force: true });
    return null;
  }

  let hasFileLink = false;
  try {
    symlinkSync(join(secrete, "parola.txt"), join(root, "date", "spre-parola"), "file");
    hasFileLink = true;
  } catch {
    /* pe Windows fara Developer Mode; cazul de director e deja acoperit */
  }

  return {
    root: normalizePath(root),
    secretPath: normalizePath(join(secrete, "parola.txt")),
    hasFileLink,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

const FARA_LEGATURI = "nu pot crea nicio legatura de director aici";
const FARA_LEGATURA_DE_FISIER =
  "nu pot crea o legatura catre un fisier aici (pe Windows cere Developer Mode); cazul de director e acoperit separat";

function harness(root: string, declarations: CapabilityDeclarations): { host: HostContext; dispose(): void } {
  const observer = createObserver({ now: () => 0 });
  const manifest: RuntimeManifest = {
    name: "link",
    version: "0.0.0",
    entry: "./main.ts",
    policy: "production",
    engines: { raptorRuntime: "*" },
    capabilities: declarations,
    dependencies: [],
    tasks: { maxConcurrent: 4, defaultDeadlineMs: null },
  };
  const broker = createBroker({ projectRoot: root, declarations, policy: "production", observer, strict: true });
  const tasks = createTaskFabric({ observer });
  return {
    host: { manifest, broker, observer, tasks, projectRoot: root, args: [] },
    dispose: () => void tasks.shutdown(),
  };
}

/* ------------------------------------------------------ functiile de baza -- */

test("S6: containsPath ramane lexical, containsPathReal urmareste legatura", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    const prinLegatura = `${t0.root}/date/spre-secrete/parola.txt`;

    // Lexical, calea chiar e sub radacina - de aici venea gaura.
    assert.equal(containsPath(t0.root, prinLegatura), true, "lexical pare inauntru");
    // Real, duce in alta parte.
    assert.equal(containsPathReal(t0.root, prinLegatura), false, "dar ajunge in afara domeniului");

    // Un fisier obisnuit din acelasi director nu e afectat.
    assert.equal(containsPathReal(t0.root, `${t0.root}/date/cuminte.txt`), true);
  } finally {
    t0.dispose();
  }
});

test("S6: realPath rezolva si o cale care nu exista inca, prin parintele ei", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    // Fisierul nu exista; directorul-parinte e o legatura. O scriere ar ajunge
    // totusi dincolo de ea, deci verificarea trebuie sa vada asta dinainte.
    const viitor = `${t0.root}/date/spre-secrete/nou.txt`;
    assert.equal(realPath(viitor).endsWith("/secrete/nou.txt"), true, realPath(viitor));
    assert.equal(containsPathReal(t0.root, viitor), false);
  } finally {
    t0.dispose();
  }
});

test("S6: o cale in care nimic nu exista ramane la forma lexicala", () => {
  const inexistent = normalizePath(join(tmpdir(), "raptor-nu-exista-nicaieri", "a", "b.txt"));
  assert.equal(realPath(inexistent), inexistent, "fara nimic pe disc, raspunsul lexical e tot ce avem");
});

/* ---------------------------------------------------------------- brokerul -- */

test("S6: brokerul refuza o citire care trece printr-o legatura catre afara", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const broker = context.host.broker;

    // Ce are voie: un fisier obisnuit din `./date`.
    assert.equal(broker.check("files.read", "./date/cuminte.txt").granted, true);

    // Ce nu are voie: acelasi fisier, dar prin directorul legat.
    assert.equal(
      broker.check("files.read", "./date/spre-secrete/parola.txt").granted,
      false,
      "o legatura nu extinde domeniul acordat",
    );

    if (t0.hasFileLink) {
      assert.equal(broker.check("files.read", "./date/spre-parola").granted, false);
    }
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: refuzul spune si unde ajungea de fapt calea", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const decision = context.host.broker.check("files.read", "./date/spre-secrete/parola.txt");
    assert.equal(decision.granted, false);
    // Un jurnal care arata doar `./date/spre-secrete/parola.txt` induce in eroare
    // pe cine il citeste ca sa afle ce s-a incercat.
    assert.equal(decision.resolved, t0.secretPath, `resolved=${decision.resolved}`);

    // Iar pentru o cale fara legaturi nu umplem diagnosticul cu repetari.
    assert.equal(context.host.broker.check("files.read", "./date/cuminte.txt").resolved, null);
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: o legatura CATRE INTERIORUL domeniului ramane permisa", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    // Reparatia nu are voie sa devina "orice legatura e suspecta": una care
    // ramane in domeniu e o cale obisnuita.
    let scurtatura = false;
    for (const kind of ["dir", "junction"] as const) {
      try {
        symlinkSync(join(t0.root, "date"), join(t0.root, "scurtatura"), kind);
        scurtatura = true;
        break;
      } catch {
        /* incercam urmatorul fel */
      }
    }
    if (!scurtatura) return t.skip(FARA_LEGATURI);

    const context = harness(t0.root, { "files.read": ["."] });
    try {
      assert.equal(context.host.broker.check("files.read", "./scurtatura/cuminte.txt").granted, true);
    } finally {
      context.dispose();
    }
  } finally {
    t0.dispose();
  }
});

/* ------------------------------------------------------------- pe modulul -- */

test("S6: raptor:files refuza citirea prin legatura, desi fisierul exista", async (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const files = createFiles(context.host);

    // Proba care face refuzul sa insemne ceva: fisierul CHIAR poate fi citit
    // altfel, deci daca verificarea n-ar functiona, citirea ar reusi.
    assert.equal((await files.readText("./date/cuminte.txt")).trim(), "date obisnuite");

    await assert.rejects(
      files.readText("./date/spre-secrete/parola.txt"),
      (error: unknown) => (error as { capability?: string }).capability === "files.read",
      "legatura exista si tinta ei exista - refuzul vine din domeniu, nu din absenta",
    );

    if (t0.hasFileLink) {
      await assert.rejects(files.readText("./date/spre-parola"), (error: unknown) =>
        Boolean((error as { capability?: string }).capability === "files.read"),
      );
    }
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: raptor:files refuza si scrierea printr-un director legat", async (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.write": ["./date"] });
  try {
    const files = createFiles(context.host);
    await assert.rejects(
      files.write("./date/spre-secrete/plantat.txt", "nu ar trebui sa ajunga aici"),
      (error: unknown) => (error as { capability?: string }).capability === "files.write",
      "scrierea se verifica inainte de `open`, cu parintele rezolvat",
    );
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: legatura catre un FISIER (unde sistemul o permite)", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    if (!t0.hasFileLink) return t.skip(FARA_LEGATURA_DE_FISIER);
    assert.equal(containsPathReal(t0.root, `${t0.root}/date/spre-parola`), false);
    assert.equal(realPath(`${t0.root}/date/spre-parola`), t0.secretPath);
  } finally {
    t0.dispose();
  }
});
