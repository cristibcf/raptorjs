import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBroker,
  createFiles,
  createKv,
  createNet,
  createObserver,
  createProcess,
  createServe,
  createTaskFabric,
  destinationOf,
  normalizePath,
} from "../src/index.ts";
import type { CapabilityDeclarations, HostContext, RuntimeManifest } from "../src/index.ts";

interface Harness {
  readonly host: HostContext;
  dispose(): void;
}

/**
 * Modulele primesc un `HostContext`, niciodata handle-uri brute. Harness-ul de
 * aici construieste exact acel context, ca testele sa exercite drumul real prin
 * broker - nu o varianta ocolita.
 */
function harness(declarations: CapabilityDeclarations = {}, strict = true): Harness {
  const projectRoot = normalizePath(mkdtempSync(join(tmpdir(), "raptor-mod-")));
  const observer = createObserver({ now: () => 0 });
  const manifest: RuntimeManifest = {
    name: "harness",
    version: "0.0.0",
    entry: "./main.ts",
    policy: "development",
    engines: { raptorRuntime: "*" },
    capabilities: declarations,
    dependencies: [],
    tasks: { maxConcurrent: 8, defaultDeadlineMs: null },
  };
  const broker = createBroker({ declarations, projectRoot, strict, observer });
  const tasks = createTaskFabric({ maxConcurrent: 8, observer });
  const host: HostContext = { projectRoot, manifest, broker, observer, tasks, args: ["--flag"] };
  return {
    host,
    dispose: () => {
      void tasks.shutdown("test");
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

const denied = (error: unknown): boolean => String((error as { code?: string }).code).startsWith("raptor:capability/");

test("raptor:files refuza citirea nedeclarata si o permite pe cea declarata", async () => {
  const context = harness({ "files.read": ["./public"], "files.write": ["./public"] });
  try {
    const files = createFiles(context.host);
    await files.write("./public/nota.txt", "salut");
    assert.equal(await files.readText("./public/nota.txt"), "salut");
    await assert.rejects(files.readText("./privat/secret.txt"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:files nu poate iesi din domeniu prin traversare", async () => {
  const context = harness({ "files.read": ["./public"] });
  try {
    const files = createFiles(context.host);
    await assert.rejects(files.readText("./public/../../etc/passwd"), denied);
  } finally {
    context.dispose();
  }
});

test("scrierea este atomica: nu lasa fisiere partiale in urma", async () => {
  const context = harness({ "files.read": ["."], "files.write": ["."] });
  try {
    const files = createFiles(context.host);
    await files.write("./date.json", '{"a":1}');
    await files.write("./date.json", '{"a":2}');
    assert.equal(readFileSync(join(context.host.projectRoot, "date.json"), "utf8"), '{"a":2}');
    const remaining = await files.list(".");
    assert.deepEqual(
      remaining.filter((entry) => entry.name.includes(".partial")),
      [],
      "fisierul temporar dispare dupa rename",
    );
  } finally {
    context.dispose();
  }
});

test("raptor:files raporteaza existenta fara sa scurga continutul nedeclarat", async () => {
  const context = harness({ "files.read": ["./public"], "files.write": ["./public"] });
  try {
    const files = createFiles(context.host);
    await files.write("./public/a.txt", "x");
    assert.equal(await files.exists("./public/a.txt"), true);
    assert.equal(await files.exists("./public/lipsa.txt"), false);
    await assert.rejects(files.exists("./privat/a.txt"), denied);
  } finally {
    context.dispose();
  }
});

test("destinationOf normalizeaza gazda si portul implicit al schemei", () => {
  assert.equal(destinationOf("https://API.Example.com/cale?x=1"), "api.example.com:443");
  assert.equal(destinationOf("http://example.com"), "example.com:80");
  assert.equal(destinationOf("https://example.com:8443/x"), "example.com:8443");
  assert.throws(() => destinationOf("/doar-cale"), (error: unknown) => (error as { code: string }).code === "raptor:module/unsupported");
  assert.throws(() => destinationOf("file:///etc/passwd"), (error: unknown) => (error as { code: string }).code === "raptor:module/unsupported");
});

test("raptor:net verifica destinatia inainte sa deschida conexiunea", async () => {
  const context = harness({ "net.connect": ["api.example.com:443"] });
  try {
    const net = createNet(context.host);
    assert.equal(net.allows("https://api.example.com/v1"), true);
    assert.equal(net.allows("https://alt.example.com/v1"), false);
    // Refuzul vine din broker, deci nu se emite nicio cerere de retea.
    await assert.rejects(net.fetch("https://alt.example.com/v1"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:process expune doar variabilele acoperite de env.read", () => {
  const context = harness({ "env.read": ["RAPTOR_*"] });
  try {
    const proc = createProcess(context.host, { RAPTOR_MODE: "test", RAPTOR_PORT: "1", SECRET_TOKEN: "nu" });
    assert.equal(proc.env("RAPTOR_MODE"), "test");
    assert.deepEqual(proc.envKeys(), ["RAPTOR_MODE", "RAPTOR_PORT"], "ce nu e permis nu apare nici macar ca nume");
    assert.throws(() => proc.env("SECRET_TOKEN"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:process refuza spawn nedeclarat si cere oprire curata, nu exit brutal", async () => {
  const context = harness({});
  try {
    const proc = createProcess(context.host, {});
    await assert.rejects(proc.spawn("git", { args: ["status"] }), denied);

    const codes: number[] = [];
    proc.onExitRequest((code) => codes.push(code));
    proc.requestExit(3);
    assert.deepEqual(codes, [3]);
    assert.deepEqual(proc.args, ["--flag"]);
  } finally {
    context.dispose();
  }
});

test("raptor:kv izoleaza spatiile de nume si respecta TTL-ul", async () => {
  const context = harness({});
  try {
    let now = 1000;
    const kv = createKv(context.host, Object.assign(new Map(), { now: () => now }));
    await kv.set("a", "1");
    await kv.set("expira", "2", { ttlMs: 50 });

    const sesiuni = kv.namespace("sesiuni");
    await sesiuni.set("a", "alta");
    assert.equal(await kv.get("a"), "1", "spatiile de nume nu se calca");
    assert.equal(await sesiuni.get("a"), "alta");
    assert.deepEqual(await sesiuni.list(), ["a"]);

    now += 100;
    assert.equal(await kv.get("expira"), null, "cheia expirata dispare la citire");
    assert.equal(await kv.delete("a"), true);
    assert.equal(await kv.delete("a"), false);
  } finally {
    context.dispose();
  }
});

test("raptor:serve ruteaza cu parametri si cade pe 404 fara handler", async () => {
  const context = harness({});
  try {
    const serve = createServe(context.host);
    const handler = serve.route([
      { method: "GET", pattern: "/utilizatori/:id", handler: (_request, info) => new Response(info.params["id"] ?? "") },
      { method: "POST", pattern: "/utilizatori", handler: () => new Response("creat", { status: 201 }) },
    ]);

    const info = { signal: new AbortController().signal, remoteAddress: null, params: {} };
    assert.equal(await (await handler(new Request("http://local/utilizatori/42"), info)).text(), "42");
    assert.equal((await handler(new Request("http://local/utilizatori", { method: "POST" }), info)).status, 201);
    assert.equal((await handler(new Request("http://local/lipsa"), info)).status, 404);
    assert.equal(
      (await handler(new Request("http://local/utilizatori/42", { method: "DELETE" }), info)).status,
      404,
      "metoda face parte din ruta",
    );
  } finally {
    context.dispose();
  }
});

test("raptor:serve porneste un server real si il opreste gratios", async () => {
  // `net.listen` e declarata: a deschide un port cere capability (vezi
  // `escapes.test.ts`, S4). Aici verificam ce face serverul, nu ce refuza.
  const context = harness({ "net.listen": ["127.0.0.1:*"] });
  try {
    const serve = createServe(context.host);
    const server = await serve.serve({ port: 0, fetch: () => new Response("viu") });
    try {
      assert.ok(server.port > 0);
      const response = await fetch(`${server.url}/oricare`);
      assert.equal(await response.text(), "viu");
    } finally {
      await server.close();
    }
    await assert.rejects(fetch(`${server.url}/oricare`), "socket-ul este inchis dupa close()");
  } finally {
    context.dispose();
  }
});
