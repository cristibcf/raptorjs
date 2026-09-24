/**
 * Transport WebSocket pentru RaptorWire (whitepaper 17: protocolul nu e legat de
 * un transport anume). Implementeaza RFC 6455 direct peste socket-ul din
 * node:http - handshake, framing, mask, ping/pong, close - ca sa pastram zero
 * dependinte de runtime. Nu e un server WebSocket de uz general: duce cadre
 * binare intre `RaptorServer.serve()` si un client, atat.
 */
import { createHash } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { RaptorServer } from "./server.ts";
import type { ServerConnection } from "./store.ts";

/** Constanta din RFC 6455 4.2.2: concatenata la cheia clientului pentru accept. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONTINUATION = 0x0;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Peste atat inchidem conexiunea in loc sa alocam: un client cinstit nu trimite. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Acelasi plafon, dar pe mesajul reasamblat din mai multe cadre fragmentate. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export interface WebSocketOptions {
  /** Calea pe care se accepta upgrade-ul (implicit "/raptor"). */
  path?: string;
  /** Interval ping keep-alive, ms (implicit 30000; 0 dezactiveaza). */
  pingIntervalMs?: number;
}

/** Cadru server -> client: nemascat (RFC 6455 5.1), lungime pe 7/16/64 biti. */
function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  const len = payload.length;
  const header = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const frame = Buffer.allocUnsafe(header + len);
  frame[0] = 0x80 | opcode; // FIN + opcode; nu fragmentam la emisie
  if (len < 126) {
    frame[1] = len;
  } else if (len < 65536) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    // Lungimea e un u64; partea inalta e mereu 0 sub MAX_FRAME_BYTES.
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
  /** Octetii consumati din buffer. */
  size: number;
}

/**
 * Octetii primiti si neconsumati inca, pastrati ca lista de bucati.
 *
 * Varianta evidenta - un singur Buffer si `Buffer.concat` la fiecare eveniment
 * `data` - sta pe hot path-ul RaptorWire si este patratica: un mesaj de 16 MB
 * sosit in bucati TCP de 64 KB inseamna 256 de concatenari, fiecare copiind tot
 * ce s-a acumulat pana atunci, adica ordinul a 2 GB de memcpy pentru 16 MB.
 *
 * Aici bucatile doar intra in lista (zero copiere) si se materializeaza o
 * singura data, cand chiar exista un cadru complet: fiecare octet e copiat
 * exact o data. Antetul se citeste cu `byteAt`, fara sa uneasca nimic.
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

  /** Octetul de la un offset absolut, fara sa uneasca bucatile. */
  byteAt(index: number): number {
    let rest = index;
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      if (rest < chunk.length) return chunk[rest]!;
      rest -= chunk.length;
    }
    throw new RangeError("[ws] offset in afara buffer-ului");
  }

  /** Scoate primii `n` octeti ca buffer contiguu. Cel mult o copiere. */
  take(n: number): Buffer {
    const first = this.chunks[0]!;
    // Cazul comun: cadrul a venit intreg intr-o bucata - nicio copiere deloc.
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
 * Incearca sa citeasca un cadru complet de la inceputul acumulatorului. Intoarce
 * null cand inca nu au sosit toti octetii - TCP nu garanteaza ca un cadru vine
 * intr-o singura bucata, asa ca octetii raman pe loc si se reincearca.
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
    if (high !== 0 || low > MAX_FRAME_BYTES) throw new Error("cadru prea mare");
    len = low;
    offset += 8;
  }
  if (len > MAX_FRAME_BYTES) throw new Error("cadru prea mare");

  // Cadrele client -> server trebuie mascate (RFC 6455 5.1).
  if (!masked) throw new Error("cadru nemascat de la client");

  const size = offset + 4 + len;
  // Cheia optimizarii: cat timp cadrul e incomplet NU copiem nimic, doar asteptam.
  if (buf.size < size) return null;

  const raw = buf.take(size);
  const mask = raw.subarray(offset, offset + 4);
  const start = offset + 4;
  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = raw[start + i]! ^ mask[i & 3]!;
  return { fin, opcode, payload, size };
}

export interface WebSocketHandle {
  /** Cate conexiuni WebSocket sunt deschise acum. */
  readonly connectionCount: number;
  /**
   * Inchide toate conexiunile si nu mai accepta upgrade-uri. Necesar pentru
   * oprire curata: dupa un upgrade socket-ul nu mai e urmarit de serverul HTTP,
   * deci `httpServer.close()` singur il lasa deschis si procesul nu iese.
   */
  close(): void;
}

/**
 * Ataseaza `app` la un server HTTP: fiecare upgrade acceptat devine o conexiune
 * RaptorWire servita de `app.serve()`.
 */
export function serveOverWebSocket(
  app: RaptorServer,
  httpServer: HttpServer,
  options: WebSocketOptions = {},
): WebSocketHandle {
  const path = options.path ?? "/raptor";
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  const live = new Set<Socket>();

  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const url = (req.url ?? "/").split("?")[0];
    const key = req.headers["sec-websocket-key"];
    if (url !== path || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
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
    // Doua stari distincte: `closed` = nu mai scriem pe socket; `torndown` = am
    // curatat subscriptiile. Tinute separat pentru ca o inchidere curata trece
    // prin amandoua, iar daca ar imparti un flag a doua etapa s-ar sari.
    let closed = false;
    let torndown = false;
    // Octeti primiti dar neconsumati inca (cadru incomplet).
    const buffer = new FrameBuffer();
    if (head && head.length > 0) buffer.push(Buffer.from(head));
    // Acumulator pentru cadre fragmentate (FIN=0 urmat de continuari).
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
      // Fara asta subscriptiile mortului primesc broadcast la fiecare mutatie.
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
            // Fiecare cadru e marginit de MAX_FRAME_BYTES, dar un mesaj poate
            // avea oricate cadre: fara o limita pe total, un client care trimite
            // la nesfarsit fragmente cu FIN=0 consuma toata memoria host-ului.
            if (fragmentBytes > MAX_MESSAGE_BYTES) throw new Error("mesaj fragmentat prea mare");
            if (!frame.fin) continue;
            const message =
              fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, fragmentBytes);
            fragments = [];
            fragmentBytes = 0;
            handler?.(new Uint8Array(message));
            continue;
          }
          // Text sau opcode rezervat: nu-l folosim, inchidem in loc sa ghicim.
          throw new Error(`opcode nesuportat: ${frame.opcode}`);
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
