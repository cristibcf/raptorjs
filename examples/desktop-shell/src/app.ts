/**
 * A RaptorJS application living inside a native desktop host.
 *
 * Everything system-related - window, menu, storage, notifications, deep links -
 * goes through the bridge. The app imports nothing platform-specific and does not
 * know whether behind the bridge sits the reference host from `@raptorstack/desktop` or
 * the native binary: that is exactly the promise of section 6.
 *
 * Reactivity stays RaptorJS: host responses land in signals, and the fine-grained
 * bindings move only the touched nodes.
 */
import { derived, state } from "@raptorstack/raptorjs";
import { mountChild, applyProps } from "@raptorstack/raptorjs/dom";
import type { HostBridge } from "@raptorstack/host";

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
  /** Opens the main window and sets the menu; called once at startup. */
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Asks the host to show a notification; requires `device.notifications`. */
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

  // Host events are just inputs into an ordinary reactive graph.
  bridge.on("lifecycle.changed", (payload) => {
    lifecycle.set(String(payload["state"]));
  });
  bridge.on("deeplink.received", (payload) => {
    lastLink.set(String(payload["url"]));
  });
  bridge.on("menu.command", (payload) => {
    if (payload["id"] === "note.new") void shell.addNote(`note ${notes().length + 1}`);
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
          { id: "note.new", label: "New note", accelerator: "Ctrl+N" },
          { id: "app.quit", label: "Quit" },
        ],
      });

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as string[]);
    },

    async addNote(text: string): Promise<void> {
      const next = [...notes(), text];
      // Write first, then publish: if the host rejects, the state never lies.
      await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
      notes.set(next);
      if (windowId) await bridge.call("window.setTitle", { id: windowId, title: `${title()} (${next.length})` });
    },

    async announce(text: string): Promise<boolean> {
      // A missing optional module is not an application error: it is a feature
      // that simply does not exist on this installation.
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
      const summary = derived(() => `status: ${lifecycle()} - ${notes().length} notes`);
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
