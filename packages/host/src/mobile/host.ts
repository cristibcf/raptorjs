/**
 * Host-ul mobil de referinta.
 *
 * Etapa initiala din sectiunea 6 - navigare, stocare securizata, lifecycle, deep
 * links si comunicare cu host-ul - plus modulele optionale, fiecare in spatele
 * capabilitatii lui.
 *
 * Diferenta esentiala fata de desktop este navigarea: pe telefon ea apartine
 * adaptorului. Aplicatia nu cere sa se deschida ecrane si nu poate sa se mute
 * singura; primeste `navigation.changed` si reactioneaza. Butonul de back al
 * sistemului este exact motivul - daca aplicatia ar tine stiva, adaptorul nu ar
 * mai putea raspunde corect la un gest care nu trece prin JavaScript.
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
  /** Referinta opaca; octetii raman la host pana cand aplicatia ii cere. */
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
  /** Magazinul securizat al platformei; implicit in memorie. */
  readonly secureStore?: Map<string, string>;
  /** Ruta initiala controlata de adaptor. */
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
  /** Navigarea apartine adaptorului: aplicatia este anuntata, nu intrebata. */
  navigate(route: string): void;
  /** Gestul de back al sistemului; `false` daca nu mai e unde sa se intoarca. */
  back(): boolean;
  deliverDeepLink(url: string): void;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/** Aceeasi politica de chei ca pe desktop: spatiu plat, fara cai. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `cheie de stocare invalida: ${key}`, {
      key,
      policy: "limitata la directorul aplicatiei",
    });
  }
  return key;
}

export function createMobileHost(options: MobileHostOptions): MobileHost {
  const manifest = options.manifest;
  if (manifest.target !== "mobile") {
    throw new HostError("raptor:host/manifest-invalid", "createMobileHost cere un manifest cu target 'mobile'", {
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
      // Pe telefon aplicatia nu se inchide singura: cererea o trimite in fundal,
      // iar sistemul decide daca si cand o suspenda.
      lifecycle.settle("background", "aplicatia a cerut oprirea");
      return { state: lifecycle.state, note: "sistemul decide suspendarea" };
    },

    "deeplink.pending": () => {
      const pending = [...pendingDeepLinks];
      pendingDeepLinks.length = 0;
      return pending;
    },

    "navigation.current": () => ({ route: stack[stack.length - 1]!, depth: stack.length }),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "store" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "actualizarile mobile vin din magazin, nu din aplicatie", {
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
        throw new HostError("raptor:host/unimplemented", "modulul de camera nu este montat in acest host", {});
      }
      return await options.capturePhoto();
    },

    "location.current": async () => {
      if (!options.readLocation) {
        throw new HostError("raptor:host/unimplemented", "modulul de locatie nu este montat in acest host", {});
      }
      return await options.readLocation();
    },

    "files.pick": async () => {
      if (!options.pickFile) {
        throw new HostError("raptor:host/unimplemented", "selectorul de fisiere nu este montat in acest host", {});
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
        throw new HostError("raptor:host/protocol", `ruta trebuie sa inceapa cu '/': ${route}`, { route });
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
        throw new HostError("raptor:host/protocol", `deep link invalid: ${url}`, { url });
      }
      if (!manifest.deepLinkSchemes.includes(scheme)) {
        throw new HostError("raptor:host/capability-unavailable", `schema '${scheme}' nu este declarata`, {
          url,
          declared: [...manifest.deepLinkSchemes],
        });
      }
      pendingDeepLinks.push(url);
      server.emit("deeplink.received", { url });
    },

    close(): void {
      lifecycle.settle("stopped", "host inchis");
      server.close();
    },
  };
}
