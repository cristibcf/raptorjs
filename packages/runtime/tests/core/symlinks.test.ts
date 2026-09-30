/**
 * Regression for the 2026-09-24 audit (S6): path containment was purely lexical,
 * so a symlink placed in the granted scope carried access outside it.
 *
 * The tests build REAL links on disk. On Windows, an ordinary symlink requires
 * Developer Mode or elevated rights, but a directory **junction** requires
 * nothing and is resolved by `realpath` the same way - so the main case (a
 * linked DIRECTORY, inside the granted scope) is checked everywhere. The link to
 * a file stays conditional, and when it cannot be made, its test is skipped with
 * a written reason. A security test that reports green because it could not build
 * the attack is worse than none.
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
  /** The project root: `<tmp>/proiect`. */
  readonly root: string;
  /** Outside the project: `<tmp>/secrete/parola.txt`. */
  readonly secretPath: string;
  /** `true` if a link to a FILE could also be made, not just a directory. */
  readonly hasFileLink: boolean;
  dispose(): void;
}

/**
 * `<tmp>/proiect/date/spre-secrete` -> `<tmp>/secrete`.
 *
 * That is exactly the real situation: a link that looks harmless, placed inside
 * a directory the application actually is allowed to read.
 */
function teren(): Teren | null {
  const base = mkdtempSync(join(tmpdir(), "raptor-link-"));
  const root = join(base, "proiect");
  const secrete = join(base, "secrete");
  mkdirSync(join(root, "date"), { recursive: true });
  mkdirSync(secrete);
  writeFileSync(join(secrete, "parola.txt"), "hunter2\n");
  writeFileSync(join(root, "date", "cuminte.txt"), "ordinary data\n");

  // The linked directory: symlink where possible, junction where not (Windows).
  let director = false;
  for (const kind of ["dir", "junction"] as const) {
    try {
      symlinkSync(secrete, join(root, "date", "spre-secrete"), kind);
      director = true;
      break;
    } catch {
      /* try the next kind */
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
    /* on Windows without Developer Mode; the directory case is already covered */
  }

  return {
    root: normalizePath(root),
    secretPath: normalizePath(join(secrete, "parola.txt")),
    hasFileLink,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

const FARA_LEGATURI = "cannot create any directory link here";
const FARA_LEGATURA_DE_FISIER =
  "cannot create a link to a file here (on Windows it requires Developer Mode); the directory case is covered separately";

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

/* ------------------------------------------------------ the base functions -- */

test("S6: containsPath stays lexical, containsPathReal follows the link", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    const prinLegatura = `${t0.root}/date/spre-secrete/parola.txt`;

    // Lexically, the path really is under the root - that is where the hole came from.
    assert.equal(containsPath(t0.root, prinLegatura), true, "lexically it looks inside");
    // Really, it leads elsewhere.
    assert.equal(containsPathReal(t0.root, prinLegatura), false, "but it lands outside the scope");

    // An ordinary file in the same directory is not affected.
    assert.equal(containsPathReal(t0.root, `${t0.root}/date/cuminte.txt`), true);
  } finally {
    t0.dispose();
  }
});

test("S6: realPath also resolves a path that does not exist yet, through its parent", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    // The file does not exist; the parent directory is a link. A write would
    // still land beyond it, so the check must see this in advance.
    const viitor = `${t0.root}/date/spre-secrete/nou.txt`;
    assert.equal(realPath(viitor).endsWith("/secrete/nou.txt"), true, realPath(viitor));
    assert.equal(containsPathReal(t0.root, viitor), false);
  } finally {
    t0.dispose();
  }
});

test("S6: a path where nothing exists stays in lexical form", () => {
  const inexistent = normalizePath(join(tmpdir(), "raptor-nu-exista-nicaieri", "a", "b.txt"));
  assert.equal(realPath(inexistent), inexistent, "with nothing on disk, the lexical answer is all we have");
});

/* ---------------------------------------------------------------- the broker -- */

test("S6: the broker denies a read that passes through a link to the outside", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const broker = context.host.broker;

    // What is allowed: an ordinary file from `./date`.
    assert.equal(broker.check("files.read", "./date/cuminte.txt").granted, true);

    // What is not allowed: the same file, but through the linked directory.
    assert.equal(
      broker.check("files.read", "./date/spre-secrete/parola.txt").granted,
      false,
      "a link does not extend the granted scope",
    );

    if (t0.hasFileLink) {
      assert.equal(broker.check("files.read", "./date/spre-parola").granted, false);
    }
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: the denial also says where the path actually landed", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const decision = context.host.broker.check("files.read", "./date/spre-secrete/parola.txt");
    assert.equal(decision.granted, false);
    // A log that shows only `./date/spre-secrete/parola.txt` misleads whoever
    // reads it to find out what was attempted.
    assert.equal(decision.resolved, t0.secretPath, `resolved=${decision.resolved}`);

    // And for a path without links we do not fill the diagnostics with repetitions.
    assert.equal(context.host.broker.check("files.read", "./date/cuminte.txt").resolved, null);
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: a link TO THE INSIDE of the scope stays allowed", (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  try {
    // The fix must not become "any link is suspicious": one that stays in the
    // scope is an ordinary path.
    let scurtatura = false;
    for (const kind of ["dir", "junction"] as const) {
      try {
        symlinkSync(join(t0.root, "date"), join(t0.root, "scurtatura"), kind);
        scurtatura = true;
        break;
      } catch {
        /* try the next kind */
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

/* ------------------------------------------------------------- on the module -- */

test("S6: raptor:files denies reading through the link, even though the file exists", async (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.read": ["./date"] });
  try {
    const files = createFiles(context.host);

    // The probe that makes the denial mean something: the file CAN actually be
    // read otherwise, so if the check did not work, the read would succeed.
    assert.equal((await files.readText("./date/cuminte.txt")).trim(), "ordinary data");

    await assert.rejects(
      files.readText("./date/spre-secrete/parola.txt"),
      (error: unknown) => (error as { capability?: string }).capability === "files.read",
      "the link exists and its target exists - the denial comes from the scope, not from absence",
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

test("S6: raptor:files also denies writing through a linked directory", async (t) => {
  const t0 = teren();
  if (!t0) return t.skip(FARA_LEGATURI);
  const context = harness(t0.root, { "files.write": ["./date"] });
  try {
    const files = createFiles(context.host);
    await assert.rejects(
      files.write("./date/spre-secrete/plantat.txt", "should not land here"),
      (error: unknown) => (error as { capability?: string }).capability === "files.write",
      "the write is checked before `open`, with the parent resolved",
    );
  } finally {
    context.dispose();
    t0.dispose();
  }
});

test("S6: a link to a FILE (where the system allows it)", (t) => {
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
