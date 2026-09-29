/**
 * RaptorRuntime - runtime server (whitepaper RaptorEngine 19).
 *
 * "Runtime propriu" nu inseamna inlocuirea V8; inseamna platforma de executie
 * server: request lifecycle, SSR/resume, server signals peste RaptorWire,
 * sesiuni si observability (19.1). Cheia: acelasi graf semantic care produce
 * browser output alimenteaza si producerii server + schema wire (9, 15).
 *
 * Nucleul e transport-agnostic. `connect()` ofera un target de memorie
 * (loopback) pentru teste/dev; `node.ts` adauga un target Node HTTP real.
 */
import { raptorServer, type RaptorServer } from "@raptor/wire/server";
import type { WireValue } from "@raptor/wire";
import type { IRComponent } from "@raptor/engine/compiler";
import type { BuildResult } from "@raptor/engine";
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

/** Un capat de canal duplex (aceeasi forma ca ServerConnection/Transport). */
export interface Channel {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  close(): void;
}

/** Pereche in-memory cu livrare asincrona (imita ordonarea retelei). */
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

    // Seed store cu valorile initiale ale server-signals.
    for (const ss of config.serverSignals) this.server.store.setSignal(ss.address, ss.initial);

    // Query auto: un client se aboneaza la "signals" si primeste snapshot +
    // delta live pentru toate adresele RAS (proiectie a server-signals).
    this.server.query("signals", { select: () => this.addresses });
  }

  /** Construieste un runtime dintr-un build RaptorEngine (acelasi graf). */
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

  /** Valoarea curenta a unui server signal (din store). */
  value(address: string): WireValue | undefined {
    return this.server.store.doc.get(address) as WireValue | undefined;
  }

  /** Schema wire declarata pentru o adresa (pentru masurarea payload-ului). */
  schemaFor(address: string): string | null {
    return this.config.serverSignals.find((s) => s.address === address)?.schema ?? null;
  }

  /** Adresele server-signals cunoscute. */
  get signalAddresses(): readonly string[] {
    return this.addresses;
  }

  /** Caile rutate cunoscute. */
  get routePaths(): string[] {
    return this.config.routes.map((r) => r.path);
  }

  /** Actualizeaza un server signal -> broadcast delta catre abonati (15). */
  produce(address: string, value: WireValue): void {
    if (this.stopped) throw new Error("[raptor:run] runtime oprit");
    if (!this.addresses.includes(address)) {
      throw new Error(`[raptor:run] adresa necunoscuta '${address}'`);
    }
    this.server.store.setSignal(address, value);
    this.metrics.opsBroadcast++;
    this.emit("produce", `${address} = ${JSON.stringify(value)}`);
  }

  /**
   * Network transaction (16.1): actualizeaza mai multe server signals atomic,
   * intr-un singur batch -> clientul face UN singur DOM commit. Un "DOM mutation
   * burst" (§22) egal cu numarul de update-uri.
   */
  produceMany(updates: { address: string; value: WireValue }[]): void {
    if (this.stopped) throw new Error("[raptor:run] runtime oprit");
    for (const u of updates) {
      if (!this.addresses.includes(u.address)) {
        throw new Error(`[raptor:run] adresa necunoscuta '${u.address}'`);
      }
    }
    this.server.store.transaction(() => {
      for (const u of updates) this.server.store.setSignal(u.address, u.value);
    });
    this.metrics.opsBroadcast++;
    this.emit("produceMany", `${updates.length} updates atomic`);
  }

  /** Target de memorie: intoarce un capat de client pentru RaptorClient. */
  connect(): Channel {
    if (this.stopped) throw new Error("[raptor:run] runtime oprit");
    const { server, client } = memoryChannel();
    this.server.serve(server);
    this.serverConns.push(server);
    this.metrics.connections++;
    this.metrics.activeConnections++;
    this.emit("connect", `sesiune #${this.metrics.connections}`);

    const runtime = this;
    // Inveleste close-ul clientului ca sa curatam subscription-urile + metricile.
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

  /** SSR pentru o cale rutata; null daca nu exista route. */
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

  /** Log de evenimente (observability, 19.1). */
  get log(): readonly RuntimeEvent[] {
    return this.events;
  }

  /** Graceful shutdown: inchide conexiunile si opreste runtime-ul (19.1). */
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
