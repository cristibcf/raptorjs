/**
 * The browser host.
 *
 * **What it is and what it is not.** On desktop and mobile, the bridge crosses
 * a process: the host's denial is a real security boundary. In the browser
 * there is no such thing - the page and the "host" are the same isolate, and
 * the real boundary is the browser's origin sandbox. The checks here are
 * therefore *portability and discipline*, not isolation: they guarantee that an
 * app written to the Raptor contract behaves the same on all three targets and
 * does not lean on something that is missing on some of them. They do not
 * guarantee that hostile code in the same page cannot touch `localStorage`
 * directly - it can.
 *
 * The difference from the other two adapters, in two lines:
 *  - navigation is split: the page can drive it (History API), and the user can
 *    change it out from under it (the back button), so the adapter listens for
 *    `popstate` and notifies the app exactly as on mobile;
 *  - menus and subprocesses do not exist, and `update.*` has nothing to report:
 *    a web page "updates" by reloading.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";
import type { WebPlatform } from "./platform.ts";

export interface WebHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly platform: WebPlatform;
  /** Prefix for the `localStorage` keys; defaults to `bundleId`. */
  readonly storagePrefix?: string;
  readonly initialRoute?: string;
  readonly now?: () => number;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface WebHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  readonly route: string;
  /** Web deep links are entry URLs, not custom schemes. */
  deliverDeepLink(url: string): void;
  /** The browser's back button, or any change from outside the page. */
  routeChanged(path: string): void;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/** The same key policy as on native: a flat space, no paths. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `invalid storage key: ${key}`, {
      key,
      policy: "limited to the page origin",
    });
  }
  return key;
}

function missing(module: string): never {
  throw new HostError("raptor:host/unimplemented", `this page's environment does not offer '${module}'`, { module });
}

export function createWebHost(options: WebHostOptions): WebHost {
  const manifest = options.manifest;
  if (manifest.target !== "web") {
    throw new HostError("raptor:host/manifest-invalid", "createWebHost requires a manifest with target 'web'", {
      target: manifest.target,
    });
  }

  const platform = options.platform;
  const now = options.now ?? (() => Date.now());
  const prefix = options.storagePrefix ?? `${manifest.bundleId}:`;
  const lifecycle = createLifecycle();
  let route = options.initialRoute ?? platform.location?.pathname ?? "/";
  const pendingDeepLinks: string[] = [];

  const allowsUrl = (url: string): boolean => {
    if (url.startsWith("/") || url.startsWith("./")) return true;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (platform.location && parsed.origin === platform.location.origin) return true;
    return manifest.allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  };

  const requireUrl = (params: Readonly<Record<string, unknown>>): string => {
    const url = requireString(params, "url");
    if (!allowsUrl(url)) {
      throw new HostError("raptor:host/capability-unavailable", `navigation denied to '${url}'`, {
        url,
        allowedOrigins: [...manifest.allowedOrigins],
      });
    }
    return url;
  };

  const setRoute = (next: string, reason: string): void => {
    route = next;
    server.emit("navigation.changed", { route: next, reason });
  };

  const methods: Record<string, MethodHandler> = {
    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      // A page does not close itself: `window.close()` is ignored for pages the
      // script did not open. Moving to the background is all that can honestly
      // be said here.
      lifecycle.settle("background", "the app requested a stop");
      return { state: lifecycle.state, note: "a web page cannot close itself" };
    },

    "deeplink.pending": () => {
      const pending = [...pendingDeepLinks];
      pendingDeepLinks.length = 0;
      return pending;
    },

    "navigation.current": () => ({ route, depth: platform.history?.length ?? 1 }),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "reload" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "a web page updates by reloading", {});
    },

    // On web, `window.manage` covers the page's own navigation and popups.
    "window.navigate": (params) => {
      const url = requireUrl(params);
      if (!platform.history) missing("history");
      platform.history.pushState(null, "", url);
      setRoute(url, "app");
      return { route: url };
    },

    "window.open": (params) => {
      if (!platform.opener) missing("window.open");
      const url = requireUrl(params);
      const width = manifest.window?.width ?? 1024;
      const height = manifest.window?.height ?? 768;
      const handle = platform.opener.open(url, "_blank", `width=${width},height=${height}`);
      if (!handle) {
        // The browser blocks popups without a user gesture. We say so, instead
        // of reporting a success that did not happen.
        throw new HostError("raptor:host/capability-unavailable", "popup blocked by the browser (missing user gesture)", {
          url,
        });
      }
      return { id: "popup", url };
    },

    "window.setTitle": (params) => {
      const title = requireString(params, "title");
      if (!platform.setTitle) missing("document.title");
      platform.setTitle(title);
      return { title };
    },

    "storage.get": (params) => {
      if (!platform.storage) missing("localStorage");
      return platform.storage.getItem(prefix + requireKey(params));
    },
    "storage.set": (params) => {
      const key = requireKey(params);
      if (!platform.storage) missing("localStorage");
      platform.storage.setItem(prefix + key, requireString(params, "value"));
      return { key };
    },
    "storage.delete": (params) => {
      const key = requireKey(params);
      if (!platform.storage) missing("localStorage");
      const existed = platform.storage.getItem(prefix + key) !== null;
      platform.storage.removeItem(prefix + key);
      return { deleted: existed };
    },
    "storage.keys": () => {
      if (!platform.storage) missing("localStorage");
      const keys: string[] = [];
      for (let index = 0; index < platform.storage.length; index += 1) {
        const key = platform.storage.key(index);
        // Other apps may share the same origin: we skip them, not list them.
        if (key !== null && key.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys.sort();
    },

    "notify.show": async (params) => {
      if (!platform.notifications) missing("Notification");
      const permission = await platform.notifications.requestPermission();
      if (permission !== "granted") {
        throw new HostError("raptor:host/capability-unavailable", "the user did not grant notification permission", {
          permission,
        });
      }
      platform.notifications.show(
        requireString(params, "title"),
        typeof params["body"] === "string" ? params["body"] : "",
      );
      return { shown: true, atMs: now() };
    },

    "camera.capture": async () => (platform.camera ? await platform.camera.capture() : missing("getUserMedia")),
    "location.current": async () => (platform.geolocation ? await platform.geolocation.current() : missing("geolocation")),
    "files.pick": async () => (platform.files ? await platform.files.pick() : missing("file input")),
  };

  const serverOptions = {
    target: "web" as const,
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

  // The back button changes the route without going through the app - exactly
  // the case `navigation.changed` exists for on mobile too.
  platform.onPopState?.((path) => setRoute(path, "popstate"));

  return {
    server,
    lifecycle,
    get route(): string {
      return route;
    },

    deliverDeepLink(url: string): void {
      // On web there are no custom schemes registered with the system: a "deep
      // link" is the URL the page was opened with. We validate it by origin.
      if (!allowsUrl(url)) {
        throw new HostError("raptor:host/capability-unavailable", `deep link from outside the allowed origins: ${url}`, {
          url,
          allowedOrigins: [...manifest.allowedOrigins],
        });
      }
      pendingDeepLinks.push(url);
      server.emit("deeplink.received", { url });
    },

    routeChanged(path: string): void {
      setRoute(path, "popstate");
    },

    close(): void {
      lifecycle.settle("stopped", "host closed");
      server.close();
    },
  };
}
