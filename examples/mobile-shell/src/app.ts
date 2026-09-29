/**
 * Aceeasi aplicatie RaptorJS, de data asta intr-un host mobil.
 *
 * Perechea ei de desktop este `examples/desktop-shell`. Diferenta care conteaza
 * nu este ca lipsesc ferestrele, ci **cine conduce navigarea**: pe telefon,
 * ruta apartine adaptorului. Aplicatia nu cere ecrane si nu isi tine singura
 * stiva - primeste `navigation.changed` si se randeaza in consecinta, exact ca
 * pentru orice alt semnal. Asa gestul de back al sistemului, care nu trece
 * niciodata prin JavaScript, ramane corect.
 *
 * La fel ca pe desktop, nimic de platforma nu este importat aici: tot ce tine
 * de sistem intra si iese prin punte.
 */
import { derived, state } from "raptorjs";
import { mountChild, applyProps } from "raptorjs/dom";
import type { HostBridge } from "@raptor/host";

export interface ShellElement {
  appendChild(child: unknown): unknown;
  querySelector(selector: string): { click(): void } | null;
  toHTML(): string;
}

export interface ShellDocument {
  createElement(tag: string): ShellElement;
}

export interface Note {
  readonly text: string;
  /** Referinta opaca catre poza atasata; octetii raman la host. */
  readonly photo: string | null;
}

export interface Shell {
  readonly title: () => string;
  readonly route: () => string;
  readonly notes: () => readonly Note[];
  readonly lifecycle: () => string;
  readonly lastLink: () => string | null;
  /** Citeste notele salvate; apelat o data la pornire. */
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Ataseaza o poza ultimei note; `false` daca modulul nu e pe instalarea asta. */
  attachPhoto(): Promise<boolean>;
  announce(text: string): Promise<boolean>;
  view(document: ShellDocument): ShellElement;
}

const NOTES_KEY = "notes";

export function createShell(bridge: HostBridge): Shell {
  const title = state("Raptor Mobile Shell");
  const route = state("/");
  const notes = state<readonly Note[]>([]);
  const lifecycle = state("launching");
  const lastLink = state<string | null>(null);

  // Ruta este un semnal ca oricare altul, alimentat de adaptor.
  bridge.on("navigation.changed", (payload) => {
    route.set(String(payload["route"]));
  });
  bridge.on("lifecycle.changed", (payload) => {
    lifecycle.set(String(payload["state"]));
  });
  bridge.on("deeplink.received", (payload) => {
    lastLink.set(String(payload["url"]));
  });

  const persist = async (next: readonly Note[]): Promise<void> => {
    // Scriem in magazinul securizat inainte sa publicam: daca host-ul refuza,
    // starea aplicatiei nu ramane sa spuna altceva decat discul.
    await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
    notes.set(next);
  };

  const shell: Shell = {
    title: () => title(),
    route: () => route(),
    notes: () => notes(),
    lifecycle: () => lifecycle(),
    lastLink: () => lastLink(),

    async start(): Promise<void> {
      // La pornire nu s-a vazut niciun `navigation.changed`, deci ecranul curent
      // se cere o data: adaptorul poate porni pe alta ruta decat radacina, de
      // exemplu dupa un deep link care a deschis aplicatia.
      const current = await bridge.call<{ route: string }>("navigation.current");
      route.set(current.route);

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as Note[]);
    },

    async addNote(text: string): Promise<void> {
      await persist([...notes(), { text, photo: null }]);
    },

    async attachPhoto(): Promise<boolean> {
      if (!bridge.allows("camera.capture")) return false;
      const current = notes();
      const last = current[current.length - 1];
      if (!last) return false;

      const photo = await bridge.call<{ handle: string }>("camera.capture");
      await persist([...current.slice(0, -1), { text: last.text, photo: photo.handle }]);
      return true;
    },

    async announce(text: string): Promise<boolean> {
      if (!bridge.allows("notify.show")) return false;
      await bridge.call("notify.show", { title: title(), body: text });
      return true;
    },

    view(document: ShellDocument): ShellElement {
      const root = document.createElement("section");

      const heading = document.createElement("h1");
      mountChild(heading as never, () => title(), null);
      root.appendChild(heading);

      const screen = document.createElement("p");
      mountChild(screen as never, () => `ecran: ${route()}`, null);
      root.appendChild(screen);

      const status = document.createElement("p");
      const summary = derived(() => {
        const withPhoto = notes().filter((note) => note.photo !== null).length;
        return `stare: ${lifecycle()} - ${notes().length} note, ${withPhoto} cu poza`;
      });
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
