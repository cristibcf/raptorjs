/**
 * O aplicatie RaptorJS care traieste intr-un host desktop nativ.
 *
 * Tot ce tine de sistem - fereastra, meniu, stocare, notificari, deep links -
 * trece prin punte. Aplicatia nu importa nimic de platforma si nu stie daca in
 * spatele puntii sta host-ul de referinta din `@raptor/desktop` sau binarul
 * nativ: asta este exact promisiunea sectiunii 6.
 *
 * Reactivitatea ramane a RaptorJS: raspunsurile host-ului ajung in semnale, iar
 * legaturile fine-grained muta doar nodurile atinse.
 */
import { derived, state } from "@raptor/core";
import { mountChild, applyProps } from "@raptor/dom";
import type { HostBridge } from "@raptor/host";

export interface ShellElement {
  appendChild(child: unknown): unknown;
  querySelector(selector: string): { click(): void } | null;
  toHTML(): string;
}

export interface ShellDocument {
  createElement(tag: string): ShellElement;
}

export interface Shell {
  readonly title: () => string;
  readonly notes: () => readonly string[];
  readonly lifecycle: () => string;
  readonly lastLink: () => string | null;
  /** Deschide fereastra principala si pune meniul; apelat o data la pornire. */
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Cere host-ului sa arate o notificare; cere `device.notifications`. */
  announce(text: string): Promise<boolean>;
  view(document: ShellDocument): ShellElement;
}

const NOTES_KEY = "notes";

export function createShell(bridge: HostBridge): Shell {
  const title = state("Raptor Desktop Shell");
  const notes = state<readonly string[]>([]);
  const lifecycle = state("launching");
  const lastLink = state<string | null>(null);
  let windowId: string | null = null;

  // Evenimentele host-ului sunt doar intrari intr-un graf reactiv obisnuit.
  bridge.on("lifecycle.changed", (payload) => {
    lifecycle.set(String(payload["state"]));
  });
  bridge.on("deeplink.received", (payload) => {
    lastLink.set(String(payload["url"]));
  });
  bridge.on("menu.command", (payload) => {
    if (payload["id"] === "note.new") void shell.addNote(`nota ${notes().length + 1}`);
  });

  const shell: Shell = {
    title: () => title(),
    notes: () => notes(),
    lifecycle: () => lifecycle(),
    lastLink: () => lastLink(),

    async start(): Promise<void> {
      const opened = await bridge.call<{ id: string }>("window.open", { title: title() });
      windowId = opened.id;
      await bridge.call("menu.set", {
        items: [
          { id: "note.new", label: "Nota noua", accelerator: "Ctrl+N" },
          { id: "app.quit", label: "Iesire" },
        ],
      });

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as string[]);
    },

    async addNote(text: string): Promise<void> {
      const next = [...notes(), text];
      // Scriem intai, apoi publicam: daca host-ul refuza, starea nu minte.
      await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
      notes.set(next);
      if (windowId) await bridge.call("window.setTitle", { id: windowId, title: `${title()} (${next.length})` });
    },

    async announce(text: string): Promise<boolean> {
      // Un modul optional lipsa nu este o eroare de aplicatie: e o functie care
      // pur si simplu nu exista pe instalarea asta.
      if (!bridge.allows("notify.show")) return false;
      await bridge.call("notify.show", { title: title(), body: text });
      return true;
    },

    view(document: ShellDocument): ShellElement {
      const root = document.createElement("section");

      const heading = document.createElement("h1");
      mountChild(heading as never, () => title(), null);
      root.appendChild(heading);

      const status = document.createElement("p");
      const summary = derived(() => `stare: ${lifecycle()} - ${notes().length} note`);
      mountChild(status as never, () => summary(), null);
      root.appendChild(status);

      const link = document.createElement("p");
      mountChild(link as never, () => lastLink() ?? "niciun deep link", null);
      root.appendChild(link);

      const button = document.createElement("button");
      applyProps(button as never, { "on:click": () => void shell.addNote(`nota ${notes().length + 1}`) });
      mountChild(button as never, "Adauga nota", null);
      root.appendChild(button);

      return root;
    },
  };

  return shell;
}
