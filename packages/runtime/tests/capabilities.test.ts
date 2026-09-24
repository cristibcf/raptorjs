/**
 * Contractul capability broker-ului (spec sectiunea 7).
 *
 * Fiecare API public are si un test negativ: spec sectiunea 12 cere exact asta,
 * pentru ca un model de securitate se demonstreaza prin ce refuza, nu prin ce
 * permite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBroker, createObserver, normalizePath } from "../src/index.ts";

const ROOT = normalizePath("/proiecte/app");

function broker(declarations: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return createBroker({ projectRoot: ROOT, declarations: declarations as never, ...extra });
}

test("fara declaratie, scrierea si reteaua sunt refuzate", () => {
  const capabilities = broker();
  assert.equal(capabilities.check("files.write", "./dist/a.js").granted, false);
  assert.equal(capabilities.check("net.connect", "example.com:443").granted, false);
  assert.equal(capabilities.check("process.spawn", "git").granted, false);
  assert.equal(capabilities.check("env.read", "PATH").granted, false);
});

test("citirea implicita se opreste la radacina proiectului", () => {
  const capabilities = broker();
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, true);
  assert.equal(capabilities.check("files.read", `${ROOT}/../alt-proiect/secret`).granted, false);
});

test("un prefix comun nu inseamna continere", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, true);
  assert.equal(capabilities.check("files.read", "./src-privat/a.ts").granted, false);
});

test("traversarea nu scapa din domeniul declarat", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/../raptor.runtime.json").granted, false);
  assert.equal(capabilities.check("files.read", "./src/./nested/a.ts").granted, true);
});

test("regimul strict elimina domeniul implicit de citire", () => {
  const capabilities = broker({}, { strict: true });
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, false);
  assert.equal(capabilities.strict, true);
});

test("politica de productie porneste implicit in regim strict", () => {
  const capabilities = broker({}, { policy: "production" });
  assert.equal(capabilities.strict, true);
  assert.equal(capabilities.check("files.read", "./src/main.ts").granted, false);
});

test("allowlist-ul de retea respecta gazda si portul", () => {
  const capabilities = broker({ "net.connect": ["api.example.com:443", "*.intern.example.com:*"] });
  assert.equal(capabilities.check("net.connect", "api.example.com:443").granted, true);
  assert.equal(capabilities.check("net.connect", "api.example.com:80").granted, false);
  assert.equal(capabilities.check("net.connect", "a.intern.example.com:8080").granted, true);
  assert.equal(capabilities.check("net.connect", "intern.example.com:8080").granted, false);
  assert.equal(capabilities.check("net.connect", "rau-api.example.com:443").granted, false);
});

test("variabilele de mediu accepta nume exact sau prefix", () => {
  const capabilities = broker({ "env.read": ["DATABASE_URL", "RAPTOR_*"] });
  assert.equal(capabilities.check("env.read", "DATABASE_URL").granted, true);
  assert.equal(capabilities.check("env.read", "DATABASE_URL_BACKUP").granted, false);
  assert.equal(capabilities.check("env.read", "RAPTOR_TOKEN").granted, true);
  assert.equal(capabilities.check("env.read", "PATH").granted, false);
});

test("ceasul si aleatoriul sunt permise implicit, dar adnotate", () => {
  const capabilities = broker();
  const decision = capabilities.check("clock.real");
  assert.equal(decision.granted, true);
  assert.equal(decision.annotated, true);
});

test("ceasul poate fi dezactivat explicit", () => {
  const capabilities = broker({ "clock.real": false });
  assert.equal(capabilities.check("clock.real").granted, false);
});

test("revocarea are efect imediat", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, true);
  capabilities.revoke("files.read");
  assert.equal(capabilities.check("files.read", "./src/a.ts").granted, false);
  assert.throws(() => capabilities.require("files.read", "./src/a.ts"), (error: { code?: string }) => error.code === "raptor:capability/revoked");
});

test("delegarea transmite doar subsetul cerut", () => {
  const capabilities = broker({ "files.read": ["./src"], "files.write": ["./dist"], "clock.real": true });
  const child = capabilities.delegate(["files.read"]);
  assert.equal(child.check("files.read", "./src/a.ts").granted, true);
  assert.equal(child.check("files.write", "./dist/a.js").granted, false);
  assert.equal(child.check("clock.real").granted, false, "ambientalele nu se mostenesc fara cerere explicita");
});

test("delegarea nu poate reinvia o capability revocata", () => {
  const capabilities = broker({ "files.write": ["./dist"] });
  capabilities.revoke("files.write");
  const child = capabilities.delegate(["files.write"]);
  assert.equal(child.check("files.write", "./dist/a.js").granted, false);
});

test("require arunca o eroare cu tinta si motivul", () => {
  const capabilities = broker({ "files.read": ["./src"] });
  assert.throws(
    () => capabilities.require("files.read", "./secrete/a.txt"),
    (error: { code?: string; capability?: string; target?: string; message?: string }) => {
      assert.equal(error.code, "raptor:capability/denied");
      assert.equal(error.capability, "files.read");
      assert.ok(error.target?.endsWith("/secrete/a.txt"));
      return true;
    },
  );
});

test("fiecare decizie ajunge in diagnostic si in telemetrie", () => {
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
