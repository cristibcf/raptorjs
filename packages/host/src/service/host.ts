/**
 * The service host: the process supervisor, seen through the same bridge.
 *
 * On desktop the host gives windows, on mobile it gives screens, in the browser
 * it gives history and storage. On server it gives **sockets, configuration and
 * a shutdown signal** - and that covers exactly the "Platform services" row of
 * roadmap stage 3.
 *
 * Three things are deliberate:
 *
 *  1. **The app does not open ports.** It requests a listener by name, and the
 *     port comes from the manifest. A service that chooses its own port cannot
 *     be placed in a supervisor that hands it one already open.
 *  2. **Shutdown is draining, not cutting.** `background` means "I no longer
 *     take new requests, I finish the in-flight ones". Only then comes `stopped`.
 *  3. **Health is declared by the app.** The host does not guess whether the
 *     process is ready to take traffic; the app says so, and the supervisor reads it.
 */
import { HostError, createLifecycle, serveHost } from "@raptorstack/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptorstack/host";
import type { Listener, ListenerFactory, ServeHandler } from "./listener.ts";

export type Health = "starting" | "ready" | "draining" | "unhealthy";

export interface ServiceHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly listeners: ListenerFactory;
  /**
   * The ports the host is allowed to open, by name. They come from the
   * deployment configuration, not from the app's code.
   */
  readonly ports?: Readonly<Record<string, number>>;
  /** The configuration and secrets brought in by the supervisor. */
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
  /** The address of an open listener, for tests and for logs. */
  urlOf(name: string): string | null;
  /** The supervisor's shutdown signal (SIGTERM): drains, then stops. */
  requestDrain(reason?: string): Promise<void>;
  close(): Promise<void>;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/** The same key policy as on the other hosts: a flat space, no paths. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `invalid storage key: ${key}`, {
      key,
      policy: "limited to the service's data directory",
    });
  }
  return key;
}

export function createServiceHost(options: ServiceHostOptions): ServiceHost {
  const manifest = options.manifest;
  if (manifest.target !== "server") {
    throw new HostError("raptor:host/manifest-invalid", "createServiceHost requires a manifest with target 'server'", {
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
   * Every request passes through here. Besides counting the in-flight work -
   * which draining depends on - it stops new traffic the moment the service no
   * longer declares itself ready: a process that is shutting down must not
   * accept requests it will not finish.
   */
  const guard = (handler: ServeHandler): ServeHandler => {
    return async (request: Request): Promise<Response> => {
      if (health === "draining") {
        return new Response("the service is shutting down", {
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
   * The request reaches the app as an event with a response.
   *
   * The bridge carries only JSON, so `Request`/`Response` are serialized here.
   * In the native host, the same thing will happen over its own channel - and
   * the app's code sees no difference.
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
        resolve(new Response("the app did not respond in time", { status: 504 }));
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
      void host.requestDrain("the app requested a stop");
      return { state: lifecycle.state };
    },

    "health.set": (params) => {
      const next = requireString(params, "state");
      if (next !== "starting" && next !== "ready" && next !== "unhealthy") {
        throw new HostError("raptor:host/protocol", `unknown health state: ${next}`, {
          state: next,
          known: ["starting", "ready", "unhealthy"],
        });
      }
      // `draining` belongs to the host: the app cannot declare itself draining,
      // because draining is started by the supervisor's signal.
      if (health !== "draining") health = next;
      server.emit("health.changed", { health });

      // For a service, "foreground" means "takes traffic". The moment it
      // declares itself ready is exactly the moment it enters it.
      if (health === "ready") {
        lifecycle.settle("ready", "service ready");
        lifecycle.settle("foreground", "service ready");
      }
      return { health };
    },

    "serve.listen": async (params) => {
      const name = requireString(params, "name");
      const port = ports[name];
      if (port === undefined) {
        throw new HostError("raptor:host/capability-undeclared", `port '${name}' is not allocated to this service`, {
          name,
          allocated: Object.keys(ports).sort(),
        });
      }
      if (open.has(name)) {
        throw new HostError("raptor:host/protocol", `listener '${name}' is already open`, { name });
      }

      // The app's handler is not called directly: between the socket and it
      // sits `guard`, which keeps count of the requests and honors draining.
      const handler: ServeHandler = (request: Request): Promise<Response> => callApplication(name, request);
      const listener = await options.listeners.open(name, port, guard(handler));
      open.set(name, { listener, handler });
      server.emit("serve.listening", { name, port: listener.port, url: listener.url });
      return { name, port: listener.port, url: listener.url };
    },

    "serve.stop": async (params) => {
      const name = requireString(params, "name");
      const entry = open.get(name);
      if (!entry) throw new HostError("raptor:host/protocol", `listener '${name}' is not open`, { name });
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

    /** The app's response to a request received as `serve.request`. */
    "serve.respond": (params) => {
      const id = params["id"];
      if (typeof id !== "number") {
        throw new HostError("raptor:host/protocol", "serve.respond requires a numeric id", {});
      }
      const resolve = pendingRequests.get(id);
      // A delayed response (after the request timed out) is not an app error:
      // we just say there was no longer anyone to deliver it to.
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
      throw new HostError("raptor:host/unimplemented", "a service updates through redeployment", {});
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
        // Draining can also come before the service ever started serving (a
        // supervisor that changes its mind during startup): then there is no
        // traffic to drain and the only legal transition is the stop.
        if (lifecycle.state === "foreground") lifecycle.settle("background", reason);

        // The sockets close first: what already came in finishes, what comes
        // after gets a 503 from `guard` or finds the port closed.
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
