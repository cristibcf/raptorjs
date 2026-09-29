/**
 * Host-ul de serviciu: supervizorul de proces, vazut prin aceeasi punte.
 *
 * Pe desktop host-ul da ferestre, pe mobil da ecrane, in browser da istoric si
 * stocare. Pe server da **socketi, configuratie si un semnal de oprire** - si
 * asta acopera exact randul "Servicii platforma" din etapa 3 a roadmap-ului.
 *
 * Trei lucruri sunt deliberate:
 *
 *  1. **Aplicatia nu deschide porturi.** Cere un listener dupa nume, iar portul
 *     vine din manifest. Un serviciu care isi alege singur portul nu poate fi
 *     asezat intr-un supervizor care i-l da gata deschis.
 *  2. **Oprirea este drenare, nu taiere.** `background` inseamna "nu mai primesc
 *     cereri noi, le termin pe cele in zbor". Abia dupa aceea vine `stopped`.
 *  3. **Sanatatea o declara aplicatia.** Host-ul nu ghiceste daca procesul e gata
 *     sa primeasca trafic; aplicatia spune, iar supervizorul citeste.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";
import type { Listener, ListenerFactory, ServeHandler } from "./listener.ts";

export type Health = "starting" | "ready" | "draining" | "unhealthy";

export interface ServiceHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly listeners: ListenerFactory;
  /**
   * Porturile pe care host-ul are voie sa le deschida, dupa nume. Vin din
   * configuratia de deployment, nu din codul aplicatiei.
   */
  readonly ports?: Readonly<Record<string, number>>;
  /** Configuratia si secretele aduse de supervizor. */
  readonly config?: Readonly<Record<string, string>>;
  readonly storage?: Map<string, string>;
  readonly now?: () => number;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface ServiceHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  readonly health: Health;
  readonly listeners: readonly Listener[];
  /** Adresa unui listener deschis, pentru teste si pentru loguri. */
  urlOf(name: string): string | null;
  /** Semnalul de oprire al supervizorului (SIGTERM): dreneaza, apoi opreste. */
  requestDrain(reason?: string): Promise<void>;
  close(): Promise<void>;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/** Aceeasi politica de chei ca pe celelalte host-uri: spatiu plat, fara cai. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `cheie de stocare invalida: ${key}`, {
      key,
      policy: "limitata la directorul de date al serviciului",
    });
  }
  return key;
}

export function createServiceHost(options: ServiceHostOptions): ServiceHost {
  const manifest = options.manifest;
  if (manifest.target !== "server") {
    throw new HostError("raptor:host/manifest-invalid", "createServiceHost cere un manifest cu target 'server'", {
      target: manifest.target,
    });
  }

  const now = options.now ?? (() => Date.now());
  const store = options.storage ?? new Map<string, string>();
  const ports = options.ports ?? {};
  const config = options.config ?? {};
  const lifecycle = createLifecycle();
  const open = new Map<string, { listener: Listener; handler: ServeHandler }>();
  let health: Health = "starting";
  let inFlight = 0;
  let draining: Promise<void> | null = null;

  /**
   * Fiecare cerere trece pe aici. In afara de a numara lucrul in zbor - de care
   * depinde drenarea - opreste traficul nou din clipa in care serviciul nu se mai
   * declara gata: un proces care se inchide nu trebuie sa accepte cereri pe care
   * nu le va termina.
   */
  const guard = (handler: ServeHandler): ServeHandler => {
    return async (request: Request): Promise<Response> => {
      if (health === "draining") {
        return new Response("serviciul se opreste", {
          status: 503,
          headers: { "retry-after": "1", connection: "close" },
        });
      }
      inFlight += 1;
      try {
        return await handler(request);
      } finally {
        inFlight -= 1;
      }
    };
  };

  /**
   * Cererea ajunge la aplicatie ca eveniment cu raspuns.
   *
   * Puntea transporta numai JSON, deci `Request`/`Response` se serializeaza aici.
   * In host-ul nativ, acelasi lucru se va intampla peste canalul lui - iar codul
   * aplicatiei nu vede diferenta.
   */
  const pendingRequests = new Map<number, (response: Response) => void>();
  let requestId = 0;

  async function callApplication(listenerName: string, request: Request): Promise<Response> {
    const id = ++requestId;
    const body = request.method === "GET" || request.method === "HEAD" ? null : await request.text();

    const answer = new Promise<Response>((resolve) => {
      pendingRequests.set(id, resolve);
      const timer = setTimeout(() => {
        if (!pendingRequests.delete(id)) return;
        resolve(new Response("aplicatia nu a raspuns la timp", { status: 504 }));
      }, 10_000);
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
      }
    });

    server.emit("serve.request", {
      id,
      listener: listenerName,
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      atMs: now(),
    });

    return await answer;
  }

  const methods: Record<string, MethodHandler> = {
    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      void host.requestDrain("aplicatia a cerut oprirea");
      return { state: lifecycle.state };
    },

    "health.set": (params) => {
      const next = requireString(params, "state");
      if (next !== "starting" && next !== "ready" && next !== "unhealthy") {
        throw new HostError("raptor:host/protocol", `stare de sanatate necunoscuta: ${next}`, {
          state: next,
          known: ["starting", "ready", "unhealthy"],
        });
      }
      // `draining` apartine host-ului: aplicatia nu se poate declara singura in
      // drenare, fiindca drenarea o porneste semnalul supervizorului.
      if (health !== "draining") health = next;
      server.emit("health.changed", { health });

      // Pentru un serviciu, "foreground" inseamna "primeste trafic". Momentul in
      // care se declara gata este exact momentul in care intra in el.
      if (health === "ready") {
        lifecycle.settle("ready", "serviciu gata");
        lifecycle.settle("foreground", "serviciu gata");
      }
      return { health };
    },

    "serve.listen": async (params) => {
      const name = requireString(params, "name");
      const port = ports[name];
      if (port === undefined) {
        throw new HostError("raptor:host/capability-undeclared", `portul '${name}' nu este alocat acestui serviciu`, {
          name,
          allocated: Object.keys(ports).sort(),
        });
      }
      if (open.has(name)) {
        throw new HostError("raptor:host/protocol", `listenerul '${name}' este deja deschis`, { name });
      }

      // Handlerul aplicatiei nu este chemat direct: intre socket si el sta
      // `guard`, care tine socoteala cererilor si respecta drenarea.
      const handler: ServeHandler = (request: Request): Promise<Response> => callApplication(name, request);
      const listener = await options.listeners.open(name, port, guard(handler));
      open.set(name, { listener, handler });
      server.emit("serve.listening", { name, port: listener.port, url: listener.url });
      return { name, port: listener.port, url: listener.url };
    },

    "serve.stop": async (params) => {
      const name = requireString(params, "name");
      const entry = open.get(name);
      if (!entry) throw new HostError("raptor:host/protocol", `listenerul '${name}' nu este deschis`, { name });
      await entry.listener.close();
      open.delete(name);
      return { name, closed: true };
    },

    "serve.status": () => ({
      listeners: [...open.values()].map((entry) => ({
        name: entry.listener.name,
        port: entry.listener.port,
        url: entry.listener.url,
      })),
      inFlight,
      health,
    }),

    /** Raspunsul aplicatiei la o cerere primita ca `serve.request`. */
    "serve.respond": (params) => {
      const id = params["id"];
      if (typeof id !== "number") {
        throw new HostError("raptor:host/protocol", "serve.respond cere un id numeric", {});
      }
      const resolve = pendingRequests.get(id);
      // Un raspuns intarziat (dupa ce cererea a expirat) nu este o eroare a
      // aplicatiei: spunem doar ca nu mai avea cui fi livrat.
      if (!resolve) return { delivered: false };
      pendingRequests.delete(id);

      const status = typeof params["status"] === "number" ? params["status"] : 200;
      const headers =
        typeof params["headers"] === "object" && params["headers"] !== null
          ? (params["headers"] as Record<string, string>)
          : {};
      const body = typeof params["body"] === "string" ? params["body"] : null;
      resolve(new Response(body, { status, headers }));
      return { delivered: true };
    },

    "config.get": (params) => {
      const key = requireString(params, "key");
      if (!Object.prototype.hasOwnProperty.call(config, key)) return null;
      return config[key] ?? null;
    },

    "storage.get": (params) => store.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      store.set(key, requireString(params, "value"));
      return { key };
    },
    "storage.delete": (params) => ({ deleted: store.delete(requireKey(params)) }),
    "storage.keys": () => [...store.keys()].sort(),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "deployment" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "un serviciu se actualizeaza prin redeployment", {});
    },
  };

  const serverOptions = {
    target: "server" as const,
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

  const host: ServiceHost = {
    server,
    lifecycle,
    get health(): Health {
      return health;
    },
    get listeners(): readonly Listener[] {
      return [...open.values()].map((entry) => entry.listener);
    },

    urlOf(name: string): string | null {
      return open.get(name)?.listener.url ?? null;
    },

    async requestDrain(reason = "SIGTERM"): Promise<void> {
      if (draining) return draining;
      draining = (async (): Promise<void> => {
        health = "draining";
        server.emit("health.changed", { health });
        // Drenarea poate veni si inainte ca serviciul sa fi ajuns sa serveasca
        // (un supervizor care se razgandeste in timpul pornirii): atunci nu
        // exista trafic de drenat si singura tranzitie legala este oprirea.
        if (lifecycle.state === "foreground") lifecycle.settle("background", reason);

        // Socketii se inchid intai: ce a intrat deja se termina, ce vine dupa
        // primeste 503 de la `guard` sau gaseste portul inchis.
        await Promise.all([...open.values()].map((entry) => entry.listener.close()));
        open.clear();

        const deadline = now() + 5000;
        while (inFlight > 0 && now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        lifecycle.settle("stopped", reason);
      })();
      return draining;
    },

    async close(): Promise<void> {
      await host.requestDrain("close");
      server.close();
    },
  };

  return host;
}
