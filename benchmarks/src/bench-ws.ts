/**
 * Cat costa reasamblarea unui mesaj WebSocket mare care soseste in bucati mici.
 *
 * Varianta cu `Buffer.concat` la fiecare eveniment `data` este patratica: pentru
 * un mesaj de N octeti in bucati de C, copiaza ~N^2/(2C) octeti. Varianta cu
 * acumulator de bucati copiaza N. Diferenta se vede abia la mesaje mari rupte
 * marunt - adica exact traficul RaptorWire pe o conexiune reala.
 *
 * Rulare: node src/bench-ws.ts
 */
import { createServer, type Server } from "node:http";
import { connect as netConnect, type AddressInfo, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { raptorServer, serveOverWebSocket } from "../../packages/server/src/index.ts";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP_BINARY = 0x2;

const MESSAGE_BYTES = 8 * 1024 * 1024;
const CHUNK_SIZES = [4 * 1024, 16 * 1024, 64 * 1024];
const REPEATS = 5;

function maskedFrame(payload: Buffer): Buffer {
  const len = payload.length;
  const frame = Buffer.allocUnsafe(10 + 4 + len);
  frame[0] = 0x80 | OP_BINARY;
  frame[1] = 0x80 | 127;
  frame.writeUInt32BE(0, 2);
  frame.writeUInt32BE(len, 6);
  const mask = randomBytes(4);
  mask.copy(frame, 10);
  for (let i = 0; i < len; i++) frame[14 + i] = payload[i]! ^ mask[i & 3]!;
  return frame;
}

async function withSocket(
  run: (socket: Socket, seen: () => number) => Promise<void>,
): Promise<void> {
  const app = raptorServer({ build: "ws-bench" });
  let count = 0;
  app.serve = ((connection: { onMessage(fn: (d: Uint8Array) => void): void }) => {
    connection.onMessage(() => {
      count++;
    });
    return () => {};
  }) as typeof app.serve;

  const http: Server = createServer((_req, res) => res.end("ok"));
  const ws = serveOverWebSocket(app, http, { pingIntervalMs: 0 });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;

  const socket = netConnect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const key = randomBytes(16).toString("base64");
  socket.write(
    `GET /raptor HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("handshake timeout")), 5000);
    socket.once("data", (d: Buffer) => {
      clearTimeout(timer);
      if (!d.toString("latin1").includes(accept)) reject(new Error("handshake invalid"));
      else resolve();
    });
  });

  try {
    await run(socket, () => count);
  } finally {
    socket.destroy();
    ws.close();
    http.close();
  }
}

async function measure(chunkSize: number): Promise<number> {
  let best = Infinity;
  for (let round = 0; round < REPEATS; round++) {
    await withSocket(async (socket, seen) => {
      const frame = maskedFrame(randomBytes(MESSAGE_BYTES));
      const before = seen();
      const started = performance.now();
      for (let i = 0; i < frame.length; i += chunkSize) {
        socket.write(frame.subarray(i, Math.min(i + chunkSize, frame.length)));
      }
      const deadline = Date.now() + 60_000;
      while (seen() === before) {
        if (Date.now() > deadline) throw new Error("mesajul nu a ajuns");
        await new Promise((r) => setImmediate(r));
      }
      best = Math.min(best, performance.now() - started);
    });
  }
  return best;
}

const mb = MESSAGE_BYTES / (1024 * 1024);
console.log(`\nReasamblare mesaj WebSocket de ${mb} MB (minim din ${REPEATS} rulari)\n`);
console.log("bucata TCP".padEnd(14) + "timp".padStart(12) + "debit".padStart(16));
console.log("-".repeat(42));
for (const chunk of CHUNK_SIZES) {
  const ms = await measure(chunk);
  const throughput = mb / (ms / 1000);
  console.log(
    `${chunk / 1024} KB`.padEnd(14) +
      `${ms.toFixed(1)} ms`.padStart(12) +
      `${throughput.toFixed(0)} MB/s`.padStart(16),
  );
}
console.log("");
