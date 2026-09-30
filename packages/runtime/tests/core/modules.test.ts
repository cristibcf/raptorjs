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
} from "../../src/core/index.ts";
import type { CapabilityDeclarations, HostContext, RuntimeManifest } from "../../src/core/index.ts";

interface Harness {
  readonly host: HostContext;
  dispose(): void;
}

/**
 * The modules receive a `HostContext`, never raw handles. The harness here
 * builds exactly that context, so the tests exercise the real path through the
 * broker - not a bypassed variant.
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

test("raptor:files denies an undeclared read and allows the declared one", async () => {
  const context = harness({ "files.read": ["./public"], "files.write": ["./public"] });
  try {
    const files = createFiles(context.host);
    await files.write("./public/nota.txt", "hello");
    assert.equal(await files.readText("./public/nota.txt"), "hello");
    await assert.rejects(files.readText("./privat/secret.txt"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:files cannot leave the scope through traversal", async () => {
  const context = harness({ "files.read": ["./public"] });
  try {
    const files = createFiles(context.host);
    await assert.rejects(files.readText("./public/../../etc/passwd"), denied);
  } finally {
    context.dispose();
  }
});

test("the write is atomic: it leaves no partial files behind", async () => {
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
      "the temporary file disappears after rename",
    );
  } finally {
    context.dispose();
  }
});

test("raptor:files reports existence without leaking undeclared content", async () => {
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

test("destinationOf normalizes the host and the scheme's default port", () => {
  assert.equal(destinationOf("https://API.Example.com/cale?x=1"), "api.example.com:443");
  assert.equal(destinationOf("http://example.com"), "example.com:80");
  assert.equal(destinationOf("https://example.com:8443/x"), "example.com:8443");
  assert.throws(() => destinationOf("/doar-cale"), (error: unknown) => (error as { code: string }).code === "raptor:module/unsupported");
  assert.throws(() => destinationOf("file:///etc/passwd"), (error: unknown) => (error as { code: string }).code === "raptor:module/unsupported");
});

test("raptor:net checks the destination before opening the connection", async () => {
  const context = harness({ "net.connect": ["api.example.com:443"] });
  try {
    const net = createNet(context.host);
    assert.equal(net.allows("https://api.example.com/v1"), true);
    assert.equal(net.allows("https://alt.example.com/v1"), false);
    // The denial comes from the broker, so no network request is issued.
    await assert.rejects(net.fetch("https://alt.example.com/v1"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:process exposes only the variables covered by env.read", () => {
  const context = harness({ "env.read": ["RAPTOR_*"] });
  try {
    const proc = createProcess(context.host, { RAPTOR_MODE: "test", RAPTOR_PORT: "1", SECRET_TOKEN: "no" });
    assert.equal(proc.env("RAPTOR_MODE"), "test");
    assert.deepEqual(proc.envKeys(), ["RAPTOR_MODE", "RAPTOR_PORT"], "what is not allowed does not even appear as a name");
    assert.throws(() => proc.env("SECRET_TOKEN"), denied);
  } finally {
    context.dispose();
  }
});

test("raptor:process denies undeclared spawn and requests clean shutdown, not brutal exit", async () => {
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

test("raptor:kv isolates namespaces and respects the TTL", async () => {
  const context = harness({});
  try {
    let now = 1000;
    const kv = createKv(context.host, Object.assign(new Map(), { now: () => now }));
    await kv.set("a", "1");
    await kv.set("expira", "2", { ttlMs: 50 });

    const sesiuni = kv.namespace("sesiuni");
    await sesiuni.set("a", "alta");
    assert.equal(await kv.get("a"), "1", "namespaces do not tread on each other");
    assert.equal(await sesiuni.get("a"), "alta");
    assert.deepEqual(await sesiuni.list(), ["a"]);

    now += 100;
    assert.equal(await kv.get("expira"), null, "the expired key disappears on read");
    assert.equal(await kv.delete("a"), true);
    assert.equal(await kv.delete("a"), false);
  } finally {
    context.dispose();
  }
});

test("raptor:serve routes with parameters and falls to 404 without a handler", async () => {
  const context = harness({});
  try {
    const serve = createServe(context.host);
    const handler = serve.route([
      { method: "GET", pattern: "/utilizatori/:id", handler: (_request, info) => new Response(info.params["id"] ?? "") },
      { method: "POST", pattern: "/utilizatori", handler: () => new Response("created", { status: 201 }) },
    ]);

    const info = { signal: new AbortController().signal, remoteAddress: null, params: {} };
    assert.equal(await (await handler(new Request("http://local/utilizatori/42"), info)).text(), "42");
    assert.equal((await handler(new Request("http://local/utilizatori", { method: "POST" }), info)).status, 201);
    assert.equal((await handler(new Request("http://local/lipsa"), info)).status, 404);
    assert.equal(
      (await handler(new Request("http://local/utilizatori/42", { method: "DELETE" }), info)).status,
      404,
      "the method is part of the route",
    );
  } finally {
    context.dispose();
  }
});

test("raptor:serve starts a real server and stops it gracefully", async () => {
  // `net.listen` is declared: opening a port requires a capability (see
  // `escapes.test.ts`, S4). Here we check what the server does, not what it denies.
  const context = harness({ "net.listen": ["127.0.0.1:*"] });
  try {
    const serve = createServe(context.host);
    const server = await serve.serve({ port: 0, fetch: () => new Response("alive") });
    try {
      assert.ok(server.port > 0);
      const response = await fetch(`${server.url}/oricare`);
      assert.equal(await response.text(), "alive");
    } finally {
      await server.close();
    }
    await assert.rejects(fetch(`${server.url}/oricare`), "the socket is closed after close()");
  } finally {
    context.dispose();
  }
});
