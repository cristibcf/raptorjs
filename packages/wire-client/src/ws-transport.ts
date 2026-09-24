/**
 * Transport RaptorWire peste WebSocket. Foloseste doar globalul `WebSocket`
 * (browser, si Node >= 22), deci fisierul asta ramane sigur de bundle-uit -
 * nimic din node: aici.
 *
 * Perechea lui pe server e `serveOverWebSocket` din @raptor/server.
 */
import { type Transport } from "./transport.ts";

export interface WebSocketTransportOptions {
  /** Cat asteptam deschiderea conexiunii, ms (implicit 10000). */
  timeoutMs?: number;
  /** Notificat cand conexiunea cade - momentul in care pornesti `resume`. */
  onClose?: () => void;
}

/**
 * Deschide o conexiune si se rezolva cand e gata de trimis. Respinge daca
 * socket-ul esueaza sau nu se deschide la timp, ca apelantul sa poata reincerca
 * in loc sa astepte la nesfarsit.
 */
export function connectWebSocket(url: string, options: WebSocketTransportOptions = {}): Promise<Transport> {
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise<Transport>((resolve, reject) => {
    const socket = new WebSocket(url);
    // Fara asta `event.data` vine ca Blob in browser si ar trebui citit async.
    socket.binaryType = "arraybuffer";

    let handler: ((data: Uint8Array) => void) | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`WebSocket nu s-a deschis in ${timeoutMs} ms: ${url}`));
    }, timeoutMs);

    socket.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) handler?.(new Uint8Array(data));
      // Orice altceva (text) nu e RaptorWire: il ignoram.
    };

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`WebSocket a esuat: ${url}`));
    };

    socket.onclose = () => {
      clearTimeout(timer);
      options.onClose?.();
    };

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        send(data) {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        },
        onMessage(fn) {
          handler = fn;
        },
        close() {
          socket.close();
        },
      });
    };
  });
}
