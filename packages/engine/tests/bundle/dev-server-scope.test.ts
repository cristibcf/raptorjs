/**
 * Regression for the 2026-09-24 audit (S3): the dev server was serving files from
 * outside the root and listening on all interfaces.
 *
 * The requests are sent over a raw socket, not with `fetch`: Node's HTTP client
 * normalizes `..` in the path before putting it on the wire, so a test written
 * with `fetch` would have passed even with the bug in place.
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

/** A GET request with the target exactly as written, without client normalization. */
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
 * `<tmp>/app` is the served root. Next to it, two traps:
 * `<tmp>/app-privat` (a sibling with a common prefix) and `<tmp>/app/.env`
 * (hidden INSIDE the root - the genuinely common case).
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

test("S3: cannot escape the root to a sibling directory with a common prefix", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/../app-privat/.env");
    assert.notEqual(response.status, 200, `served a file from outside the root: ${response.body}`);
    assert.ok(!response.body.includes("SECRET_VECIN"), "the neighbor's content must not go out on the wire");
  } finally {
    await app.dispose();
  }
});

test("S3: not even percent-encoded", async () => {
  const app = await fixture();
  try {
    for (const target of ["/..%2Fapp-privat%2F.env", "/%2e%2e/app-privat/.env", "/..%5Capp-privat%5C.env"]) {
      const response = await raw(app.port, target);
      assert.notEqual(response.status, 200, `${target} got through`);
      assert.ok(!response.body.includes("SECRET_VECIN"), `${target} leaked content`);
    }
  } finally {
    await app.dispose();
  }
});

test("S3: hidden files in the root are not served", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/.env");
    assert.notEqual(response.status, 200);
    assert.ok(!response.body.includes("SECRET_LOCAL"));
  } finally {
    await app.dispose();
  }
});

test("S3: sources go through the bundle, they are not served as files", async () => {
  const app = await fixture();
  try {
    assert.notEqual((await raw(app.port, "/main.ts")).status, 200);
  } finally {
    await app.dispose();
  }
});

test("S3: a legitimate asset with a space in its name is served (the path is decoded)", async () => {
  const app = await fixture();
  try {
    const response = await raw(app.port, "/logo%20mic.png");
    assert.equal(response.status, 200, "path decoding was missing: %20 was looked up literally");
    // The body comes chunked; what matters is that the content arrived, not the framing.
    assert.ok(response.body.includes("PNG"), response.body);
  } finally {
    await app.dispose();
  }
});

test("S3: by default it listens only on loopback", async () => {
  const base = mkdtempSync(join(tmpdir(), "raptor-dev-bind-"));
  writeFileSync(join(base, "main.ts"), "export const a = 1;\n");
  const server = startDevServer({ entry: join(base, "main.ts"), root: base, port: 0 });
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    assert.equal(address.address, "127.0.0.1", "a dev server does not expose itself to the network on its own");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});
