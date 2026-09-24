/**
 * Host-ul de browser.
 *
 * **Ce este si ce nu este.** Pe desktop si pe mobil, puntea traverseaza un
 * proces: refuzul host-ului este o granita de securitate reala. In browser nu
 * exista asa ceva - pagina si "host-ul" sunt acelasi izolat, iar granita reala
 * este sandbox-ul de origine al browserului. Verificarile de aici sunt deci
 * *portabilitate si disciplina*, nu izolare: garanteaza ca o aplicatie scrisa pe
 * contractul Raptor se comporta la fel pe toate cele trei tinte si ca nu se
 * sprijina pe ceva ce lipseste pe unele dintre ele. Nu garanteaza ca un cod
 * ostil din aceeasi pagina nu poate atinge `localStorage` direct - poate.
 *
 * Diferenta fata de celelalte doua adaptoare, in doua randuri:
 *  - navigarea este impartita: si pagina o poate conduce (History API), si
 *    utilizatorul o poate schimba de sub ea (butonul de back), deci adaptorul
 *    asculta `popstate` si anunta aplicatia exact ca pe mobil;
 *  - meniurile si subprocesele nu exista, iar `update.*` nu are ce raporta:
 *    o pagina web se "actualizeaza" prin reincarcare.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";
import type { WebPlatform } from "./platform.ts";

export interface WebHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly platform: WebPlatform;
  /** Prefix pentru cheile din `localStorage`; implicit din `bundleId`. */
  readonly storagePrefix?: string;
  readonly initialRoute?: string;
  readonly now?: () => number;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface WebHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  readonly route: string;
  /** Deep link-urile web sunt URL-uri de intrare, nu scheme proprii. */
  deliverDeepLink(url: string): void;
  /** Butonul de back al browserului, sau orice schimbare din afara paginii. */
  routeChanged(path: string): void;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/** Aceeasi politica de chei ca pe native: spatiu plat, fara cai. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `cheie de stocare invalida: ${key}`, {
      key,
      policy: "limitata la originea paginii",
    });
  }
  return key;
}

function missing(module: string): never {
  throw new HostError("raptor:host/unimplemented", `mediul acestei pagini nu ofera '${module}'`, { module });
}

export function createWebHost(options: WebHostOptions): WebHost {
  const manifest = options.manifest;
  if (manifest.target !== "web") {
    throw new HostError("raptor:host/manifest-invalid", "createWebHost cere un manifest cu target 'web'", {
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
      throw new HostError("raptor:host/capability-unavailable", `navigare refuzata catre '${url}'`, {
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
      // O pagina nu se inchide singura: `window.close()` este ignorat pentru
      // pagini pe care nu le-a deschis scriptul. Trecerea in fundal este tot ce
      // se poate spune cinstit aici.
      lifecycle.settle("background", "aplicatia a cerut oprirea");
      return { state: lifecycle.state, note: "o pagina web nu se poate inchide singura" };
    },

    "deeplink.pending": () => {
      const pending = [...pendingDeepLinks];
      pendingDeepLinks.length = 0;
      return pending;
    },

    "navigation.current": () => ({ route, depth: platform.history?.length ?? 1 }),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "reload" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "o pagina web se actualizeaza prin reincarcare", {});
    },

    // Pe web, `window.manage` acopera navigarea proprie si popup-urile.
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
        // Browserul blocheaza popup-urile fara gest de utilizator. Spunem asta,
        // in loc sa raportam un succes care nu s-a intamplat.
        throw new HostError("raptor:host/capability-unavailable", "popup blocat de browser (lipseste gestul de utilizator)", {
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
        // Alte aplicatii pot imparti aceeasi origine: le sarim, nu le listam.
        if (key !== null && key.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys.sort();
    },

    "notify.show": async (params) => {
      if (!platform.notifications) missing("Notification");
      const permission = await platform.notifications.requestPermission();
      if (permission !== "granted") {
        throw new HostError("raptor:host/capability-unavailable", "utilizatorul nu a acordat permisiunea de notificari", {
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

  // Butonul de back schimba ruta fara sa treaca prin aplicatie - exact cazul
  // pentru care exista `navigation.changed` si pe mobil.
  platform.onPopState?.((path) => setRoute(path, "popstate"));

  return {
    server,
    lifecycle,
    get route(): string {
      return route;
    },

    deliverDeepLink(url: string): void {
      // Pe web nu exista scheme proprii inregistrate in sistem: un "deep link"
      // este URL-ul cu care a fost deschisa pagina. Il validam ca origine.
      if (!allowsUrl(url)) {
        throw new HostError("raptor:host/capability-unavailable", `deep link din afara originilor permise: ${url}`, {
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
      lifecycle.settle("stopped", "host inchis");
      server.close();
    },
  };
}
