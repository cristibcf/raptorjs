/**
 * Host-ul desktop de referinta.
 *
 * Implementeaza metodele puntii exact cum le va implementa binarul nativ, dar in
 * proces: ferestre ca stare, stocare intr-un magazin injectabil, notificari
 * colectate. Rostul lui nu este sa inlocuiasca adaptorul nativ, ci sa fixeze
 * *comportamentul* pe care acela trebuie sa il reproduca - politicile de mai jos
 * (navigare in allowlist, stocare in directorul aplicatiei, subprocese doar din
 * lista explicita) sunt partea care nu are voie sa difere intre implementari.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";

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
  /** Magazinul de stocare locala; implicit in memorie. */
  readonly storage?: Map<string, string>;
  /**
   * Comenzile permise pentru subprocese. Vin din `raptor.runtime.json`
   * (`capabilities["process.spawn"]`): manifestul de host spune *daca*
   * aplicatia are voie sa porneasca procese, cel de runtime spune *care*.
   */
  readonly allowedCommands?: readonly string[];
  readonly runCommand?: (command: string, args: readonly string[]) => Promise<SpawnOutcome>;
  /** Versiunea oferita de canalul de actualizari, sau `null` daca nu exista. */
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
  /** Un deep link venit din sistem; schema trebuie sa fie declarata. */
  deliverDeepLink(url: string): void;
  /** O comanda de meniu apasata de utilizator. */
  invokeMenu(id: string): void;
  close(): void;
}

const WINDOW_LIMIT = 16;

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/**
 * Cheile de stocare traiesc intr-un spatiu plat, legat de aplicatie. Orice cheie
 * care arata a cale (separatori sau `..`) este refuzata: politica sectiunii 6
 * spune "limitata la directorul aplicatiei", iar cel mai simplu mod de a o tine
 * este sa nu existe deloc cai in chei.
 */
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

export function createDesktopHost(options: DesktopHostOptions): DesktopHost {
  const manifest = options.manifest;
  if (manifest.target !== "desktop") {
    throw new HostError("raptor:host/manifest-invalid", "createDesktopHost cere un manifest cu target 'desktop'", {
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

  /** Navigarea este permisa spre aplicatia insasi sau spre originile declarate. */
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
      throw new HostError("raptor:host/capability-unavailable", `navigare refuzata catre '${url}'`, {
        url,
        allowedOrigins: [...manifest.allowedOrigins],
      });
    }
    return url;
  };

  const findWindow = (id: string): WindowState => {
    const found = windows.find((window) => window.id === id);
    if (!found) {
      throw new HostError("raptor:host/protocol", `fereastra '${id}' nu exista`, { id });
    }
    return found;
  };

  const methods: Record<string, MethodHandler> = {
    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      lifecycle.settle("stopped", "aplicatia a cerut oprirea");
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
        throw new HostError("raptor:host/unimplemented", "nu exista nicio actualizare de aplicat", {
          channel: manifest.update.channel,
        });
      }
      if (manifest.update.feed === null) {
        // Fara feed, distributia vine din magazin; aplicatia nu se actualizeaza singura.
        throw new HostError("raptor:host/unimplemented", "canalul este gestionat de magazin, nu de aplicatie", {});
      }
      lifecycle.settle("stopped", "repornire pentru actualizare");
      return { applied: true, version: options.availableUpdate.version };
    },

    "window.open": (params) => {
      if (windows.length >= WINDOW_LIMIT) {
        throw new HostError("raptor:host/capability-unavailable", `limita de ${WINDOW_LIMIT} ferestre atinsa`, {
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
      if (index < 0) throw new HostError("raptor:host/protocol", `fereastra '${id}' nu exista`, { id });
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
        throw new HostError("raptor:host/protocol", "menu.set cere o lista de elemente", {});
      }
      menu = items.map((item, index) => {
        if (typeof item !== "object" || item === null) {
          throw new HostError("raptor:host/protocol", `elementul de meniu ${index} nu este un obiect`, { index });
        }
        const record = item as Record<string, unknown>;
        if (typeof record["id"] !== "string" || typeof record["label"] !== "string") {
          throw new HostError("raptor:host/protocol", `elementul de meniu ${index} cere { id, label }`, { index });
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
        // Sectiunea 6: "doar desktop, cu lista explicita". Capabilitatea deschide
        // usa, lista din raptor.runtime.json spune pe cine lasa sa intre.
        throw new HostError("raptor:host/capability-undeclared", `comanda '${command}' nu este in lista explicita`, {
          command,
          allowed: [...allowedCommands].sort(),
        });
      }
      if (!options.runCommand) {
        throw new HostError("raptor:host/unimplemented", "host-ul nu are un executor de comenzi configurat", {
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
        throw new HostError("raptor:host/protocol", `deep link invalid: ${url}`, { url });
      }
      if (!manifest.deepLinkSchemes.includes(scheme)) {
        // Un link cu schema nedeclarata nu apartine acestei aplicatii.
        throw new HostError("raptor:host/capability-unavailable", `schema '${scheme}' nu este declarata`, {
          url,
          declared: [...manifest.deepLinkSchemes],
        });
      }
      pendingDeepLinks.push(url);
      server.emit("deeplink.received", { url });
    },

    invokeMenu(id: string): void {
      if (!menu.some((item) => item.id === id)) {
        throw new HostError("raptor:host/protocol", `comanda de meniu '${id}' nu exista`, { id });
      }
      server.emit("menu.command", { id });
    },

    close(): void {
      lifecycle.settle("stopped", "host inchis");
      server.close();
    },
  };
}
