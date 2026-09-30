/**
 * The bridge transport.
 *
 * The interface is intentionally narrow - lines of text, one way and the other.
 * The native host will implement it over its own channel (stdio, socket or the
 * WebView's messages) without changing anything in the bridge or the app.
 */
import { HostError } from "./errors.ts";

export interface HostTransport {
  send(line: string): void;
  onMessage(listener: (line: string) => void): void;
  close(): void;
  readonly closed: boolean;
}

/**
 * An in-memory pair: one endpoint for JS, one for the host.
 *
 * Delivery is asynchronous (microtask), not synchronous, precisely so tests
 * cannot pass by accident by relying on an ordering that a real channel - where
 * there is a process and a queue between the endpoints - does not guarantee.
 */
export function createMemoryChannel(): { readonly app: HostTransport; readonly host: HostTransport } {
  const listeners: { app: Array<(line: string) => void>; host: Array<(line: string) => void> } = { app: [], host: [] };
  let closed = false;

  const endpoint = (self: "app" | "host", peer: "app" | "host"): HostTransport => ({
    send(line: string): void {
      if (closed) {
        throw new HostError("raptor:host/transport-closed", "the channel to the host is closed", { from: self });
      }
      queueMicrotask(() => {
        if (closed) return;
        for (const listener of [...listeners[peer]]) listener(line);
      });
    },
    onMessage(listener: (line: string) => void): void {
      listeners[self].push(listener);
    },
    close(): void {
      closed = true;
      listeners.app.length = 0;
      listeners.host.length = 0;
    },
    get closed(): boolean {
      return closed;
    },
  });

  return { app: endpoint("app", "host"), host: endpoint("host", "app") };
}
