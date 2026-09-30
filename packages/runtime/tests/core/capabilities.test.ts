/**
 * The capability broker's contract (spec section 7).
 *
 * Every public API also has a negative test: spec section 12 requires exactly
 * that, because a security model is demonstrated by what it denies, not by what
 * it allows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBroker, createObserver, normalizePath } from "../../src/core/index.ts";

const ROOT = normalizePath("/projects/app");

function broker(declarations: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return createBroker({ projectRoot: ROOT, declarations: declarations as never, ...extra });
}

test("without a declaration, writes and the network are denied", () => {
  const capabilities = broker();
  assert.equal(capabilities.check("files.write", "./dist/a.js").granted, false);
  assert.equal(capabilities.check("net.connect", "example.com:443").granted, false);
  assert.equal(capabilities.check("process.spawn", "git").granted, false);
  assert.equal(capabilities.check("env.read", "PATH").granted, false);
});

test("implicit reading stops at the project root", () => {
  const capabilities = broker();
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, true);
  assert.equal(capabilities.check("files.read", `${ROOT}/../other-project/secret`).granted, false);
});

test("a common prefix does not mean containment", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, true);
  assert.equal(capabilities.check("files.read", "./src-private/a.ts").granted, false);
});

test("traversal does not escape the declared scope", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/../raptor.runtime.json").granted, false);
  assert.equal(capabilities.check("files.read", "./src/./nested/a.ts").granted, true);
});

test("strict mode removes the implicit read scope", () => {
  const capabilities = broker({}, { strict: true });
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, false);
  assert.equal(capabilities.strict, true);
});

test("the production policy starts in strict mode by default", () => {
  const capabilities = broker({}, { policy: "production" });
  assert.equal(capabilities.strict, true);
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, false);
});

test("the network allowlist respects host and port", () => {
  const capabilities = broker({ "net.connect": ["api.example.com:443", "*.intern.example.com:*"] });
  assert.equal(capabilities.check("net.connect", "api.example.com:443").granted, true);
  assert.equal(capabilities.check("net.connect", "api.example.com:80").granted, false);
  assert.equal(capabilities.check("net.connect", "a.intern.example.com:8080").granted, true);
  assert.equal(capabilities.check("net.connect", "intern.example.com:8080").granted, false);
  assert.equal(capabilities.check("net.connect", "evil-api.example.com:443").granted, false);
});

test("environment variables accept an exact name or a prefix", () => {
  const capabilities = broker({ "env.read": ["DATABASE_URL", "RAPTOR_*"] });
  assert.equal(capabilities.check("env.read", "DATABASE_URL").granted, true);
  assert.equal(capabilities.check("env.read", "DATABASE_URL_BACKUP").granted, false);
  assert.equal(capabilities.check("env.read", "RAPTOR_TOKEN").granted, true);
  assert.equal(capabilities.check("env.read", "PATH").granted, false);
});

test("the clock and randomness are allowed by default, but annotated", () => {
  const capabilities = broker();
  const decision = capabilities.check("clock.real");
  assert.equal(decision.granted, true);
  assert.equal(decision.annotated, true);
});

test("the clock can be disabled explicitly", () => {
  const capabilities = broker({ "clock.real": false });
  assert.equal(capabilities.check("clock.real").granted, false);
});

test("revocation takes effect immediately", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, true);
  capabilities.revoke("files.read");
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, false);
  assert.throws(() => capabilities.require("files.read", "./src/a.ts"), (error: { code?: string }) => error.code === "raptor:capability/revoked");
});

test("delegation passes only the requested subset", () => {
  const capabilities = broker({ "files.read": ["./src"], "files.write": ["./dist"], "clock.real": true });
  const child = capabilities.delegate(["files.read"]);
  assert.equal(child.check("files.read", "./src/a.ts").granted, true);
  assert.equal(child.check("files.write", "./dist/a.js").granted, false);
  assert.equal(child.check("clock.real").granted, false, "ambient capabilities are not inherited without an explicit request");
});

test("delegation cannot revive a revoked capability", () => {
  const capabilities = broker({ "files.write": ["./dist"] });
  capabilities.revoke("files.write");
  const child = capabilities.delegate(["files.write"]);
  assert.equal(child.check("files.write", "./dist/a.js").granted, false);
});

test("require throws an error carrying the target and the reason", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.throws(
    () => capabilities.require("files.read", "./secrets/a.txt"),
    (error: { code?: string; capability?: string; target?: string; message?: string }) => {
      assert.equal(error.code, "raptor:capability/denied");
      assert.equal(error.capability, "files.read");
      assert.ok(error.target?.endsWith("/secrets/a.txt"));
      return true;
    },
  );
});

test("every decision reaches the diagnostics and the telemetry", () => {
  const observer = createObserver({ now: () => 0 });
  const capabilities = createBroker({ projectRoot: ROOT, declarations: { "files.read": ["./src"] }, observer });

  capabilities.check("files.read", "./src/a.ts");
  capabilities.check("files.read", "./src/a.ts");
  capabilities.check("net.connect", "example.com:443");

  const diagnostics = capabilities.diagnostics();
  const granted = diagnostics.usage.find((entry) => entry.capability === "files.read");
  assert.equal(granted?.count, 2);
  assert.equal(granted?.granted, true);
  assert.equal(diagnostics.usage.find((entry) => entry.capability === "net.connect")?.granted, false);

  const events = observer.events().filter((event) => event.kind === "capability");
  assert.equal(events.length, 3);
});
