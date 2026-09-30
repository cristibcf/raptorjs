/**
 * RaptorWire transport over WebSocket. Uses only the global `WebSocket`
 * (browser, and Node >= 22), so this file stays safe to bundle - nothing from
 * node: here.
 *
 * Its counterpart on the server is `serveOverWebSocket` from @raptorstack/wire/server.
 */
import { type Transport } from "./transport.ts";

export interface WebSocketTransportOptions {
  /** How long to wait for the connection to open, ms (default 10000). */
  timeoutMs?: number;
  /** Notified when the connection drops - the moment you start `resume`. */
  onClose?: () => void;
}

/**
 * Opens a connection and resolves when it is ready to send. Rejects if the
 * socket fails or does not open in time, so the caller can retry instead of
 * waiting forever.
 */
export function connectWebSocket(url: string, options: WebSocketTransportOptions = {}): Promise<Transport> {
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise<Transport>((resolve, reject) => {
    const socket = new WebSocket(url);
    // Without this `event.data` arrives as a Blob in the browser and would need async reading.
    socket.binaryType = "arraybuffer";

    let handler: ((data: Uint8Array) => void) | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`WebSocket did not open within ${timeoutMs} ms: ${url}`));
    }, timeoutMs);

    socket.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) handler?.(new Uint8Array(data));
      // Anything else (text) is not RaptorWire: we ignore it.
    };

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`WebSocket failed: ${url}`));
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
