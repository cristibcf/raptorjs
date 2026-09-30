/**
 * The same RaptorJS application, this time inside a mobile host.
 *
 * Its desktop counterpart is `examples/desktop-shell`. The difference that
 * matters is not that windows are missing, but **who drives navigation**: on the
 * phone, the route belongs to the adapter. The app does not request screens and
 * does not keep its own stack - it receives `navigation.changed` and renders
 * accordingly, exactly as for any other signal. That way the system's back
 * gesture, which never goes through JavaScript, stays correct.
 *
 * Just like on desktop, nothing platform-specific is imported here: everything
 * system-related enters and leaves through the bridge.
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
  /** Opaque reference to the attached photo; the bytes stay at the host. */
  readonly photo: string | null;
}

export interface Shell {
  readonly title: () => string;
  readonly route: () => string;
  readonly notes: () => readonly Note[];
  readonly lifecycle: () => string;
  readonly lastLink: () => string | null;
  /** Reads the saved notes; called once at startup. */
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Attaches a photo to the last note; `false` if the module is not on this install. */
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

  // The route is a signal like any other, fed by the adapter.
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
    // Write to the secure store before publishing: if the host rejects, the app
    // state is never left saying something different from the disk.
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
      // At startup no `navigation.changed` was seen yet, so the current screen
      // is requested once: the adapter may start on a route other than the root,
      // for example after a deep link that opened the app.
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
      mountChild(screen as never, () => `screen: ${route()}`, null);
      root.appendChild(screen);

      const status = document.createElement("p");
      const summary = derived(() => {
        const withPhoto = notes().filter((note) => note.photo !== null).length;
        return `status: ${lifecycle()} - ${notes().length} notes, ${withPhoto} with photo`;
      });
      mountChild(status as never, () => summary(), null);
      root.appendChild(status);

      const link = document.createElement("p");
      mountChild(link as never, () => lastLink() ?? "no deep link", null);
      root.appendChild(link);

      const button = document.createElement("button");
      applyProps(button as never, { "on:click": () => void shell.addNote(`note ${notes().length + 1}`) });
      mountChild(button as never, "Add note", null);
      root.appendChild(button);

      return root;
    },
  };

  return shell;
}
