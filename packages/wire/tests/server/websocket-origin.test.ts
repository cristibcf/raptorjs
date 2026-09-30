/**
 * Regression for the 2026-09-24 audit (S7): the WebSocket handshake accepted
 * any origin.
 *
 * The context, for whoever reads this in a year: the browser's same-origin
 * policy does NOT apply to WebSocket. A page on `evil.example` can open a
 * connection to a Raptor server it can reach - including `ws://localhost` - and
 * does so with the user's ambient authority. The only place this can be stopped
 * is the server.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { raptorServer, serveOverWebSocket, originAllowed } from "../../src/server/index.ts";
import type { WebSocketOptions } from "../../src/server/index.ts";

/* ------------------------------------------------- the rule, no socket ---- */

test("S7: by default only same-origin passes", () => {
  assert.equal(originAllowed("https://app.example:8443", "app.example:8443", undefined), true);
  assert.equal(originAllowed("https://evil.example", "app.example:8443", undefined), false);
  // The authority is compared, not the string: `Origin` carries the scheme, `Host` does not.
  assert.equal(originAllowed("http://app.example", "app.example", undefined), true);
  assert.equal(originAllowed("https://APP.example", "app.example", undefined), true, "hosts are case-insensitive");
});

test("S7: a non-browser client (no Origin) is not blocked", () => {
  // A CLI tool or another service carries no ambient authority, so it's not the
  // threat this rule defends against. Authentication stays with `authorize`.
  assert.equal(originAllowed(undefined, "app.example", undefined), true);
  assert.equal(originAllowed("", "app.example", undefined), true);
});

test("S7: an origin we cannot read is denied, not guessed", () => {
  // `Origin: null` comes from sandboxed iframes and cross-origin redirects.
  assert.equal(originAllowed("null", "app.example", undefined), false);
  assert.equal(originAllowed("not-a-url", "app.example", undefined), false);
  assert.equal(originAllowed("https://app.example", undefined, undefined), false, "without a Host we have nothing to compare against");
});

test("S7: an explicit list replaces the same-origin rule", () => {
  const allowed = ["https://app.example", "https://studio.example"];
  assert.equal(originAllowed("https://studio.example", "api.example", allowed), true);
  assert.equal(originAllowed("https://api.example", "api.example", allowed), false, "the list is the list, not an addition");
});

test('S7: "any" disables the check, and must be spelled out in letters', () => {
  assert.equal(originAllowed("https://evil.example", "app.example", "any"), true);
});

/* ------------------------------------------------- the real handshake ----- */

interface Live {
  readonly port: number;
  dispose(): Promise<void>;
}

async function live(options: WebSocketOptions = {}): Promise<Live> {
  const app = raptorServer();
  const http = createServer();
  const handle = serveOverWebSocket(app, http, options);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    dispose: async () => {
      handle.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** Send a raw WebSocket handshake and return the status line. */
function handshake(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      const lines = [
        "GET /raptor HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(buffer.split("\r\n")[0] ?? "");
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(buffer.split("\r\n")[0] ?? ""));
  });
}

test("S7: a foreign page gets 403, not 101", async () => {
  const server = await live();
  try {
    const strain = await handshake(server.port, { Origin: "https://evil.example" });
    assert.match(strain, /403/, `a foreign origin must not be allowed to upgrade: ${strain}`);

    const propriu = await handshake(server.port, { Origin: `http://127.0.0.1:${server.port}` });
    assert.match(propriu, /101/, `same-origin must pass: ${propriu}`);

    const faraOrigin = await handshake(server.port, {});
    assert.match(faraOrigin, /101/, `a client without an Origin is not a foreign page: ${faraOrigin}`);
  } finally {
    await server.dispose();
  }
});

test("S7: over the cap, a new connection gets 503", async () => {
  const server = await live({ maxConnections: 1 });
  const deschise: ReturnType<typeof connect>[] = [];
  try {
    // The first takes the only slot and STAYS open.
    const prima = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.port, "127.0.0.1", () => {
        socket.write(
          [
            "GET /raptor HTTP/1.1",
            `Host: 127.0.0.1:${server.port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "",
            "",
          ].join("\r\n"),
        );
      });
      deschise.push(socket);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => resolve(chunk.split("\r\n")[0] ?? ""));
      socket.on("error", reject);
    });
    assert.match(prima, /101/);

    const aDoua = await handshake(server.port, {});
    assert.match(aDoua, /503/, `the cap must respond, not hang: ${aDoua}`);
  } finally {
    for (const socket of deschise) socket.destroy();
    await server.dispose();
  }
});
