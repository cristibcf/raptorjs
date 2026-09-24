/**
 * Aceeasi aplicatie, a treia oara: acum cu browserul pe post de host.
 *
 * Comparati cu `examples/desktop-shell/src/app.ts` si
 * `examples/mobile-shell/src/app.ts`. Corpul este practic acelasi, si asta este
 * rezultatul: aplicatia vorbeste cu `bridge`, nu cu platforma, deci schimbarea
 * host-ului nu ii schimba codul.
 *
 * Ce se schimba este ce raspunde host-ul. Aici:
 *  - navigarea e impartita - si aplicatia o poate conduce (History API), si
 *    utilizatorul o poate schimba de sub ea (butonul de back);
 *  - notificarile pot fi refuzate de utilizator, nu doar de manifest;
 *  - subprocesele nu exista, iar meniurile nu au ce reprezenta.
 */
import { derived, state } from "@raptor/core";
import type { HostBridge } from "@raptor/host";

export interface Note {
  readonly text: string;
  readonly route: string;
}

export interface Shell {
  readonly title: () => string;
  readonly route: () => string;
  readonly notes: () => readonly Note[];
  readonly lifecycle: () => string;
  readonly lastError: () => string | null;
  /** Rezumat gata de afisat; derivat, deci se recalculeaza singur. */
  readonly summary: () => string;
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Navigare ceruta de aplicatie; pe web trece prin History API. */
  goTo(route: string): Promise<boolean>;
  announce(text: string): Promise<boolean>;
  /**
   * Ce poate face aplicatia pe host-ul curent, pentru o interfata onesta:
   * capabilitate acordata *si* metoda implementata de adaptor.
   */
  abilities(): Promise<Readonly<Record<string, boolean>>>;
}

const NOTES_KEY = "notes";
const TRACKED_METHODS = ["window.navigate", "notify.show", "camera.capture", "process.spawn", "menu.set"];

export function createShell(bridge: HostBridge): Shell {
  const title = state("Raptor Web Shell");
  const route = state("/");
  const notes = state<readonly Note[]>([]);
  const lifecycle = state("launching");
  const lastError = state<string | null>(null);

  bridge.on("navigation.changed", (payload) => {
    route.set(String(payload["route"]));
  });
  bridge.on("lifecycle.changed", (payload) => {
    lifecycle.set(String(payload["state"]));
  });

  const summary = derived(() => `${lifecycle()} - ${notes().length} note pe ${route()}`);

  const shell: Shell = {
    title: () => title(),
    route: () => route(),
    notes: () => notes(),
    lifecycle: () => lifecycle(),
    lastError: () => lastError(),
    summary: () => summary(),

    async start(): Promise<void> {
      const current = await bridge.call<{ route: string }>("navigation.current");
      route.set(current.route);

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as Note[]);
    },

    async addNote(text: string): Promise<void> {
      const next = [...notes(), { text, route: route() }];
      await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
      notes.set(next);
    },

    async goTo(next: string): Promise<boolean> {
      if (!bridge.allows("window.navigate")) return false;
      try {
        await bridge.call("window.navigate", { url: next });
        lastError.set(null);
        return true;
      } catch (error) {
        // Un refuz al host-ului este informatie pentru interfata, nu o avarie.
        lastError.set((error as { message: string }).message);
        return false;
      }
    },

    async announce(text: string): Promise<boolean> {
      if (!bridge.allows("notify.show")) return false;
      try {
        await bridge.call("notify.show", { title: title(), body: text });
        lastError.set(null);
        return true;
      } catch (error) {
        // Pe web, permisiunea o da utilizatorul in momentul apelului: manifestul
        // deschide usa, browserul intreaba, iar raspunsul poate fi "nu".
        lastError.set((error as { message: string }).message);
        return false;
      }
    },

    async abilities(): Promise<Readonly<Record<string, boolean>>> {
      // `allows` ar spune "da" si pentru `menu.set` pe web: capabilitatea de
      // ferestre exista, doar ca un browser nu are bara de meniu a aplicatiei.
      const supported = await bridge.supported();
      const out: Record<string, boolean> = {};
      for (const method of TRACKED_METHODS) out[method] = supported(method);
      return out;
    },
  };

  return shell;
}
