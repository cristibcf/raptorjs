/**
 * The reference mobile host.
 *
 * The initial stage from section 6 - navigation, secure storage, lifecycle,
 * deep links and communication with the host - plus the optional modules, each
 * behind its own capability.
 *
 * The essential difference from desktop is navigation: on a phone it belongs to
 * the adapter. The app does not ask for screens to open and cannot move itself;
 * it receives `navigation.changed` and reacts. The system's back button is
 * exactly the reason - if the app held the stack, the adapter could no longer
 * respond correctly to a gesture that does not go through JavaScript.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";

export interface NotificationRecord {
  readonly title: string;
  readonly body: string;
  readonly atMs: number;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
}

export interface CapturedPhoto {
  readonly mimeType: string;
  readonly byteLength: number;
  /** An opaque reference; the bytes stay at the host until the app requests them. */
  readonly handle: string;
}

export interface PickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly handle: string;
}

export interface MobileHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  /** The platform's secure store; in memory by default. */
  readonly secureStore?: Map<string, string>;
  /** The initial route controlled by the adapter. */
  readonly initialRoute?: string;
  readonly capturePhoto?: () => Promise<CapturedPhoto>;
  readonly readLocation?: () => Promise<Coordinates>;
  readonly pickFile?: () => Promise<PickedFile>;
  readonly now?: () => number;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface MobileHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  readonly route: string;
  readonly stack: readonly string[];
  readonly notifications: readonly NotificationRecord[];
  /** Navigation belongs to the adapter: the app is notified, not asked. */
  navigate(route: string): void;
  /** The system's back gesture; `false` if there is nowhere left to go back to. */
  back(): boolean;
  deliverDeepLink(url: string): void;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/** The same key policy as on desktop: a flat space, no paths. */
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

export function createMobileHost(options: MobileHostOptions): MobileHost {
  const manifest = options.manifest;
  if (manifest.target !== "mobile") {
    throw new HostError("raptor:host/manifest-invalid", "createMobileHost requires a manifest with target 'mobile'", {
      target: manifest.target,
    });
  }

  const now = options.now ?? (() => Date.now());
  const store = options.secureStore ?? new Map<string, string>();
  const lifecycle = createLifecycle();
  const stack: string[] = [options.initialRoute ?? "/"];
  const notifications: NotificationRecord[] = [];
  const pendingDeepLinks: string[] = [];

  const methods: Record<string, MethodHandler> = {
    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      // On a phone the app does not close itself: the request sends it to the
      // background, and the system decides whether and when to suspend it.
      lifecycle.settle("background", "the app requested a stop");
      return { state: lifecycle.state, note: "the system decides the suspension" };
    },

    "deeplink.pending": () => {
      const pending = [...pendingDeepLinks];
      pendingDeepLinks.length = 0;
      return pending;
    },

    "navigation.current": () => ({ route: stack[stack.length - 1]!, depth: stack.length }),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "store" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "mobile updates come from the store, not from the app", {
        platform: "mobile",
      });
    },

    "storage.get": (params) => store.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      store.set(key, requireString(params, "value"));
      return { key };
    },
    "storage.delete": (params) => ({ deleted: store.delete(requireKey(params)) }),
    "storage.keys": () => [...store.keys()].sort(),

    "notify.show": (params) => {
      notifications.push({
        title: requireString(params, "title"),
        body: typeof params["body"] === "string" ? params["body"] : "",
        atMs: now(),
      });
      return { shown: true };
    },

    "camera.capture": async () => {
      if (!options.capturePhoto) {
        throw new HostError("raptor:host/unimplemented", "the camera module is not mounted in this host", {});
      }
      return await options.capturePhoto();
    },

    "location.current": async () => {
      if (!options.readLocation) {
        throw new HostError("raptor:host/unimplemented", "the location module is not mounted in this host", {});
      }
      return await options.readLocation();
    },

    "files.pick": async () => {
      if (!options.pickFile) {
        throw new HostError("raptor:host/unimplemented", "the file picker is not mounted in this host", {});
      }
      return await options.pickFile();
    },
  };

  const serverOptions = {
    target: "mobile" as const,
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
    get route(): string {
      return stack[stack.length - 1]!;
    },
    get stack(): readonly string[] {
      return stack;
    },
    get notifications(): readonly NotificationRecord[] {
      return notifications;
    },

    navigate(route: string): void {
      if (!route.startsWith("/")) {
        throw new HostError("raptor:host/protocol", `the route must start with '/': ${route}`, { route });
      }
      stack.push(route);
      server.emit("navigation.changed", { route, depth: stack.length });
    },

    back(): boolean {
      if (stack.length <= 1) return false;
      stack.pop();
      server.emit("navigation.changed", { route: stack[stack.length - 1]!, depth: stack.length });
      return true;
    },

    deliverDeepLink(url: string): void {
      let scheme: string;
      try {
        scheme = new URL(url).protocol.replace(":", "");
      } catch {
        throw new HostError("raptor:host/protocol", `invalid deep link: ${url}`, { url });
      }
      if (!manifest.deepLinkSchemes.includes(scheme)) {
        throw new HostError("raptor:host/capability-unavailable", `scheme '${scheme}' is not declared`, {
          url,
          declared: [...manifest.deepLinkSchemes],
        });
      }
      pendingDeepLinks.push(url);
      server.emit("deeplink.received", { url });
    },

    close(): void {
      lifecycle.settle("stopped", "host closed");
      server.close();
    },
  };
}
