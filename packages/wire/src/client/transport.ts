/**
 * Transport - un canal duplex de mesaje binare. RaptorWire nu e legat de un
 * transport anume (whitepaper 17); acest MVP livreaza un loopback in-memory
 * folosit de teste si demo-uri, plus un contor de octeti pentru "measure
 * everything" (P8).
 */

export interface Transport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

export interface LoopbackStats {
  /** octeti trimisi client -> server */
  clientToServerBytes: number;
  /** octeti trimisi server -> client */
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
    // Copie + livrare asincrona pentru a imita ordonarea unei retele reale.
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

/** Creeaza o pereche de transporturi conectate in-memory. */
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

/** Asteapta drenarea cozii de microtask-uri (livrarea loopback). */
export function flushLoopback(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => queueMicrotask(() => resolve())));
}
