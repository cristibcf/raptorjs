/**
 * WebSocket transport for RaptorWire (whitepaper 17: the protocol is not tied to
 * a specific transport). Implements RFC 6455 directly on the node:http socket -
 * handshake, framing, mask, ping/pong, close - to keep zero runtime
 * dependencies. It is not a general-purpose WebSocket server: it carries binary
 * frames between `RaptorServer.serve()` and a client, nothing more.
 */
import { createHash } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { RaptorServer } from "./server.ts";
import type { ServerConnection } from "./store.ts";

/** Constant from RFC 6455 4.2.2: concatenated to the client's key for the accept. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONTINUATION = 0x0;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Beyond this we close the connection instead of allocating: an honest client won't send it. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** The same cap, but on the message reassembled from several fragmented frames. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export interface WebSocketOptions {
  /** The path on which upgrades are accepted (default "/raptor"). */
  path?: string;
  /** Keep-alive ping interval, ms (default 30000; 0 disables). */
  pingIntervalMs?: number;
  /**
   * The origins from which browsers may open connections.
   *
   * **Default: same-origin only.** Unlike `fetch`, a WebSocket is NOT stopped by
   * the browser's same-origin policy: any page the user opens can open a
   * connection to a Raptor server it can reach, cookies and all (cross-site
   * WebSocket hijacking). The only place to stop this is here.
   *
   * An explicit list (`["https://app.example.com"]`) is compared exactly,
   * ignoring letter case. `"any"` disables the check - spelled out in letters,
   * so it can't happen by accident.
   *
   * A request **without** an `Origin` header passes: it does not come from a
   * browser, so it carries no ambient session authority. Authentication remains
   * the job of the per-query/mutation `authorize` hooks.
   */
  allowedOrigins?: readonly string[] | "any";
  /** Cap on concurrent connections (default 1024; 0 = no cap). */
  maxConnections?: number;
}

/**
 * `true` if the upgrade is allowed from the request's origin.
 *
 * Exported so it can be tested without a socket - it is a pure function, and it
 * is the one piece of the handshake where a mistake only shows up in a bug
 * report.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[] | "any" | undefined,
): boolean {
  if (allowed === "any") return true;
  // No `Origin`: a non-browser client (CLI, another service, a test).
  if (origin === undefined || origin === "") return true;

  if (allowed !== undefined) {
    const wanted = origin.toLowerCase();
    return allowed.some((candidate) => candidate.toLowerCase() === wanted);
  }

  // Default same-origin: we compare the AUTHORITY, not the string. `Origin`
  // carries the scheme (`https://app:8443`), `Host` does not (`app:8443`).
  if (host === undefined) return false;
  let authority: string;
  try {
    authority = new URL(origin).host;
  } catch {
    // `Origin: null` (sandbox, cross-origin redirect) and any other form we
    // cannot read: we deny, we don't guess.
    return false;
  }
  return authority.toLowerCase() === host.toLowerCase();
}

/** Server -> client frame: unmasked (RFC 6455 5.1), 7/16/64-bit length. */
function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  const len = payload.length;
  const header = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(header + len);
  frame[0] = 0x80 | opcode; // FIN + opcode; we don't fragment on send
  if (len < 126) {
    frame[1] = len;
  } else if (len < 65536) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    // The length is a u64; the high part is always 0 under MAX_FRAME_BYTES.
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(len, 6);
  }
  if (len > 0) frame.set(payload, header);
  return frame;
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  /** The bytes consumed from the buffer. */
  size: number;
}

/**
 * Bytes received but not yet consumed, kept as a list of chunks.
 *
 * The obvious variant - a single Buffer and `Buffer.concat` on every `data`
 * event - sits on the RaptorWire hot path and is quadratic: a 16 MB message
 * arriving in 64 KB TCP chunks means 256 concatenations, each copying
 * everything accumulated so far, on the order of 2 GB of memcpy for 16 MB.
 *
 * Here chunks only enter the list (zero copy) and are materialized just once,
 * when a complete frame actually exists: each byte is copied exactly once. The
 * header is read with `byteAt`, without joining anything.
 */
class FrameBuffer {
  private chunks: Buffer[] = [];
  private total = 0;

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.total += chunk.length;
  }

  get size(): number {
    return this.total;
  }

  /** The byte at an absolute offset, without joining the chunks. */
  byteAt(index: number): number {
    let rest = index;
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      if (rest < chunk.length) return chunk[rest]!;
      rest -= chunk.length;
    }
    throw new RangeError("[ws] offset out of buffer bounds");
  }

  /** Take the first `n` bytes as a contiguous buffer. At most one copy. */
  take(n: number): Buffer {
    const first = this.chunks[0]!;
    // The common case: the frame arrived whole in one chunk - no copy at all.
    if (first.length >= n) {
      const out = first.subarray(0, n);
      if (first.length === n) this.chunks.shift();
      else this.chunks[0] = first.subarray(n);
      this.total -= n;
      return out;
    }
    const out = Buffer.allocUnsafe(n);
    let filled = 0;
    while (filled < n) {
      const chunk = this.chunks[0]!;
      const needed = n - filled;
      if (chunk.length <= needed) {
        chunk.copy(out, filled);
        filled += chunk.length;
        this.chunks.shift();
      } else {
        chunk.copy(out, filled, 0, needed);
        this.chunks[0] = chunk.subarray(needed);
        filled = n;
      }
    }
    this.total -= n;
    return out;
  }
}

/**
 * Try to read a complete frame from the start of the accumulator. Returns null
 * when not all bytes have arrived yet - TCP does not guarantee a frame arrives
 * in a single chunk, so the bytes stay put and it retries.
 */
function readFrame(buf: FrameBuffer): ParsedFrame | null {
  if (buf.size < 2) return null;
  const b0 = buf.byteAt(0);
  const b1 = buf.byteAt(1);
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.size < offset + 2) return null;
    len = (buf.byteAt(2) << 8) | buf.byteAt(3);
    offset += 2;
  } else if (len === 127) {
    if (buf.size < offset + 8) return null;
    let high = 0;
    for (let i = 2; i < 6; i++) high = high * 256 + buf.byteAt(i);
    let low = 0;
    for (let i = 6; i < 10; i++) low = low * 256 + buf.byteAt(i);
    if (high !== 0 || low > MAX_FRAME_BYTES) throw new Error("frame too large");
    len = low;
    offset += 8;
  }
  if (len > MAX_FRAME_BYTES) throw new Error("frame too large");

  // Client -> server frames must be masked (RFC 6455 5.1).
  if (!masked) throw new Error("unmasked frame from client");

  const size = offset + 4 + len;
  // The key to the optimization: while the frame is incomplete we copy NOTHING, we just wait.
  if (buf.size < size) return null;

  const raw = buf.take(size);
  const mask = raw.subarray(offset, offset + 4);
  const start = offset + 4;
  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = raw[start + i]! ^ mask[i & 3]!;
  return { fin, opcode, payload, size };
}

export interface WebSocketHandle {
  /** How many WebSocket connections are open right now. */
  readonly connectionCount: number;
  /**
   * Close all connections and stop accepting upgrades. Needed for a clean
   * shutdown: after an upgrade the socket is no longer tracked by the HTTP
   * server, so `httpServer.close()` alone leaves it open and the process won't exit.
   */
  close(): void;
}

/**
 * Attach `app` to an HTTP server: each accepted upgrade becomes a RaptorWire
 * connection served by `app.serve()`.
 */
export function serveOverWebSocket(
  app: RaptorServer,
  httpServer: HttpServer,
  options: WebSocketOptions = {},
): WebSocketHandle {
  const path = options.path ?? "/raptor";
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  const maxConnections = options.maxConnections ?? 1024;
  const live = new Set<Socket>();

  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const url = (req.url ?? "/").split("?")[0];
    const key = req.headers["sec-websocket-key"];
    if (url !== path || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    // The origin is checked BEFORE `101`: after the upgrade there is no longer a
    // status code in which to fit a rejection.
    if (!originAllowed(req.headers.origin, req.headers.host, options.allowedOrigins)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    if (maxConnections > 0 && live.size >= maxConnections) {
      // 503, not 403: it's not a permission problem, and the client can retry.
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }

    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    live.add(socket);

    let handler: ((data: Uint8Array) => void) | null = null;
    // Two distinct states: `closed` = we no longer write to the socket;
    // `torndown` = we've cleaned up the subscriptions. Kept separate because a
    // clean close goes through both, and if they shared a flag the second stage
    // would be skipped.
    let closed = false;
    let torndown = false;
    // Bytes received but not yet consumed (incomplete frame).
    const buffer = new FrameBuffer();
    if (head && head.length > 0) buffer.push(Buffer.from(head));
    // Accumulator for fragmented frames (FIN=0 followed by continuations).
    let fragments: Buffer[] = [];
    let fragmentBytes = 0;

    const conn: ServerConnection = {
      send(data) {
        if (closed) return;
        socket.write(encodeFrame(OP_BINARY, data));
      },
      onMessage(fn) {
        handler = fn;
      },
      close() {
        if (closed) return;
        closed = true;
        socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
        socket.end();
      },
    };

    const teardown = (): void => {
      live.delete(socket);
      if (torndown) return;
      torndown = true;
      closed = true;
      // Without this the dead connection's subscriptions get a broadcast on every mutation.
      app.store.removeConnection(conn);
      socket.destroy();
    };

    socket.on("data", (chunk: Buffer) => {
      buffer.push(chunk);
      try {
        for (;;) {
          const frame = readFrame(buffer);
          if (!frame) break;

          if (frame.opcode === OP_CLOSE) {
            conn.close();
            teardown();
            return;
          }
          if (frame.opcode === OP_PING) {
            socket.write(encodeFrame(OP_PONG, frame.payload));
            continue;
          }
          if (frame.opcode === OP_PONG) continue;

          if (frame.opcode === OP_BINARY || frame.opcode === OP_CONTINUATION) {
            fragments.push(frame.payload);
            fragmentBytes += frame.payload.length;
            // Each frame is bounded by MAX_FRAME_BYTES, but a message can have
            // any number of frames: without a total limit, a client that sends
            // FIN=0 fragments forever consumes all of the host's memory.
            if (fragmentBytes > MAX_MESSAGE_BYTES) throw new Error("fragmented message too large");
            if (!frame.fin) continue;
            const message =
              fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, fragmentBytes);
            fragments = [];
            fragmentBytes = 0;
            handler?.(new Uint8Array(message));
            continue;
          }
          // Text or reserved opcode: we don't use it, we close instead of guessing.
          throw new Error(`unsupported opcode: ${frame.opcode}`);
        }
      } catch {
        teardown();
      }
    });

    socket.on("error", teardown);
    socket.on("close", teardown);

    const ping =
      pingIntervalMs > 0
        ? setInterval(() => {
            if (!closed) socket.write(encodeFrame(OP_PING, Buffer.alloc(0)));
          }, pingIntervalMs)
        : null;
    if (ping) {
      ping.unref();
      socket.on("close", () => clearInterval(ping));
    }

    app.serve(conn);
  };

  httpServer.on("upgrade", onUpgrade);

  return {
    get connectionCount() {
      return live.size;
    },
    close() {
      httpServer.off("upgrade", onUpgrade);
      for (const socket of [...live]) socket.destroy();
      live.clear();
    },
  };
}
