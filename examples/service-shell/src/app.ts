/**
 * Aceeasi aplicatie, a patra oara: acum ca serviciu HTTP.
 *
 * Ce ramane identic fata de `desktop-shell`, `mobile-shell` si `web-shell`:
 * starea traieste in semnale `@raptor/core`, iar tot ce tine de platforma trece
 * prin `bridge`. Ce se schimba este forma interactiunii - aici nu exista DOM si
 * nici utilizator, ci cereri care intra si raspunsuri care ies.
 *
 * Cererile vin ca evenimente `serve.request` si pleaca prin `serve.respond`,
 * pentru ca puntea transporta doar JSON. Asta pare un ocol fata de un handler
 * apelat direct, dar este exact drumul pe care il va face o cerere cand host-ul
 * va fi un proces separat - deci codul de aici nu se schimba atunci.
 */
import { derived, state } from "raptorjs";
import type { HostBridge } from "@raptor/host";

export interface Note {
  readonly text: string;
  readonly atMs: number;
}

export interface Service {
  readonly notes: () => readonly Note[];
  readonly url: () => string | null;
  readonly ready: () => boolean;
  readonly served: () => number;
  /** Rezumatul pe care il raporteaza si `/health`. */
  readonly summary: () => string;
  /** Cere listenerul, incarca starea si se declara gata de trafic. */
  start(): Promise<void>;
  /** Opreste primirea de cereri noi si spune host-ului ca nu mai e gata. */
  stop(): Promise<void>;
}

const NOTES_KEY = "notes";

interface RequestEvent {
  readonly id: number;
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

export function createService(bridge: HostBridge): Service {
  const notes = state<readonly Note[]>([]);
  const url = state<string | null>(null);
  const ready = state(false);
  const served = state(0);
  let greeting = "Raptor Service";

  const summary = derived(() => `${ready() ? "ready" : "starting"} - ${notes().length} note, ${served()} cereri`);

  const json = (value: unknown, status = 200): { status: number; headers: Record<string, string>; body: string } => ({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

  /** Rutare minima; contractul este Web-standard, nu un framework propriu. */
  const handle = async (event: RequestEvent): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
    const path = new URL(event.url).pathname;

    if (event.method === "GET" && path === "/health") {
      // Sanatatea raportata aici si cea declarata host-ului sunt acelasi adevar.
      return json({ status: ready() ? "ready" : "starting", notes: notes().length, served: served() });
    }
    if (event.method === "GET" && path === "/note") {
      return json({ greeting, notes: notes() });
    }
    if (event.method === "POST" && path === "/note") {
      let text: unknown;
      try {
        text = (JSON.parse(event.body ?? "{}") as { text?: unknown }).text;
      } catch {
        return json({ error: "corp JSON invalid" }, 400);
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        return json({ error: "campul 'text' este obligatoriu" }, 400);
      }

      const next = [...notes(), { text: text.trim(), atMs: Date.now() }];
      // Scriem la host inainte sa publicam starea, ca in celelalte trei shell-uri.
      await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
      notes.set(next);
      return json({ stored: next.length }, 201);
    }

    return json({ error: `nicio ruta pentru ${event.method} ${path}` }, 404);
  };

  bridge.on("serve.request", (payload) => {
    const event = payload as unknown as RequestEvent;
    void (async (): Promise<void> => {
      served.update((count) => count + 1);
      let answer: { status: number; headers: Record<string, string>; body: string };
      try {
        answer = await handle(event);
      } catch (error) {
        // O cerere care crapa nu are voie sa lase socketul agatat: host-ul
        // asteapta un `serve.respond` pentru fiecare `serve.request`.
        answer = json({ error: (error as Error).message }, 500);
      }
      await bridge.call("serve.respond", { id: event.id, ...answer });
    })();
  });

  return {
    notes: () => notes(),
    url: () => url(),
    ready: () => ready(),
    served: () => served(),
    summary: () => summary(),

    async start(): Promise<void> {
      const configured = await bridge.call<string | null>("config.get", { key: "GREETING" });
      if (configured) greeting = configured;

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as Note[]);

      // Portul nu este ales de aplicatie: cere listenerul pe nume, host-ul stie
      // pe ce port l-a alocat deployment-ul.
      const listener = await bridge.call<{ url: string }>("serve.listen", { name: "public" });
      url.set(listener.url);

      await bridge.call("health.set", { state: "ready" });
      ready.set(true);
    },

    async stop(): Promise<void> {
      await bridge.call("health.set", { state: "unhealthy" });
      ready.set(false);
      await bridge.call("serve.stop", { name: "public" });
      url.set(null);
    },
  };
}
