/**
 * Transport - a duplex channel of binary messages. RaptorWire is not tied to a
 * specific transport (whitepaper 17); this MVP ships an in-memory loopback used
 * by tests and demos, plus a byte counter for "measure everything" (P8).
 */

export interface Transport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

export interface LoopbackStats {
  /** bytes sent client -> server */
  clientToServerBytes: number;
  /** bytes sent server -> client */
  serverToClientBytes: number;
  clientToServerMessages: number;
  serverToClientMessages: number;
}

class LoopbackEnd implements Transport {
  private handler: ((data: Uint8Array) => void) | null = null;
  peer!: LoopbackEnd;
  onSend: (bytes: number) => void = () => {};
  private closed = false;

  send(data: Uint8Array): void {
    if (this.closed) return;
    this.onSend(data.length);
    // Copy + async delivery to mimic the ordering of a real network.
    const copy = data.slice();
    queueMicrotask(() => {
      if (!this.peer.closed) this.peer.handler?.(copy);
    });
  }
  onMessage(handler: (data: Uint8Array) => void): void {
    this.handler = handler;
  }
  close(): void {
    this.closed = true;
  }
  get isClosed(): boolean {
    return this.closed;
  }
}

export interface Loopback {
  client: Transport;
  server: Transport;
  stats: LoopbackStats;
}

/** Create a pair of in-memory connected transports. */
export function createLoopback(): Loopback {
  const client = new LoopbackEnd();
  const server = new LoopbackEnd();
  client.peer = server;
  server.peer = client;

  const stats: LoopbackStats = {
    clientToServerBytes: 0,
    serverToClientBytes: 0,
    clientToServerMessages: 0,
    serverToClientMessages: 0,
  };
  client.onSend = (n) => {
    stats.clientToServerBytes += n;
    stats.clientToServerMessages++;
  };
  server.onSend = (n) => {
    stats.serverToClientBytes += n;
    stats.serverToClientMessages++;
  };

  return { client, server, stats };
}

/** Wait for the microtask queue to drain (loopback delivery). */
export function flushLoopback(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => queueMicrotask(() => resolve())));
}
