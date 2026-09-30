/**
 * Regressions on WebSocket framing, at the raw-socket level.
 *
 * The tests in `websocket.test.ts` go through the real client, so each message
 * fits in a single TCP chunk - exactly the path where reassembly is NOT
 * exercised. Here we drive the socket ourselves, to control how the stream is
 * broken up: a frame delivered byte by byte, a large frame split into many
 * chunks, and a fragmented message (FIN=0 + continuations). All three must
 * arrive intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect as netConnect, type AddressInfo, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { raptorServer, serveOverWebSocket, type RaptorServer } from "../../src/server/index.ts";

const OP_BINARY = 0x2;
const OP_CONTINUATION = 0x0;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Client -> server frame: always masked (RFC 6455 5.1). */
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
  /** The complete messages the server handed to the application. */
  received: Uint8Array[];
}

/**
 * Starts a server, does the handshake on a raw socket and intercepts the
 * reassembled messages before they enter the RaptorWire protocol - we care
 * strictly that the bytes arrived intact, not what they mean.
 */
async function withRawSocket(run: (h: Harness) => Promise<void>): Promise<void> {
  const app: RaptorServer = raptorServer({ build: "framing-test" });
  const received: Uint8Array[] = [];

  const http: Server = createServer((_req, res) => res.end("ok"));
  const ws = serveOverWebSocket(app, http, { pingIntervalMs: 0 });

  // `serve()` is what binds the transport to the protocol; we replace it to see
  // the raw reassembled message, without being stopped by protocol validation.
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
    const timer = setTimeout(() => reject(new Error("handshake did not respond")), 3000);
    socket.once("data", (d: Buffer) => {
      clearTimeout(timer);
      const text = d.toString("latin1");
      assert.ok(text.startsWith("HTTP/1.1 101"), "the server accepts the upgrade");
      assert.ok(text.includes(expected), "Sec-WebSocket-Accept is the one from RFC 6455");
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
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("a frame delivered byte by byte reassembles intact", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const payload = Buffer.from("raptorwire across chunk boundaries", "utf8");
    const frame = maskedFrame(OP_BINARY, payload);

    // The nastiest case for any parser: each byte is a separate `data` event,
    // so the header itself is split into chunks.
    for (const byte of frame) socket.write(Buffer.from([byte]));

    await until(() => received.length === 1, "the reassembled message");
    assert.deepEqual(Buffer.from(received[0]!), payload);
  });
});

test("a large frame split into many chunks arrives whole", async () => {
  await withRawSocket(async ({ socket, received }) => {
    // Over 65536 => a 64-bit header, so the `len === 127` path too.
    const payload = randomBytes(400_000);
    const frame = maskedFrame(OP_BINARY, payload);

    const CHUNK = 4096;
    for (let i = 0; i < frame.length; i += CHUNK) {
      socket.write(frame.subarray(i, Math.min(i + CHUNK, frame.length)));
    }

    await until(() => received.length === 1, "the large reassembled message");
    assert.equal(received[0]!.length, payload.length);
    assert.ok(Buffer.from(received[0]!).equals(payload), "the bytes are identical");
  });
});

test("a fragmented message (FIN=0 + continuations) is reassembled in order", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const parts = [Buffer.from("one|"), Buffer.from("two|"), Buffer.from("three")];
    socket.write(maskedFrame(OP_BINARY, parts[0]!, false));
    socket.write(maskedFrame(OP_CONTINUATION, parts[1]!, false));
    socket.write(maskedFrame(OP_CONTINUATION, parts[2]!, true));

    await until(() => received.length === 1, "the fragmented message");
    assert.equal(Buffer.from(received[0]!).toString(), "one|two|three");
  });
});

test("two frames in a single TCP chunk produce two messages", async () => {
  await withRawSocket(async ({ socket, received }) => {
    const a = maskedFrame(OP_BINARY, Buffer.from("first"));
    const b = maskedFrame(OP_BINARY, Buffer.from("second"));
    socket.write(Buffer.concat([a, b]));

    await until(() => received.length === 2, "both messages");
    assert.equal(Buffer.from(received[0]!).toString(), "first");
    assert.equal(Buffer.from(received[1]!).toString(), "second");
  });
});

test("an unbounded fragmented message closes the connection instead of filling memory", async () => {
  await withRawSocket(async ({ socket, received }) => {
    // Each frame is well under MAX_FRAME_BYTES; only the total exceeds the cap.
    // Without a limit on the reassembled message, this loop would run until OOM.
    const part = randomBytes(1024 * 1024);
    let closed = false;
    socket.on("close", () => (closed = true));
    socket.on("error", () => (closed = true));

    for (let i = 0; i < 24 && !closed; i++) {
      socket.write(maskedFrame(i === 0 ? OP_BINARY : OP_CONTINUATION, part, false));
      await new Promise((r) => setTimeout(r, 10));
    }

    await until(() => closed, "the connection closed by the server");
    assert.equal(received.length, 0, "no message was handed to the application");
  });
});
