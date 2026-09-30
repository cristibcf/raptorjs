/**
 * The same application, a third time: now with the browser as the host.
 *
 * Compare with `examples/desktop-shell/src/app.ts` and
 * `examples/mobile-shell/src/app.ts`. The body is practically the same, and that
 * is the point: the app talks to `bridge`, not to the platform, so changing the
 * host does not change its code.
 *
 * What changes is what the host answers. Here:
 *  - navigation is shared - the app can drive it (History API), and the user can
 *    change it out from under the app (the back button);
 *  - notifications can be denied by the user, not just by the manifest;
 *  - subprocesses do not exist, and menus have nothing to represent.
 */
import { derived, state } from "@raptorstack/raptorjs";
import type { HostBridge } from "@raptorstack/host";

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
  /** A display-ready summary; derived, so it recomputes itself. */
  readonly summary: () => string;
  start(): Promise<void>;
  addNote(text: string): Promise<void>;
  /** Navigation requested by the app; on web it goes through the History API. */
  goTo(route: string): Promise<boolean>;
  announce(text: string): Promise<boolean>;
  /**
   * What the app can do on the current host, for an honest UI:
   * capability granted *and* method implemented by the adapter.
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

  const summary = derived(() => `${lifecycle()} - ${notes().length} notes on ${route()}`);

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
        // A host denial is information for the UI, not a failure.
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
        // On web, the user grants permission at call time: the manifest opens the
        // door, the browser asks, and the answer may be "no".
        lastError.set((error as { message: string }).message);
        return false;
      }
    },

    async abilities(): Promise<Readonly<Record<string, boolean>>> {
      // `allows` would say "yes" even for `menu.set` on web: the window capability
      // exists, it is just that a browser has no application menu bar.
      const supported = await bridge.supported();
      const out: Record<string, boolean> = {};
      for (const method of TRACKED_METHODS) out[method] = supported(method);
      return out;
    },
  };

  return shell;
}
