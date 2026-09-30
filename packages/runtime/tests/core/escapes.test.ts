/**
 * Regressions for the escapes from the capability model found in the 2026-09-24
 * audit (`AUDIT-2026-09-24.md`, S1-S2, S4, S8).
 *
 * Every test here was first a proof-of-concept that SUCCEEDED. They are kept
 * separate from `modules.test.ts` precisely so it is clear they do not check a
 * module's functioning, but its boundary: what it denies when someone tries
 * around it.
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
} from "../../src/core/index.ts";
import type { CapabilityDeclarations, HostContext, RuntimeManifest } from "../../src/core/index.ts";

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
    tasks: { maxConcurrent: 8, defaultDeadlineMs: null },
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

test("S1: spawn cannot set variables the application is not allowed to read", async () => {
  // A manifest that allows EXACTLY one command and no environment variable.
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, { SECRET: "not visible" });
    assert.deepEqual(proc.envKeys(), [], "without env.read, the application sees no name");

    await assert.rejects(
      proc.spawn("node", { args: ["-e", "0"], env: { ORICE: "value" } }),
      denied,
      "the environment the caller requests goes through the same gate as a read",
    );
  } finally {
    context.dispose();
  }
});

test("S1: variables that load code are denied even with env.set granted", async () => {
  // Even with permission to set the WHOLE environment, the application cannot
  // turn `process.spawn: ["node"]` into "any code" through a `--require`.
  const context = harness({ "process.spawn": ["node"], "env.read": ["*"], "env.set": ["*"] });
  try {
    const proc = createProcess(context.host, {});
    for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "GIT_SSH_COMMAND", "PATH"]) {
      await assert.rejects(
        proc.spawn("node", { args: ["-e", "0"], env: { [name]: "./payload.js" } }),
        (error: unknown) => denied(error) && String((error as Error).message).includes(name),
        `${name} loads code before the command`,
      );
    }
  } finally {
    context.dispose();
  }
});

test("S1: a cwd outside the project requires files.read on that path", async () => {
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, {});
    const afara = normalizePath(join(tmpdir(), "raptor-esc-cwd-inexistent"));
    await assert.rejects(
      proc.spawn("node", { args: ["-e", "0"], cwd: afara }),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "files.read",
      "a foreign cwd is disk access, not a startup detail",
    );
  } finally {
    context.dispose();
  }
});

test("S1: the explicitly granted environment still reaches the child", async () => {
  // The fix must not break the legitimate case.
  const context = harness({ "process.spawn": ["node"], "env.read": ["RAPTOR_*"], "env.set": ["RAPTOR_*"] });
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

test("S8: the output of a talkative child is capped, not accumulated forever", async () => {
  const context = harness({ "process.spawn": ["node"] });
  try {
    const proc = createProcess(context.host, {});
    // 12 MB over an 8 MB cap.
    const result = await proc.spawn("node", {
      args: ["-e", "const c='x'.repeat(1024*1024); for(let i=0;i<12;i++) process.stdout.write(c);"],
    });
    assert.equal(result.truncated, true, "the caller learns it is seeing truncated output");
    assert.ok(result.stdout.length <= 8 * 1024 * 1024, `stdout grew to ${result.stdout.length}`);
  } finally {
    context.dispose();
  }
});

/* ------------------------------------------------------------ S2: redirect */

test("S2: a redirect cannot carry the fetch to a denied host", async () => {
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
    assert.equal(net.allows(`http://127.0.0.1:${internPort}/`), false, "the internal host is denied directly");

    await assert.rejects(
      net.fetch(`http://127.0.0.1:${permisPort}/`),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "net.connect",
      "the redirect hop goes through the broker, like the first",
    );
  } finally {
    context.dispose();
    intern.close();
    permis.close();
  }
});

test("S2: a redirect to an allowed host is followed normally", async () => {
  const tinta = createServer((_request, response) => {
    response.writeHead(200);
    response.end("arrived");
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
    assert.equal(await response.text(), "arrived");
    assert.equal(response.status, 200);
  } finally {
    context.dispose();
    tinta.close();
    plecare.close();
  }
});

/* -------------------------------------------------------- S4: net.listen */

test("S4: serve cannot open a port without net.listen", async () => {
  const context = harness({});
  try {
    const serve = createServe(context.host);
    await assert.rejects(
      serve.serve({ port: 0, fetch: () => new Response("should not") }),
      (error: unknown) => denied(error) && (error as { capability?: string }).capability === "net.listen",
      "opening a port is a capability, not a convenience",
    );
  } finally {
    context.dispose();
  }
});

test("S4: net.listen is granted on host and port, not globally", async () => {
  const context = harness({ "net.listen": ["127.0.0.1:*"] });
  try {
    const serve = createServe(context.host);
    const server = await serve.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("alive") });
    try {
      assert.ok(server.port > 0);
    } finally {
      await server.close();
    }

    await assert.rejects(
      serve.serve({ port: 0, hostname: "0.0.0.0", fetch: () => new Response("no") }),
      denied,
      "a loopback rule does not allow exposing on all interfaces",
    );
  } finally {
    context.dispose();
  }
});

/* --------------------------------------------- round 2: env.set ----------- */

test("R3: setting a child's environment requires env.set, not env.read", async () => {
  // Reading and writing are not the same thing: writing is what can change what
  // code the child runs. With env.read everywhere, but without env.set, nothing
  // passes.
  const context = harness({ "process.spawn": ["node"], "env.read": ["*"] });
  try {
    const proc = createProcess(context.host, {});
    await assert.rejects(
      proc.spawn("node", { args: ["-e", "0"], env: { ORICE: "1" } }),
      (error: unknown) => (error as { capability?: string }).capability === "env.set",
      "reading the whole environment does not grant the right to also write it",
    );
  } finally {
    context.dispose();
  }
});

test("R3: the list of code-loading variables also covers non-nodejs ecosystems", async () => {
  // The first version of the list looked complete; the second audit pass walked
  // right past it with all the names below, with `env.read: ["*"]` granted.
  const context = harness({ "process.spawn": ["node"], "env.read": ["*"], "env.set": ["*"] });
  try {
    const proc = createProcess(context.host, {});
    const nume = [
      "NODE_PATH",
      "JAVA_TOOL_OPTIONS",
      "_JAVA_OPTIONS",
      "JDK_JAVA_OPTIONS",
      "CLASSPATH",
      "RUBYOPT",
      "RUBYLIB",
      "PYTHONHOME",
      "PYTHONPATH",
      "PERL5LIB",
      "ZDOTDIR",
      "LD_AUDIT",
      "DYLD_FRAMEWORK_PATH",
    ];
    for (const name of nume) {
      await assert.rejects(
        proc.spawn("node", { args: ["-e", "0"], env: { [name]: "x" } }),
        (error: unknown) => (error as { capability?: string }).capability === "env.set",
        `${name} loads code and must be denied even with env.set granted`,
      );
    }
  } finally {
    context.dispose();
  }
});

/* ------------------------------ round 2: credentials on redirect ---------- */

test("R4: a redirect to another host leaves without credentials", async () => {
  const primite: Array<Record<string, unknown>> = [];
  const tinta = createServer((request, response) => {
    primite.push({ ...request.headers });
    response.writeHead(200);
    response.end("arrived");
  });
  await new Promise<void>((resolve) => tinta.listen(0, "127.0.0.1", resolve));
  const tintaPort = (tinta.address() as { port: number }).port;

  const plecare = createServer((_request, response) => {
    // Another host: same IP, different port. For `net.connect` they are different
    // destinations, so for credentials they are too.
    response.writeHead(302, { location: `http://127.0.0.1:${tintaPort}/` });
    response.end();
  });
  await new Promise<void>((resolve) => plecare.listen(0, "127.0.0.1", resolve));
  const plecarePort = (plecare.address() as { port: number }).port;

  const context = harness({ "net.connect": [`127.0.0.1:${plecarePort}`, `127.0.0.1:${tintaPort}`] });
  try {
    const net = createNet(context.host);
    const response = await net.fetch(`http://127.0.0.1:${plecarePort}/`, {
      headers: { authorization: "Bearer SECRET", cookie: "sid=abc", "x-corelatie": "pastrat" },
    });
    assert.equal(await response.text(), "arrived");

    const headers = primite[0] ?? {};
    assert.equal(headers["authorization"], undefined, "the token has no business on another host");
    assert.equal(headers["cookie"], undefined, "neither does the cookie");
    assert.equal(headers["x-corelatie"], "pastrat", "the rest of the headers go on");
  } finally {
    context.dispose();
    tinta.close();
    plecare.close();
  }
});
