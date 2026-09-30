/**
 * RaptorRuntime - server runtime (whitepaper RaptorEngine 19).
 *
 * "Own runtime" doesn't mean replacing V8; it means the server execution
 * platform: request lifecycle, SSR/resume, server signals over RaptorWire,
 * sessions and observability (19.1). The key: the same semantic graph that
 * produces browser output also feeds the server producers + the wire schema
 * (9, 15).
 *
 * The core is transport-agnostic. `connect()` offers a memory (loopback) target
 * for tests/dev; `node.ts` adds a real Node HTTP target.
 */
import { raptorServer, type RaptorServer } from "@raptorstack/wire/server";
import type { WireValue } from "@raptorstack/wire";
import type { IRComponent } from "@raptorstack/engine/compiler";
import type { BuildResult } from "@raptorstack/engine";
import { matchRoute, type RouteDef } from "./router.ts";
import { renderComponent, renderDocument, type SsrResult } from "./ssr.ts";

export interface ServerSignalDef {
  address: string;
  schema: string | null;
  initial: WireValue;
}

export interface RunConfig {
  serverSignals: ServerSignalDef[];
  routes: RouteDef[];
  components: IRComponent[];
  build?: string;
}

export interface RuntimeMetrics {
  requests: number;
  connections: number;
  activeConnections: number;
  opsBroadcast: number;
}

export interface RuntimeEvent {
  seq: number;
  type: string;
  detail: string;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One end of a duplex channel (same shape as ServerConnection/Transport). */
export interface Channel {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

/** In-memory pair with async delivery (mimics network ordering). */
function memoryChannel(): { server: Channel; client: Channel } {
  let serverHandler: ((d: Uint8Array) => void) | null = null;
  let clientHandler: ((d: Uint8Array) => void) | null = null;
  let closed = false;
  const server: Channel = {
    send(data) {
      if (closed) return;
      const copy = data.slice();
      queueMicrotask(() => clientHandler?.(copy));
    },
    onMessage(h) {
      serverHandler = h;
    },
    close() {
      closed = true;
    },
  };
  const client: Channel = {
    send(data) {
      if (closed) return;
      const copy = data.slice();
      queueMicrotask(() => serverHandler?.(copy));
    },
    onMessage(h) {
      clientHandler = h;
    },
    close() {
      closed = true;
    },
  };
  return { server, client };
}

export class RaptorRuntime {
  readonly server: RaptorServer;
  readonly metrics: RuntimeMetrics;
  private readonly config: RunConfig;
  private readonly addresses: string[];
  private readonly componentsByName: Map<string, IRComponent>;
  private readonly serverConns: Channel[];
  private readonly events: RuntimeEvent[];
  private eventSeq: number;
  private listener: ((e: RuntimeEvent) => void) | null;
  private stopped: boolean;

  constructor(config: RunConfig) {
    this.config = config;
    this.server = raptorServer({ build: config.build ?? "0.1.0" });
    this.addresses = config.serverSignals.map((s) => s.address);
    this.componentsByName = new Map(config.components.map((c) => [c.name, c]));
    this.serverConns = [];
    this.events = [];
    this.eventSeq = 0;
    this.listener = null;
    this.stopped = false;
    this.metrics = { requests: 0, connections: 0, activeConnections: 0, opsBroadcast: 0 };

    // Seed the store with the server-signals' initial values.
    for (const ss of config.serverSignals) this.server.store.setSignal(ss.address, ss.initial);

    // Auto query: a client subscribes to "signals" and receives a snapshot +
    // live delta for all RAS addresses (a projection of the server-signals).
    this.server.query("signals", { select: () => this.addresses });
  }

  /** Builds a runtime from a RaptorEngine build (the same graph). */
  static fromBuild(
    result: BuildResult,
    options: { routes?: RouteDef[]; initial?: Record<string, WireValue> } = {},
  ): RaptorRuntime {
    const serverSignals: ServerSignalDef[] = result.server.producers.map((p) => ({
      address: p.address,
      schema: p.schema,
      initial: options.initial?.[p.address] ?? 0,
    }));
    const routes: RouteDef[] =
      options.routes ??
      (result.ir.components[0] ? [{ path: "/", component: result.ir.components[0].name }] : []);
    return new RaptorRuntime({
      serverSignals,
      routes,
      components: result.ir.components,
      build: result.manifest.engineVersion,
    });
  }

  onEvent(fn: (e: RuntimeEvent) => void): void {
    this.listener = fn;
  }

  private emit(type: string, detail: string): void {
    const e: RuntimeEvent = { seq: ++this.eventSeq, type, detail };
    this.events.push(e);
    this.listener?.(e);
  }

  /** The current value of a server signal (from the store). */
  value(address: string): WireValue | undefined {
    return this.server.store.doc.get(address) as WireValue | undefined;
  }

  /** The wire schema declared for an address (for measuring the payload). */
  schemaFor(address: string): string | null {
    return this.config.serverSignals.find((s) => s.address === address)?.schema ?? null;
  }

  /** The known server-signal addresses. */
  get signalAddresses(): readonly string[] {
    return this.addresses;
  }

  /** The known routed paths. */
  get routePaths(): string[] {
    return this.config.routes.map((r) => r.path);
  }

  /** Updates a server signal -> broadcasts the delta to subscribers (15). */
  produce(address: string, value: WireValue): void {
    if (this.stopped) throw new Error("[raptor:run] runtime stopped");
    if (!this.addresses.includes(address)) {
      throw new Error(`[raptor:run] unknown address '${address}'`);
    }
    this.server.store.setSignal(address, value);
    this.metrics.opsBroadcast++;
    this.emit("produce", `${address} = ${JSON.stringify(value)}`);
  }

  /**
   * Network transaction (16.1): updates several server signals atomically, in a
   * single batch -> the client makes ONE DOM commit. A "DOM mutation burst"
   * (§22) equal to the number of updates.
   */
  produceMany(updates: { address: string; value: WireValue }[]): void {
    if (this.stopped) throw new Error("[raptor:run] runtime stopped");
    for (const u of updates) {
      if (!this.addresses.includes(u.address)) {
        throw new Error(`[raptor:run] unknown address '${u.address}'`);
      }
    }
    this.server.store.transaction(() => {
      for (const u of updates) this.server.store.setSignal(u.address, u.value);
    });
    this.metrics.opsBroadcast++;
    this.emit("produceMany", `${updates.length} atomic updates`);
  }

  /** Memory target: returns a client end for RaptorClient. */
  connect(): Channel {
    if (this.stopped) throw new Error("[raptor:run] runtime stopped");
    const { server, client } = memoryChannel();
    this.server.serve(server);
    this.serverConns.push(server);
    this.metrics.connections++;
    this.metrics.activeConnections++;
    this.emit("connect", `session #${this.metrics.connections}`);

    const runtime = this;
    // Wrap the client's close so we clean up the subscriptions + metrics.
    return {
      send: (d) => client.send(d),
      onMessage: (h) => client.onMessage(h),
      close() {
        client.close();
        server.close();
        runtime.server.store.removeConnection(server);
        const i = runtime.serverConns.indexOf(server);
        if (i >= 0) runtime.serverConns.splice(i, 1);
        runtime.metrics.activeConnections--;
        runtime.emit("disconnect", `active=${runtime.metrics.activeConnections}`);
      },
    };
  }

  /** SSR for a routed path; null if no route exists. */
  ssr(path: string): SsrResult | null {
    const match = matchRoute(this.config.routes, path);
    if (!match) return null;
    const comp = this.componentsByName.get(match.route.component);
    if (!comp) return null;
    return renderComponent(comp, { serverValue: (address) => this.value(address) });
  }

  /** Request lifecycle: routing + SSR + health (19.1). Target-agnostic. */
  handleRequest(method: string, path: string): HttpResult {
    this.metrics.requests++;
    if (path === "/health") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: !this.stopped, metrics: this.metrics }),
      };
    }
    if (method !== "GET") {
      return { status: 405, headers: { "content-type": "text/plain" }, body: "method not allowed" };
    }
    const result = this.ssr(path);
    if (!result) {
      return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
    }
    this.emit("ssr", `${path} -> ${result.resume.component}`);
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: renderDocument(result, result.resume.component),
    };
  }

  /** Event log (observability, 19.1). */
  get log(): readonly RuntimeEvent[] {
    return this.events;
  }

  /** Graceful shutdown: closes the connections and stops the runtime (19.1). */
  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const conn of this.serverConns.splice(0)) {
      this.server.store.removeConnection(conn);
      conn.close();
    }
    this.metrics.activeConnections = 0;
    this.emit("shutdown", "graceful");
  }
}
