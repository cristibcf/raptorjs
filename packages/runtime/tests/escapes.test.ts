/**
 * Regresii pentru evadarile din modelul de capabilitati gasite la auditul din
 * 2026-09-24 (`AUDIT-2026-09-24.md`, S1-S2, S4, S8).
 *
 * Fiecare test de aici a fost intai un proof-of-concept care REUSEA. Sunt tinute
 * separat de `modules.test.ts` tocmai ca sa se vada ca nu verifica functionarea
 * unui modul, ci granita lui: ce refuza cand cineva incearca pe langa.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBroker,
  createNet,
  createObserver,
  createProcess,
  createServe,
  createTaskFabric,
  normalizePath,
} from "../src/index.ts";
import type { CapabilityDeclarations, HostContext, RuntimeManifest } from "../src/index.ts";

interface Harness {
  readonly host: HostContext;
  readonly root: string;
  dispose(): void;
}

function harness(declarations: CapabilityDeclarations = {}): Harness {
  const projectRoot = normalizePath(mkdtempSync(join(tmpdir(), "raptor-esc-")));
  const observer = createObserver({ now: () => 0 });
  const manifest: RuntimeManifest = {
    name: "harness",
    version: "0.0.0",
    entry: "./main.ts",
    policy: "production",
    engines: { raptorRuntime: "*" },
    capabilities: declarations,
    dependencies: [],
  };
  const broker = createBroker({ projectRoot, declarations, policy: "production", observer, strict: true });
  const tasks = createTaskFabric({ observer });
  const host: HostContext = { manifest, broker, observer, tasks, projectRoot, args: [] };
  return {
    host,
    root: projectRoot,
    dispose: () => {
      tasks.shutdown();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

const denied = (error: unknown): boolean => String((error as { code?: string }).code).startsWith("raptor:capability/");

/* ---------------------------------------------------------------- S1: spawn */

test("S1: spawn nu poate seta variabile pe care aplicatia nu are voie sa le citeasca", async () => {
  // Manifest care permite EXACT o comanda si nicio variabila de mediu.
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, { SECRET: "nu se vede" });
    assert.deepEqual(proc.envKeys(), [], "fara env.read, aplicatia nu vede niciun nume");

    await assert.rejects(
      proc.spawn("node", { args: ["-e", "0"], env: { ORICE: "valoare" } }),
      denied,
      "mediul cerut de apelant trece prin aceeasi poarta ca o citire",
    );
  } finally {
    context.dispose();
  }
});

test("S1: variabilele care incarca cod sunt refuzate chiar si cu env.read acordata", async () => {
  // Chiar si cu voie sa citeasca TOT mediul, aplicatia nu poate transforma
  // `process.spawn: ["node"]` in "orice cod" printr-un `--require`.
  const context = harness({ "process.spawn": ["node"], "env.read": ["*"] });
  try {
    const proc = createProcess(context.host, {});
    for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "GIT_SSH_COMMAND", "PATH"]) {
      await assert.rejects(
        proc.spawn("node", { args: ["-e", "0"], env: { [name]: "./payload.js" } }),
        (error: unknown) => denied(error) && String((error as Error).message).includes(name),
        `${name} incarca cod inainte de comanda`,
      );
    }
  } finally {
    context.dispose();
  }
});

test("S1: cwd in afara proiectului cere files.read pe acea cale", async () => {
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, {});
    const afara = normalizePath(join(tmpdir(), "raptor-esc-cwd-inexistent"));
    await assert.rejects(
      proc.spawn("node", { args: ["-e", "0"], cwd: afara }),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "files.read",
      "un cwd strain e acces la disc, nu un detaliu de pornire",
    );
  } finally {
    context.dispose();
  }
});

test("S1: mediul acordat explicit ajunge totusi la copil", async () => {
  // Reparatia nu are voie sa strice cazul legitim.
  const context = harness({ "process.spawn": ["node"], "env.read": ["RAPTOR_*"] });
  try {
    const proc = createProcess(context.host, {});
    const result = await proc.spawn("node", {
      args: ["-e", "process.stdout.write(String(process.env.RAPTOR_TINTA))"],
      env: { RAPTOR_TINTA: "ajunge" },
    });
    assert.equal(result.stdout, "ajunge");
    assert.equal(result.truncated, false);
  } finally {
    context.dispose();
  }
});

test("S8: iesirea unui copil vorbaret este plafonata, nu acumulata la infinit", async () => {
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, {});
    // 12 MB peste un plafon de 8 MB.
    const result = await proc.spawn("node", {
      args: ["-e", "const c='x'.repeat(1024*1024); for(let i=0;i<12;i++) process.stdout.write(c);"],
    });
    assert.equal(result.truncated, true, "apelantul afla ca vede o iesire taiata");
    assert.ok(result.stdout.length <= 8 * 1024 * 1024, `stdout a crescut la ${result.stdout.length}`);
  } finally {
    context.dispose();
  }
});

/* ------------------------------------------------------------ S2: redirect */

test("S2: un redirect nu poate duce fetch-ul pe o gazda refuzata", async () => {
  const intern = createServer((_request, response) => {
    response.writeHead(200);
    response.end("SECRET");
  });
  await new Promise<void>((resolve) => intern.listen(0, "127.0.0.1", resolve));
  const internPort = (intern.address() as { port: number }).port;

  const permis = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${internPort}/` });
    response.end();
  });
  await new Promise<void>((resolve) => permis.listen(0, "127.0.0.1", resolve));
  const permisPort = (permis.address() as { port: number }).port;

  const context = harness({ "net.connect": [`127.0.0.1:${permisPort}`] });
  try {
    const net = createNet(context.host);
    assert.equal(net.allows(`http://127.0.0.1:${internPort}/`), false, "gazda interna e refuzata direct");

    await assert.rejects(
      net.fetch(`http://127.0.0.1:${permisPort}/`),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "net.connect",
      "saltul de redirect trece prin broker, ca si primul",
    );
  } finally {
    context.dispose();
    intern.close();
    permis.close();
  }
});

test("S2: un redirect catre o gazda permisa este urmat normal", async () => {
  const tinta = createServer((_request, response) => {
    response.writeHead(200);
    response.end("ajuns");
  });
  await new Promise<void>((resolve) => tinta.listen(0, "127.0.0.1", resolve));
  const tintaPort = (tinta.address() as { port: number }).port;

  const plecare = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${tintaPort}/` });
    response.end();
  });
  await new Promise<void>((resolve) => plecare.listen(0, "127.0.0.1", resolve));
  const plecarePort = (plecare.address() as { port: number }).port;

  const context = harness({ "net.connect": [`127.0.0.1:${plecarePort}`, `127.0.0.1:${tintaPort}`] });
  try {
    const net = createNet(context.host);
    const response = await net.fetch(`http://127.0.0.1:${plecarePort}/`);
    assert.equal(await response.text(), "ajuns");
    assert.equal(response.status, 200);
  } finally {
    context.dispose();
    tinta.close();
    plecare.close();
  }
});

/* -------------------------------------------------------- S4: net.listen */

test("S4: serve nu poate deschide un port fara net.listen", async () => {
  const context = harness({});
  try {
    const serve = createServe(context.host);
    await assert.rejects(
      serve.serve({ port: 0, fetch: () => new Response("nu ar trebui") }),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "net.listen",
      "a deschide un port este o capability, nu o facilitate",
    );
  } finally {
    context.dispose();
  }
});

test("S4: net.listen se acorda pe gazda si port, nu global", async () => {
  const context = harness({ "net.listen": ["127.0.0.1:*"] });
  try {
    const serve = createServe(context.host);
    const server = await serve.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("viu") });
    try {
      assert.ok(server.port > 0);
    } finally {
      await server.close();
    }

    await assert.rejects(
      serve.serve({ port: 0, hostname: "0.0.0.0", fetch: () => new Response("nu") }),
      denied,
      "o regula pe loopback nu permite expunerea pe toate interfetele",
    );
  } finally {
    context.dispose();
  }
});
