/**
 * raptorServer - the TypeScript server SDK (whitepaper 24). Defines queries
 * (reactive projections) and mutations (typed, authorized commands), and
 * manages RaptorWire connections over any transport.
 */
import {
  encodeMessage,
  decodeMessage,
  encodeOpsFrame,
  AddressBook,
  type Message,
  type WireValue,
} from "@raptor/wire";
import { ReactiveStore, type ServerConnection, type Subscription } from "./store.ts";

export interface QueryContext {
  args: WireValue;
  store: ReactiveStore;
}

export interface QueryDef {
  /** Per-query authorization (whitepaper 21): return false to deny. */
  authorize?: (ctx: QueryContext) => boolean;
  /** Projection: the handle prefixes the query exposes. */
  select: (ctx: QueryContext) => string[];
}

export interface MutationContext {
  input: WireValue;
  store: ReactiveStore;
}

export interface MutationDef {
  authorize?: (ctx: MutationContext) => boolean;
  run: (ctx: MutationContext) => WireValue;
}

export interface RaptorServerOptions {
  build?: string;
}

const PROTOCOL_VERSION = 1;

export interface RaptorServer {
  readonly store: ReactiveStore;
  query(name: string, def: QueryDef): RaptorServer;
  mutation(name: string, def: MutationDef): RaptorServer;
  serve(conn: ServerConnection): void;
}

export function raptorServer(options: RaptorServerOptions = {}): RaptorServer {
  const store = new ReactiveStore();
  const queries = new Map<string, QueryDef>();
  const mutations = new Map<string, MutationDef>();
  const build = options.build ?? "0.1.0";
  let sessionSeq = 0;

  // Hot path: operations go out over compact addresses (per-connection RAS), not field names.
  store.onBroadcast((sub: Subscription, batch, sequence) => {
    sub.conn.send(encodeOpsFrame(sub.book, { type: "ops", queryId: sub.queryId, sequence, batch }));
  });

  const api: RaptorServer = {
    store,
    query(name, def) {
      queries.set(name, def);
      return api;
    },
    mutation(name, def) {
      mutations.set(name, def);
      return api;
    },
    serve(conn) {
      // Reactive Address Space per connection (one session = one address space, v0.2 5.2).
      const book = new AddressBook();
      conn.onMessage((bytes) => {
        let msg: Message;
        try {
          msg = decodeMessage(bytes);
        } catch (err) {
          conn.send(encodeMessage({ type: "error", code: 400, message: String(err) }));
          return;
        }
        switch (msg.type) {
          case "hello": {
            conn.send(
              encodeMessage({
                type: "welcome",
                sessionId: `s${++sessionSeq}`,
                epoch: 1,
                serverBuild: build,
              }),
            );
            break;
          }
          case "query": {
            const def = queries.get(msg.name);
            if (!def) {
              conn.send(encodeMessage({ type: "error", code: 404, message: `unknown query: ${msg.name}` }));
              return;
            }
            const ctx: QueryContext = { args: msg.args, store };
            if (def.authorize && !def.authorize(ctx)) {
              conn.send(encodeMessage({ type: "error", code: 403, message: "unauthorized" }));
              return;
            }
            const prefixes = def.select(ctx);
            const sub: Subscription = { conn, queryId: msg.queryId, prefixes, seq: 0, book };
            store.addSubscription(sub);

            // Automatic delta resync (v0.2, 14.3): attempt incremental replay.
            if (msg.sinceVersion !== undefined && msg.sinceVersion > 0) {
              const res = store.resyncSince(msg.sinceVersion, prefixes);
              if (res.mode === "delta") {
                sub.seq++;
                conn.send(
                  encodeOpsFrame(book, {
                    type: "ops",
                    queryId: msg.queryId,
                    sequence: sub.seq,
                    batch: {
                      baseVersion: res.base,
                      resultVersion: res.toVersion,
                      atomic: res.ops.length > 1,
                      ops: res.ops,
                    },
                  }),
                );
                break;
              }
            }
            // First sync (or fallback): a full snapshot of the projection.
            conn.send(
              encodeMessage({ type: "snapshot", queryId: msg.queryId, snapshot: store.snapshotFor(prefixes) }),
            );
            break;
          }
          case "mutation": {
            const def = mutations.get(msg.name);
            if (!def) {
              conn.send(encodeMessage({ type: "error", code: 404, message: `unknown mutation: ${msg.name}` }));
              return;
            }
            const ctx: MutationContext = { input: msg.input, store };
            if (def.authorize && !def.authorize(ctx)) {
              conn.send(
                encodeMessage({ type: "mutationResult", requestId: msg.requestId, ok: false, value: "unauthorized" }),
              );
              return;
            }
            try {
              const result = store.transaction(() => def.run(ctx));
              conn.send(
                encodeMessage({ type: "mutationResult", requestId: msg.requestId, ok: true, value: result }),
              );
            } catch (err) {
              conn.send(
                encodeMessage({ type: "mutationResult", requestId: msg.requestId, ok: false, value: String(err) }),
              );
            }
            break;
          }
          case "ack":
            // MVP: the acknowledged sequence number is ignored (resume later).
            break;
          default:
            conn.send(encodeMessage({ type: "error", code: 400, message: `unexpected frame: ${msg.type}` }));
        }
      });
    },
  };
  return api;
}

export { PROTOCOL_VERSION };
