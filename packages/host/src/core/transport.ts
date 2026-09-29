/**
 * Transportul puntii.
 *
 * Interfata este ingusta intentionat - linii de text, intr-un sens si in
 * celalalt. Host-ul nativ o va implementa peste canalul lui (stdio, socket sau
 * mesajele WebView-ului) fara sa schimbe nimic din punte sau din aplicatie.
 */
import { HostError } from "./errors.ts";

export interface HostTransport {
  send(line: string): void;
  onMessage(listener: (line: string) => void): void;
  close(): void;
  readonly closed: boolean;
}

/**
 * Pereche in memorie: un capat pentru JS, unul pentru host.
 *
 * Livrarea este asincrona (microtask), nu sincrona, tocmai ca testele sa nu
 * poata trece accidental bazandu-se pe o ordine pe care un canal real - unde
 * exista un proces si o coada intre capete - nu o garanteaza.
 */
export function createMemoryChannel(): { readonly app: HostTransport; readonly host: HostTransport } {
  const listeners: { app: Array<(line: string) => void>; host: Array<(line: string) => void> } = { app: [], host: [] };
  let closed = false;

  const endpoint = (self: "app" | "host", peer: "app" | "host"): HostTransport => ({
    send(line: string): void {
      if (closed) {
        throw new HostError("raptor:host/transport-closed", "canalul catre host este inchis", { from: self });
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
