/**
 * Regresii pe framing-ul WebSocket, la nivel de socket brut.
 *
 * Testele din `websocket.test.ts` trec prin clientul real, deci fiecare mesaj
 * incape intr-o singura bucata TCP - exact calea pe care reasamblarea NU se
 * exercita. Aici conducem noi socket-ul, ca sa controlam cum se rupe fluxul:
 * un cadru livrat octet cu octet, un cadru mare rupt in multe bucati, si un
 * mesaj fragmentat (FIN=0 + continuari). Toate trei trebuie sa ajunga intacte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect as netConnect, type AddressInfo, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { raptorServer, serveOverWebSocket, type RaptorServer } from "../src/index.ts";

const OP_BINARY = 0x2;
const OP_CONTINUATION = 0x0;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Cadru client -> server: mereu mascat (RFC 6455 5.1). */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length;
  const header = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(header + 4 + len);
  frame[0] = (fin ? 0x80 : 0x00) | opcode;
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
  }
  const mask = randomBytes(4);
  mask.copy(frame, header);
  for (let i = 0; i < len; i++) frame[header + 4 + i] = payload[i]! ^ mask[i & 3]!;
  return frame;
}

interface Harness {
  socket: Socket;
  /** Mesajele complete pe care serverul le-a predat aplicatiei. */
  received: Uint8Array[];
}

/**
 * Porneste un server, face handshake-ul pe un socket brut si intercepteaza
 * mesajele reasamblate inainte sa intre in protocolul RaptorWire - ne intereseaza
 * strict ca octetii au ajuns intregi, nu ce inseamna ei.
 */
async function withRawSocket(run: (h: Harness) => Promise<void>): Promise<void> {
  const app: RaptorServer = raptorServer({ build: "framing-test" });
  const received: Uint8Array[] = [];

  const http: Server = createServer((_req, res) => res.end("ok"));
  const ws = serveOverWebSocket(app, http, { pingIntervalMs: 0 });

  // `serve()` e ce leaga transportul de protocol; il inlocuim ca sa vedem
  // mesajul brut reasamblat, fara sa fim opriti de validarea de protocol.
  app.serve = ((connection: { onMessage(fn: (d: Uint8Array) => void): void }) => {
    connection.onMessage((data) => {
      received.push(new Uint8Array(data));
    });
    return () => {};
  }) as typeof app.serve;

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;

  const socket = netConnect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const key = randomBytes(16).toString("base64");
  socket.write(
    `GET /raptor HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  );

  const expected = createHash("sha1").update(key + GUID).digest("base64");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("handshake nu a raspuns")), 3000);
    socket.once("data", (d: Buffer) => {
      clearTimeout(timer);
      const text = d.toString("latin1");
      assert.ok(text.startsWith("HTTP/1.1 101"), "serverul accepta upgrade-ul");
      assert.ok(text.includes(expected), "Sec-WebSocket-Accept este cel din RFC 6455");
      resolve();
    });
  });

  try {
    await run({ socket, received });
  } finally {
    socket.destroy();
    ws.close();
    http.close();
  }
}

async function until(check: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout asteptand: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("un cadru livrat octet cu octet se reasambleaza intact", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const payload = Buffer.from("raptorwire peste granite de bucata", "utf8");
    const frame = maskedFrame(OP_BINARY, payload);

    // Cazul cel mai neplacut pentru orice parser: fiecare octet e un eveniment
    // `data` separat, deci antetul insusi e rupt in bucati.
    for (const byte of frame) socket.write(Buffer.from([byte]));

    await until(() => received.length === 1, "mesajul reasamblat");
    assert.deepEqual(Buffer.from(received[0]!), payload);
  });
});

test("un cadru mare rupt in multe bucati ajunge intreg", async () => {
  await withRawSocket(async ({ socket, received }) => {
    // Peste 65536 => antet pe 64 de biti, deci si calea `len === 127`.
    const payload = randomBytes(400_000);
    const frame = maskedFrame(OP_BINARY, payload);

    const CHUNK = 4096;
    for (let i = 0; i < frame.length; i += CHUNK) {
      socket.write(frame.subarray(i, Math.min(i + CHUNK, frame.length)));
    }

    await until(() => received.length === 1, "mesajul mare reasamblat");
    assert.equal(received[0]!.length, payload.length);
    assert.ok(Buffer.from(received[0]!).equals(payload), "octetii sunt identici");
  });
});

test("un mesaj fragmentat (FIN=0 + continuari) se recompune in ordine", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const parts = [Buffer.from("unu|"), Buffer.from("doi|"), Buffer.from("trei")];
    socket.write(maskedFrame(OP_BINARY, parts[0]!, false));
    socket.write(maskedFrame(OP_CONTINUATION, parts[1]!, false));
    socket.write(maskedFrame(OP_CONTINUATION, parts[2]!, true));

    await until(() => received.length === 1, "mesajul fragmentat");
    assert.equal(Buffer.from(received[0]!).toString(), "unu|doi|trei");
  });
});

test("doua cadre intr-o singura bucata TCP produc doua mesaje", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const a = maskedFrame(OP_BINARY, Buffer.from("primul"));
    const b = maskedFrame(OP_BINARY, Buffer.from("al doilea"));
    socket.write(Buffer.concat([a, b]));

    await until(() => received.length === 2, "ambele mesaje");
    assert.equal(Buffer.from(received[0]!).toString(), "primul");
    assert.equal(Buffer.from(received[1]!).toString(), "al doilea");
  });
});

test("un mesaj fragmentat nemarginit inchide conexiunea in loc sa umple memoria", async () => {
  await withRawSocket(async ({ socket, received }) => {
    // Fiecare cadru e mult sub MAX_FRAME_BYTES; doar totalul depaseste plafonul.
    // Fara limita pe mesajul reasamblat, bucla asta ar rula pana la OOM.
    const part = randomBytes(1024 * 1024);
    let closed = false;
    socket.on("close", () => (closed = true));
    socket.on("error", () => (closed = true));

    for (let i = 0; i < 24 && !closed; i++) {
      socket.write(maskedFrame(i === 0 ? OP_BINARY : OP_CONTINUATION, part, false));
      await new Promise((r) => setTimeout(r, 10));
    }

    await until(() => closed, "conexiunea inchisa de server");
    assert.equal(received.length, 0, "niciun mesaj nu a fost predat aplicatiei");
  });
});
