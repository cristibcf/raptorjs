/**
 * The reference desktop host.
 *
 * It implements the bridge methods exactly as the native binary will, but
 * in-process: windows as state, storage in an injectable store, notifications
 * collected. Its point is not to replace the native adapter, but to pin down
 * the *behavior* that one must reproduce - the policies below (navigation in an
 * allowlist, storage in the app directory, subprocesses from the explicit list
 * only) are the part that must not differ between implementations.
 */
import { HostError, createLifecycle, serveHost } from "@raptorstack/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptorstack/host";

export interface WindowState {
  readonly id: string;
  title: string;
  url: string;
  readonly width: number;
  readonly height: number;
}

export interface NotificationRecord {
  readonly title: string;
  readonly body: string;
  readonly atMs: number;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly accelerator?: string;
}

export interface SpawnOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DesktopHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  /** The local storage store; in memory by default. */
  readonly storage?: Map<string, string>;
  /**
   * The commands allowed for subprocesses. They come from `raptor.runtime.json`
   * (`capabilities["process.spawn"]`): the host manifest says *whether* the app
   * is allowed to start processes, the runtime one says *which*.
   */
  readonly allowedCommands?: readonly string[];
  readonly runCommand?: (command: string, args: readonly string[]) => Promise<SpawnOutcome>;
  /** The version offered by the update channel, or `null` if there is none. */
  readonly availableUpdate?: { readonly version: string; readonly url: string } | null;
  readonly now?: () => number;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface DesktopHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  readonly windows: readonly WindowState[];
  readonly notifications: readonly NotificationRecord[];
  readonly menu: readonly MenuItem[];
  /** A deep link coming from the system; the scheme must be declared. */
  deliverDeepLink(url: string): void;
  /** A menu command pressed by the user. */
  invokeMenu(id: string): void;
  close(): void;
}

const WINDOW_LIMIT = 16;

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/**
 * Storage keys live in a flat space, tied to the app. Any key that looks like a
 * path (separators or `..`) is denied: the section 6 policy says "limited to
 * the app directory", and the simplest way to keep it is to have no paths in
 * keys at all.
 */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `invalid storage key: ${key}`, {
      key,
      policy: "limited to the app directory",
    });
  }
  return key;
}

export function createDesktopHost(options: DesktopHostOptions): DesktopHost {
  const manifest = options.manifest;
  if (manifest.target !== "desktop") {
    throw new HostError("raptor:host/manifest-invalid", "createDesktopHost requires a manifest with target 'desktop'", {
      target: manifest.target,
    });
  }

  const now = options.now ?? (() => Date.now());
  const storage = options.storage ?? new Map<string, string>();
  const allowedCommands = new Set(options.allowedCommands ?? []);
  const lifecycle = createLifecycle();
  const windows: WindowState[] = [];
  const notifications: NotificationRecord[] = [];
  let menu: MenuItem[] = [];
  const pendingDeepLinks: string[] = [];
  let windowCounter = 0;

  /** Navigation is allowed to the app itself or to the declared origins. */
  const allowsUrl = (url: string): boolean => {
    if (url.startsWith("/") || url.startsWith("./")) return true;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return manifest.allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  };

  const requireUrl = (params: Readonly<Record<string, unknown>>, key = "url"): string => {
    const url = requireString(params, key);
    if (!allowsUrl(url)) {
      throw new HostError("raptor:host/capability-unavailable", `navigation denied to '${url}'`, {
        url,
        allowedOrigins: [...manifest.allowedOrigins],
      });
    }
    return url;
  };

  const findWindow = (id: string): WindowState => {
    const found = windows.find((window) => window.id === id);
    if (!found) {
      throw new HostError("raptor:host/protocol", `window '${id}' does not exist`, { id });
    }
    return found;
  };

  const methods: Record<string, MethodHandler> = {
    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      lifecycle.settle("stopped", "the app requested a stop");
      server.emit("lifecycle.changed", { state: lifecycle.state, reason: "app" });
      return { state: lifecycle.state };
    },

    "deeplink.pending": () => {
      const pending = [...pendingDeepLinks];
      pendingDeepLinks.length = 0;
      return pending;
    },

    "update.check": () =>
      options.availableUpdate
        ? { available: true, version: options.availableUpdate.version, url: options.availableUpdate.url }
        : { available: false, version: manifest.version, url: null },

    "update.apply": () => {
      if (!options.availableUpdate) {
        throw new HostError("raptor:host/unimplemented", "there is no update to apply", {
          channel: manifest.update.channel,
        });
      }
      if (manifest.update.feed === null) {
        // Without a feed, distribution comes from the store; the app does not update itself.
        throw new HostError("raptor:host/unimplemented", "the channel is managed by the store, not the app", {});
      }
      lifecycle.settle("stopped", "restart for update");
      return { applied: true, version: options.availableUpdate.version };
    },

    "window.open": (params) => {
      if (windows.length >= WINDOW_LIMIT) {
        throw new HostError("raptor:host/capability-unavailable", `the limit of ${WINDOW_LIMIT} windows has been reached`, {
          limit: WINDOW_LIMIT,
        });
      }
      const defaults = manifest.window;
      const window: WindowState = {
        id: `w${++windowCounter}`,
        title: typeof params["title"] === "string" ? params["title"] : (defaults?.title ?? manifest.displayName),
        url: params["url"] === undefined ? manifest.entry : requireUrl(params),
        width: defaults?.width ?? 1024,
        height: defaults?.height ?? 768,
      };
      windows.push(window);
      return { id: window.id };
    },

    "window.close": (params) => {
      const id = requireString(params, "id");
      const index = windows.findIndex((window) => window.id === id);
      if (index < 0) throw new HostError("raptor:host/protocol", `window '${id}' does not exist`, { id });
      windows.splice(index, 1);
      return { closed: id };
    },

    "window.setTitle": (params) => {
      const window = findWindow(requireString(params, "id"));
      window.title = requireString(params, "title");
      return { id: window.id, title: window.title };
    },

    "window.navigate": (params) => {
      const window = findWindow(requireString(params, "id"));
      window.url = requireUrl(params);
      return { id: window.id, url: window.url };
    },

    "window.list": () => windows.map((window) => ({ ...window })),

    "menu.set": (params) => {
      const items = params["items"];
      if (!Array.isArray(items)) {
        throw new HostError("raptor:host/protocol", "menu.set requires a list of items", {});
      }
      menu = items.map((item, index) => {
        if (typeof item !== "object" || item === null) {
          throw new HostError("raptor:host/protocol", `menu item ${index} is not an object`, { index });
        }
        const record = item as Record<string, unknown>;
        if (typeof record["id"] !== "string" || typeof record["label"] !== "string") {
          throw new HostError("raptor:host/protocol", `menu item ${index} requires { id, label }`, { index });
        }
        return typeof record["accelerator"] === "string"
          ? { id: record["id"], label: record["label"], accelerator: record["accelerator"] }
          : { id: record["id"], label: record["label"] };
      });
      return { count: menu.length };
    },

    "storage.get": (params) => storage.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      storage.set(key, requireString(params, "value"));
      return { key };
    },
    "storage.delete": (params) => ({ deleted: storage.delete(requireKey(params)) }),
    "storage.keys": () => [...storage.keys()].sort(),

    "notify.show": (params) => {
      const record: NotificationRecord = {
        title: requireString(params, "title"),
        body: typeof params["body"] === "string" ? params["body"] : "",
        atMs: now(),
      };
      notifications.push(record);
      return { shown: true };
    },

    "process.spawn": async (params) => {
      const command = requireString(params, "command");
      if (!allowedCommands.has(command)) {
        // Section 6: "desktop only, with an explicit list". The capability opens
        // the door, the list in raptor.runtime.json says who is let in.
        throw new HostError("raptor:host/capability-undeclared", `command '${command}' is not in the explicit list`, {
          command,
          allowed: [...allowedCommands].sort(),
        });
      }
      if (!options.runCommand) {
        throw new HostError("raptor:host/unimplemented", "the host has no command executor configured", {
          command,
        });
      }
      const args = Array.isArray(params["args"]) ? (params["args"] as unknown[]).map(String) : [];
      return await options.runCommand(command, args);
    },
  };

  const serverOptions = {
    target: "desktop" as const,
    capabilities: manifest.capabilities,
    transport: options.transport,
    methods,
  };
  const server: HostServer = serveHost(
    options.onAudit ? { ...serverOptions, onAudit: options.onAudit } : serverOptions,
  );

  lifecycle.onChange((state, reason) => {
    server.emit("lifecycle.changed", { state, reason });
  });

  return {
    server,
    lifecycle,
    get windows(): readonly WindowState[] {
      return windows;
    },
    get notifications(): readonly NotificationRecord[] {
      return notifications;
    },
    get menu(): readonly MenuItem[] {
      return menu;
    },

    deliverDeepLink(url: string): void {
      let scheme: string;
      try {
        scheme = new URL(url).protocol.replace(":", "");
      } catch {
        throw new HostError("raptor:host/protocol", `invalid deep link: ${url}`, { url });
      }
      if (!manifest.deepLinkSchemes.includes(scheme)) {
        // A link with an undeclared scheme does not belong to this app.
        throw new HostError("raptor:host/capability-unavailable", `scheme '${scheme}' is not declared`, {
          url,
          declared: [...manifest.deepLinkSchemes],
        });
      }
      pendingDeepLinks.push(url);
      server.emit("deeplink.received", { url });
    },

    invokeMenu(id: string): void {
      if (!menu.some((item) => item.id === id)) {
        throw new HostError("raptor:host/protocol", `menu command '${id}' does not exist`, { id });
      }
      server.emit("menu.command", { id });
    },

    close(): void {
      lifecycle.settle("stopped", "host closed");
      server.close();
    },
  };
}
