import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, decodeFrame, encodeFrame, serveHost } from "../../src/core/index.ts";
import type { AuditEntry, HostBridge, HostServer, HostTarget, MethodHandler } from "../../src/core/index.ts";

interface Pair {
  readonly app: HostBridge;
  readonly host: HostServer;
  readonly audit: AuditEntry[];
  dispose(): void;
}

/** The two ends of the boundary, linked through the in-memory channel. */
function pair(
  target: HostTarget,
  capabilities: readonly string[],
  methods: Record<string, MethodHandler>,
  hostCapabilities = capabilities,
): Pair {
  const channel = createMemoryChannel();
  const audit: AuditEntry[] = [];
  const host = serveHost({
    target,
    capabilities: hostCapabilities,
    transport: channel.host,
    methods,
    onAudit: (entry) => audit.push(entry),
  });
  const app = createBridge({ target, capabilities, transport: channel.app, timeoutMs: 2000 });
  return { app, host, audit, dispose: () => app.dispose("test") };
}

test("an allowed call reaches the adapter and comes back with the result", async () => {
  const received: Array<Record<string, unknown>> = [];
  const link = pair("desktop", [], {
    "window.setTitle": (params) => {
      received.push({ ...params });
      return { ok: true };
    },
  });
  try {
    assert.deepEqual(await link.app.call("window.setTitle", { title: "Raptor" }), { ok: true });
    assert.deepEqual(received, [{ title: "Raptor" }]);
  } finally {
    link.dispose();
  }
});

test("a call without a capability is stopped in JS, before it reaches the transport", async () => {
  const link = pair("desktop", [], { "camera.capture": () => ({ bytes: 0 }) });
  try {
    assert.equal(link.app.allows("camera.capture"), false);
    await assert.rejects(
      link.app.call("camera.capture"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
    assert.deepEqual(link.audit, [], "the host saw no call");
  } finally {
    link.dispose();
  }
});

test("the host denies on its own even if the JS side were bypassed", async () => {
  // A bridge that thinks it is entitled, a host that knows it is not: the real
  // boundary is at the host, and the test exercises it by sending the frame
  // directly on the transport.
  const channel = createMemoryChannel();
  const audit: AuditEntry[] = [];
  serveHost({
    target: "desktop",
    capabilities: [],
    transport: channel.host,
    methods: { "camera.capture": () => ({ bytes: 1 }) },
    onAudit: (entry) => audit.push(entry),
  });

  const answer = new Promise<Record<string, unknown>>((resolve) => {
    channel.app.onMessage((line) => resolve(decodeFrame(line) as unknown as Record<string, unknown>));
  });
  channel.app.send(encodeFrame({ kind: "call", id: 1, method: "camera.capture", params: {} }));

  const frame = (await answer) as { kind: string; error: { code: string } };
  assert.equal(frame.kind, "failure");
  assert.equal(frame.error.code, "raptor:host/capability-undeclared");
  assert.deepEqual(
    audit.map((entry) => [entry.method, entry.granted]),
    [["camera.capture", false]],
    "the denial goes into the host's audit log",
  );
});

test("a nonexistent method is reported as unknown, with the list of valid ones", async () => {
  const link = pair("desktop", [], {});
  try {
    await assert.rejects(link.app.call("window.teleport"), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/method-unknown");
      assert.ok((hostError.detail["known"] as string[]).includes("window.open"));
      return true;
    });
  } finally {
    link.dispose();
  }
});

test("a method that is allowed but not implemented by the adapter says exactly that", async () => {
  const link = pair("desktop", [], {});
  try {
    await assert.rejects(link.app.call("window.open", { url: "/" }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/unimplemented");
      assert.equal(hostError.detail["hostCode"], "raptor:host/unimplemented");
      return true;
    });
    assert.equal(link.audit[0]?.reason, "not implemented by this adapter");
  } finally {
    link.dispose();
  }
});

test("an adapter error reaches the app with its code and message", async () => {
  const link = pair("desktop", [], {
    "storage.get": () => {
      throw new Error("the disk is full");
    },
  });
  try {
    await assert.rejects(link.app.call("storage.get", { key: "a" }), /the disk is full/);
  } finally {
    link.dispose();
  }
});

test("concurrent calls do not mix up their responses", async () => {
  const link = pair("desktop", [], {
    "storage.get": async (params) => {
      const key = String(params["key"]);
      // The responses come back in reverse order from the requests.
      await new Promise((resolve) => setTimeout(resolve, key === "lent" ? 30 : 1));
      return `valoare:${key}`;
    },
  });
  try {
    const [lent, rapid] = await Promise.all([
      link.app.call("storage.get", { key: "lent" }),
      link.app.call("storage.get", { key: "rapid" }),
    ]);
    assert.equal(lent, "valoare:lent");
    assert.equal(rapid, "valoare:rapid");
  } finally {
    link.dispose();
  }
});

test("the host's events reach the app's listeners", async () => {
  const link = pair("mobile", [], {});
  try {
    const seen: Array<Record<string, unknown>> = [];
    link.app.on("lifecycle.changed", (payload) => seen.push(payload));
    link.host.emit("lifecycle.changed", { state: "background" });
    link.host.emit("deeplink.received", { url: "app://path" });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(seen, [{ state: "background" }], "a listener receives only its own event");
  } finally {
    link.dispose();
  }
});

test("closing the bridge rejects in-flight calls instead of leaving them hanging", async () => {
  const link = pair("desktop", [], { "storage.get": () => new Promise(() => undefined) });
  const inFlight = link.app.call("storage.get", { key: "a" });
  link.app.dispose("the app is shutting down");

  await assert.rejects(inFlight, (error: unknown) => (error as { code: string }).code === "raptor:host/transport-closed");
  await assert.rejects(
    link.app.call("storage.get", { key: "b" }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/transport-closed",
  );
});

test("a mute host makes the call time out, not wait forever", async () => {
  const channel = createMemoryChannel();
  const app = createBridge({ target: "desktop", transport: channel.app, timeoutMs: 20 });
  try {
    await assert.rejects(app.call("storage.get", { key: "a" }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/transport-closed");
      assert.equal(hostError.detail["timeoutMs"], 20);
      return true;
    });
  } finally {
    app.dispose();
  }
});

test("a corrupt frame is reported as a protocol error, not thrown into the app", async () => {
  const channel = createMemoryChannel();
  const app = createBridge({ target: "desktop", transport: channel.app, timeoutMs: 50 });
  try {
    const problems: Array<Record<string, unknown>> = [];
    app.on("host.protocolError", (payload) => problems.push(payload));
    channel.host.send("{ not json");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(problems.length, 1);
    assert.match(String(problems[0]?.["message"]), /JSON/);
  } finally {
    app.dispose();
  }
});

test("the core methods require no capabilities on any target", async () => {
  for (const target of ["desktop", "mobile"] as const) {
    const link = pair(target, [], { "lifecycle.state": () => "foreground" });
    try {
      assert.equal(link.app.allows("lifecycle.state"), true);
      assert.equal(await link.app.call("lifecycle.state"), "foreground");
    } finally {
      link.dispose();
    }
  }
});

test("host.describe says what the adapter implements, not just what is allowed", async () => {
  const link = pair("desktop", ["device.notifications"], {
    "window.open": () => ({ id: "w1" }),
    "storage.get": () => null,
  });
  try {
    const description = await link.app.describe();
    assert.equal(description.target, "desktop");
    assert.deepEqual(description.capabilities, ["device.notifications"]);
    assert.deepEqual(description.implemented, ["host.describe", "storage.get", "window.open"]);
  } finally {
    link.dispose();
  }
});

test("supported() combines the capability with the implementation", async () => {
  const link = pair("desktop", [], { "window.open": () => ({ id: "w1" }) });
  try {
    const supported = await link.app.supported();
    assert.equal(supported("window.open"), true);
    assert.equal(supported("window.close"), false, "allowed, but not implemented by this adapter");
    assert.equal(link.app.allows("window.close"), true, "the capability alone would have said 'yes'");
    assert.equal(supported("notify.show"), false, "neither implemented nor allowed");
  } finally {
    link.dispose();
  }
});

test("an adapter can replace host.describe with its own response", async () => {
  const link = pair("desktop", [], {
    "host.describe": () => ({ target: "desktop", capabilities: [], implemented: ["only-what-i-want"] }),
  });
  try {
    assert.deepEqual((await link.app.describe()).implemented, ["only-what-i-want"]);
  } finally {
    link.dispose();
  }
});

/**
 * Regression for the 2026-09-24 audit (S9).
 *
 * `plain()` cleaned `__proto__` / `constructor` / `prototype` only at the first
 * level. `JSON.parse` produces them as own properties, so the decoded object
 * was harmless in itself - but the first consumer that does `Object.assign({},
 * x)` with an uncleaned sub-object would have triggered the prototype setter.
 */
test("no dangerous key survives decoding, however deep", () => {
  const frame = decodeFrame(
    JSON.stringify({
      kind: "call",
      id: 1,
      method: "storage.set",
      params: {
        __proto__: { poluat: true },
        adanc: { mai: { __proto__: { poluat: true }, constructor: { poluat: true }, ok: 1 } },
        lista: [{ __proto__: { poluat: true }, valoare: 2 }],
      },
    }),
  ) as unknown as { params: Record<string, unknown> };

  const params = frame.params;
  const adanc = params["adanc"] as Record<string, unknown>;
  const mai = adanc["mai"] as Record<string, unknown>;
  const lista = params["lista"] as Array<Record<string, unknown>>;

  // The keys disappeared at every level, including inside an array.
  assert.deepEqual(Object.keys(params).sort(), ["adanc", "lista"]);
  assert.deepEqual(Object.keys(mai), ["ok"]);
  assert.deepEqual(Object.keys(lista[0]!), ["valoare"]);

  // And the useful data passed through untouched.
  assert.equal(mai["ok"], 1);
  assert.equal(lista[0]!["valoare"], 2);

  // The proof that matters: copying any of them does not touch the prototype.
  for (const candidate of [params, adanc, mai, lista[0]!]) {
    const copy = Object.assign({}, candidate) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(copy), Object.prototype, "the copy kept its prototype");
    assert.equal((copy as { poluat?: unknown }).poluat, undefined);
  }
  assert.equal(({} as { poluat?: unknown }).poluat, undefined, "Object.prototype stayed clean");
});

/**
 * Regression for audit round 2 (R5): `sanitize` was recursive without a limit.
 *
 * V8's `JSON.parse` is iterative and handles tens of thousands of levels; the
 * cleanup fell over with `RangeError: Maximum call stack size exceeded` around
 * 5000. It was caught by the callers' `try/catch`, so it did not take down the
 * host - but a frame rejected with "stack full" says something broke on our
 * side, when in fact the limit is a choice we must make explicitly.
 */
test("a pathologically nested frame is rejected with a limit, not a full stack", () => {
  const adanc = (n: number): string =>
    `{"kind":"call","id":1,"method":"storage.set","params":{"x":${'{"n":'.repeat(n)}1${"}".repeat(n)}}}`;

  for (const n of [1000, 20000]) {
    const linie = adanc(n);
    // Premise: the JSON itself is valid, so the rejection comes from us, deliberately.
    assert.doesNotThrow(() => JSON.parse(linie), `JSON.parse must succeed at ${n}`);
    assert.throws(
      () => decodeFrame(linie),
      (error: unknown) => {
        assert.ok(!(error instanceof RangeError), "not the stack, but our limit");
        assert.equal((error as { code?: string }).code, "raptor:host/protocol");
        assert.match((error as Error).message, /nested/);
        return true;
      },
      `depth ${n}`,
    );
  }

  // And a frame of reasonable depth passes unhindered.
  const rezonabil = decodeFrame(adanc(10)) as unknown as { params: Record<string, unknown> };
  assert.ok(rezonabil.params["x"]);
});
