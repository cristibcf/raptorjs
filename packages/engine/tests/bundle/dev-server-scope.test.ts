/**
 * Regresie pentru auditul din 2026-09-24 (S3): dev-server-ul servea fisiere din
 * afara radacinii si asculta pe toate interfetele.
 *
 * Cererile se trimit pe socket brut, nu cu `fetch`: clientul HTTP al lui Node
 * normalizeaza `..` din cale inainte sa o puna pe fir, deci un test scris cu
 * `fetch` ar fi trecut si cu bug-ul in loc.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startDevServer } from "../../src/bundle/dev-server.ts";

interface Raw {
  readonly status: number;
  readonly body: string;
}

/** O cerere GET cu tinta exact asa cum e scrisa, fara normalizare de client. */
function raw(port: number, target: string, accept = "*/*"): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nAccept: ${accept}\r\nConnection: close\r\n\r\n`);
    });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (buffer += chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      const [head = "", ...rest] = buffer.split("\r\n\r\n");
      const status = Number(head.split("\r\n")[0]?.split(" ")[1] ?? 0);
      resolve({ status, body: rest.join("\r\n\r\n") });
    });
  });
}

interface Fixture {
  readonly port: number;
  dispose(): Promise<void>;
}

/**
 * `<tmp>/app` este radacina servita. Langa ea, doua capcane:
 * `<tmp>/app-privat` (sora cu prefix comun) si `<tmp>/app/.env` (ascuns
 * INAUNTRUL radacinii - cazul cu adevarat frecvent).
 */
async function fixture(): Promise<Fixture> {
  const base = mkdtempSync(join(tmpdir(), "raptor-dev-"));
  mkdirSync(join(base, "app"));
  mkdirSync(join(base, "app-privat"));
  writeFileSync(join(base, "app-privat", ".env"), "SECRET_VECIN=1\n");
  writeFileSync(join(base, "app", ".env"), "SECRET_LOCAL=1\n");
  writeFileSync(join(base, "app", "index.html"), "<html><body><script src='/x.js'></script></body></html>\n");
  writeFileSync(join(base, "app", "main.ts"), "export const a = 1;\n");
  writeFileSync(join(base, "app", "logo mic.png"), "PNG");

  const server = startDevServer({ entry: join(base, "app", "main.ts"), root: join(base, "app"), port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    dispose: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test("S3: nu se poate iesi din radacina catre un director sora cu prefix comun", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/../app-privat/.env");
    assert.notEqual(response.status, 200, `a servit un fisier din afara radacinii: ${response.body}`);
    assert.ok(!response.body.includes("SECRET_VECIN"), "continutul vecinului nu are voie sa iasa pe fir");
  } finally {
    await app.dispose();
  }
});

test("S3: nici codificat procentual", async () => {
  const app = await fixture();
  try {
    for (const target of ["/..%2Fapp-privat%2F.env", "/%2e%2e/app-privat/.env", "/..%5Capp-privat%5C.env"]) {
      const response = await raw(app.port, target);
      assert.notEqual(response.status, 200, `${target} a trecut`);
      assert.ok(!response.body.includes("SECRET_VECIN"), `${target} a scurs continut`);
    }
  } finally {
    await app.dispose();
  }
});

test("S3: fisierele ascunse din radacina nu se servesc", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/.env");
    assert.notEqual(response.status, 200);
    assert.ok(!response.body.includes("SECRET_LOCAL"));
  } finally {
    await app.dispose();
  }
});

test("S3: sursele trec prin bundle, nu se servesc ca fisiere", async () => {
  const app = await fixture();
  try {
    assert.notEqual((await raw(app.port, "/main.ts")).status, 200);
  } finally {
    await app.dispose();
  }
});

test("S3: un asset legitim cu spatiu in nume este servit (calea se decodeaza)", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/logo%20mic.png");
    assert.equal(response.status, 200, "decodarea caii lipsea: %20 era cautat ca atare");
    // Corpul vine chunked; ne intereseaza ca a ajuns continutul, nu incadrarea.
    assert.ok(response.body.includes("PNG"), response.body);
  } finally {
    await app.dispose();
  }
});

test("S3: implicit se asculta doar pe loopback", async () => {
  const base = mkdtempSync(join(tmpdir(), "raptor-dev-bind-"));
  writeFileSync(join(base, "main.ts"), "export const a = 1;\n");
  const server = startDevServer({ entry: join(base, "main.ts"), root: base, port: 0 });
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    assert.equal(address.address, "127.0.0.1", "un server de dezvoltare nu se expune retelei de la sine");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});
