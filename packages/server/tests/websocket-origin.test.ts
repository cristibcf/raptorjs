/**
 * Regresie pentru auditul din 2026-09-24 (S7): handshake-ul WebSocket accepta
 * orice origine.
 *
 * Contextul, pentru cine citeste peste un an: politica same-origin a browserului
 * NU se aplica la WebSocket. O pagina de pe `evil.example` poate deschide o
 * conexiune catre un server Raptor la care ajunge - inclusiv `ws://localhost` -
 * si o face cu autoritatea ambientala a utilizatorului. Singurul loc unde asta
 * poate fi oprit este serverul.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { raptorServer, serveOverWebSocket, originAllowed } from "../src/index.ts";
import type { WebSocketOptions } from "../src/index.ts";

/* ------------------------------------------------- regula, fara socket ---- */

test("S7: implicit trece doar same-origin", () => {
  assert.equal(originAllowed("https://app.example:8443", "app.example:8443", undefined), true);
  assert.equal(originAllowed("https://evil.example", "app.example:8443", undefined), false);
  // Autoritatea se compara, nu sirul: `Origin` poarta schema, `Host` nu.
  assert.equal(originAllowed("http://app.example", "app.example", undefined), true);
  assert.equal(originAllowed("https://APP.example", "app.example", undefined), true, "gazdele nu tin de registru");
});

test("S7: un client care nu e browser (fara Origin) nu e blocat", () => {
  // O unealta CLI sau alt serviciu nu poarta autoritate ambientala, deci nu e
  // amenintarea de care apara regula asta. Autentificarea ramane la `authorize`.
  assert.equal(originAllowed(undefined, "app.example", undefined), true);
  assert.equal(originAllowed("", "app.example", undefined), true);
});

test("S7: o origine pe care nu o putem citi este refuzata, nu ghicita", () => {
  // `Origin: null` vine din iframe-uri sandbox si din redirect-uri cross-origin.
  assert.equal(originAllowed("null", "app.example", undefined), false);
  assert.equal(originAllowed("nu-e-un-url", "app.example", undefined), false);
  assert.equal(originAllowed("https://app.example", undefined, undefined), false, "fara Host nu avem cu ce compara");
});

test("S7: o lista explicita inlocuieste regula same-origin", () => {
  const allowed = ["https://app.example", "https://studio.example"];
  assert.equal(originAllowed("https://studio.example", "api.example", allowed), true);
  assert.equal(originAllowed("https://api.example", "api.example", allowed), false, "lista e lista, nu o completare");
});

test('S7: "any" dezactiveaza verificarea, si trebuie scris in litere', () => {
  assert.equal(originAllowed("https://evil.example", "app.example", "any"), true);
});

/* ------------------------------------------------- handshake-ul real ------ */

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

/** Trimite un handshake WebSocket brut si intoarce linia de stare. */
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

test("S7: o pagina straina primeste 403, nu 101", async () => {
  const server = await live();
  try {
    const strain = await handshake(server.port, { Origin: "https://evil.example" });
    assert.match(strain, /403/, `o origine straina nu are voie sa faca upgrade: ${strain}`);

    const propriu = await handshake(server.port, { Origin: `http://127.0.0.1:${server.port}` });
    assert.match(propriu, /101/, `same-origin trebuie sa treaca: ${propriu}`);

    const faraOrigin = await handshake(server.port, {});
    assert.match(faraOrigin, /101/, `un client fara Origin nu e o pagina straina: ${faraOrigin}`);
  } finally {
    await server.dispose();
  }
});

test("S7: peste plafon, o conexiune noua primeste 503", async () => {
  const server = await live({ maxConnections: 1 });
  const deschise: ReturnType<typeof connect>[] = [];
  try {
    // Prima ocupa singurul loc si RAMANE deschisa.
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
    assert.match(aDoua, /503/, `plafonul trebuie sa raspunda, nu sa atarne: ${aDoua}`);
  } finally {
    for (const socket of deschise) socket.destroy();
    await server.dispose();
  }
});
