/**
 * raptorServer - the TypeScript server SDK (whitepaper 24). Defines queries
 * (reactive projections) and mutations (typed, authorized commands), and
 * manages RaptorWire connections over any transport.
 *
 * Every context carries the connection it came from plus a server-owned
 * session (v0.2.1). Without one, `select()` had only client-supplied `args` to
 * go on, so a projection could not be narrowed to the caller and `authorize`
 * had no basis on which to refuse - the spec's "authorization is done per
 * query/mutation on the server" (21) was not actually writable. `onConnect`
 * establishes that session once per connection, before anything is served.
 */
import {
  encodeMessage,
  decodeMessage,
  encodeOpsFrame,
  AddressBook,
  type HelloMsg,
  type Message,
  type WireValue,
} from "@raptorstack/wire";
import { ReactiveStore, type ServerConnection, type Subscription } from "./store.ts";

/**
 * What a query handler is given. `TSession` defaults to `undefined`, so a
 * single-user server that never declares `onConnect` keeps the 0.2.0 shape
 * (`{ args, store }`) and compiles unchanged.
 */
export interface QueryContext<TSession = undefined> {
  args: WireValue;
  store: ReactiveStore;
  /** Whatever `onConnect` returned for this connection. */
  session: TSession;
  /** The connection asking. Identity comes from here, never from `args`. */
  conn: ServerConnection;
}

export interface QueryDef<TSession = undefined> {
  /** Per-query authorization (whitepaper 21): return false to deny. */
  authorize?: (ctx: QueryContext<TSession>) => boolean;
  /** Projection: the handle prefixes the query exposes. */
  select: (ctx: QueryContext<TSession>) => string[];
}

export interface MutationContext<TSession = undefined> {
  input: WireValue;
  store: ReactiveStore;
  /** Whatever `onConnect` returned for this connection. */
  session: TSession;
  /** The connection asking. Identity comes from here, never from `input`. */
  conn: ServerConnection;
}

export interface MutationDef<TSession = undefined> {
  /**
   * Deliberately synchronous. A mutation is authorized against state the
   * server already holds (the session, the store); making the check awaitable
   * would open a window between "allowed" and "applied" with nothing holding
   * it shut, and every async check a consumer actually needs belongs in `run`.
   */
  authorize?: (ctx: MutationContext<TSession>) => boolean;
  /**
   * May return a promise (v0.2.1). Short I/O-bound commands - rename a
   * conversation, mark a reminder done - were forced into the
   * enqueue-and-report-deltas pattern, which is right for long work and wrong
   * here: there was no way to return a validated result or report failure.
   *
   * Two mutations arriving in order on one connection cannot interleave: the
   * second waits for the first (see the handler chain in `serve`). Across
   * connections they do run concurrently, which is the point.
   *
   * Atomicity: a synchronous `run` is still wrapped in one
   * `store.transaction` and reaches the client as a single atomic frame. An
   * async `run` is wrapped only up to its first `await` - an open transaction
   * spanning an await would absorb other connections' writes into this one's
   * batch - so wrap each group of writes you want delivered together in
   * `store.transaction(() => ...)` yourself, after the I/O.
   */
  run: (ctx: MutationContext<TSession>) => WireValue | Promise<WireValue>;
}

export interface RaptorServerOptions<TSession = undefined> {
  build?: string;
  /**
   * Runs once per connection, on HELLO, before any query or mutation is
   * served. Returns the session the two contexts then carry: read the token
   * off `conn` (a cookie, a header the transport stashed, a resume token) and
   * resolve it to whatever the application calls a user.
   *
   * Throwing (or rejecting) refuses the connection: the server answers ERROR
   * 401 and closes it, so a refused client is never left half-open with an
   * unauthenticated session. While `onConnect` is still running, QUERY and
   * MUTATION frames are refused rather than queued against an absent session.
   *
   * Declaring `onConnect` is what turns the gate on. A server without it
   * behaves exactly as in 0.2.0, including serving a query that arrives before
   * HELLO - there is no identity to wait for.
   */
  onConnect?: (conn: ServerConnection, hello: HelloMsg) => TSession | Promise<TSession>;
}

const PROTOCOL_VERSION = 1;

export interface RaptorServer<TSession = undefined> {
  readonly store: ReactiveStore;
  query(name: string, def: QueryDef<TSession>): RaptorServer<TSession>;
  mutation(name: string, def: MutationDef<TSession>): RaptorServer<TSession>;
  serve(conn: ServerConnection): void;
}

/**
 * The lifecycle of one connection. `handshake` and `connecting` exist only
 * when `onConnect` is declared; otherwise a connection starts out `ready`.
 */
type Phase = "handshake" | "connecting" | "ready" | "closed";

/** A `run` that returned a promise, told apart without assuming `instanceof`. */
function isThenable(value: WireValue | Promise<WireValue>): value is Promise<WireValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function raptorServer<TSession = undefined>(
  options: RaptorServerOptions<TSession> = {},
): RaptorServer<TSession> {
  const store = new ReactiveStore();
  const queries = new Map<string, QueryDef<TSession>>();
  const mutations = new Map<string, MutationDef<TSession>>();
  const build = options.build ?? "0.1.0";
  const onConnect = options.onConnect;
  let sessionSeq = 0;

  // Hot path: operations go out over compact addresses (per-connection RAS), not field names.
  store.onBroadcast((sub: Subscription, batch, sequence) => {
    sub.conn.send(encodeOpsFrame(sub.book, { type: "ops", queryId: sub.queryId, sequence, batch }));
  });

  const api: RaptorServer<TSession> = {
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
      // `undefined` is both the right starting value and the default of
      // `TSession`: a server without `onConnect` has no session, and says so
      // in its types rather than handing handlers a lie.
      let session = undefined as TSession;
      let phase: Phase = onConnect ? "handshake" : "ready";

      /**
       * Strict arrival order per connection. `handle` stays synchronous
       * whenever it can (no `onConnect`), so a 0.2.0 server keeps its exact
       * timing; the chain forms only once something actually awaits, and then
       * every later frame waits behind it instead of racing the session.
       */
      let tail: Promise<void> | null = null;

      /** Refuses the connection for good: no session, no subscriptions, closed. */
      function refuse(): void {
        if (phase === "closed") return;
        phase = "closed";
        store.removeConnection(conn);
        conn.send(encodeMessage({ type: "error", code: 401, message: "unauthorized" }));
        conn.close();
      }

      function welcome(): void {
        conn.send(
          encodeMessage({
            type: "welcome",
            sessionId: `s${++sessionSeq}`,
            epoch: 1,
            serverBuild: build,
          }),
        );
      }

      function handle(msg: Message): void | Promise<void> {
        switch (msg.type) {
          case "hello": {
            if (!onConnect) {
              welcome();
              return;
            }
            // A second HELLO would re-authenticate a connection whose
            // subscriptions already belong to the first session: refuse it
            // rather than silently hand live projections to someone else.
            if (phase !== "handshake") {
              conn.send(encodeMessage({ type: "error", code: 400, message: "session already established" }));
              return;
            }
            phase = "connecting";
            return (async () => {
              let established: TSession;
              try {
                established = await onConnect(conn, msg);
              } catch {
                // The reason is the application's business; the wire says 401.
                refuse();
                return;
              }
              if (phase !== "connecting") return; // closed while we were away
              session = established;
              phase = "ready";
              welcome();
            })();
          }
          case "query": {
            if (phase !== "ready") {
              conn.send(encodeMessage({ type: "error", code: 401, message: "session not established" }));
              return;
            }
            const def = queries.get(msg.name);
            if (!def) {
              conn.send(encodeMessage({ type: "error", code: 404, message: `unknown query: ${msg.name}` }));
              return;
            }
            const ctx: QueryContext<TSession> = { args: msg.args, store, session, conn };
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
                return;
              }
            }
            // First sync (or fallback): a full snapshot of the projection.
            conn.send(
              encodeMessage({ type: "snapshot", queryId: msg.queryId, snapshot: store.snapshotFor(prefixes) }),
            );
            return;
          }
          case "mutation": {
            if (phase !== "ready") {
              conn.send(
                encodeMessage({
                  type: "mutationResult",
                  requestId: msg.requestId,
                  ok: false,
                  value: "session not established",
                }),
              );
              return;
            }
            const def = mutations.get(msg.name);
            if (!def) {
              conn.send(encodeMessage({ type: "error", code: 404, message: `unknown mutation: ${msg.name}` }));
              return;
            }
            const ctx: MutationContext<TSession> = { input: msg.input, store, session, conn };
            if (def.authorize && !def.authorize(ctx)) {
              conn.send(
                encodeMessage({ type: "mutationResult", requestId: msg.requestId, ok: false, value: "unauthorized" }),
              );
              return;
            }
            const reply = (ok: boolean, value: WireValue): void =>
              conn.send(encodeMessage({ type: "mutationResult", requestId: msg.requestId, ok, value }));

            let result: WireValue | Promise<WireValue>;
            try {
              // The transaction closes when `run` RETURNS, which for an async
              // handler is at its first await. That is on purpose: see the
              // atomicity note on `MutationDef.run`.
              result = store.transaction(() => def.run(ctx));
            } catch (err) {
              reply(false, String(err));
              return;
            }
            if (!isThenable(result)) {
              reply(true, result);
              return;
            }
            // Every exit path answers: a rejected mutation must produce
            // `ok: false`, never leave the client awaiting a reply forever.
            return result.then(
              (value) => reply(true, value),
              (err: unknown) => reply(false, String(err)),
            );
          }
          case "ack":
            // MVP: the acknowledged sequence number is ignored (resume later).
            return;
          default:
            conn.send(encodeMessage({ type: "error", code: 400, message: `unexpected frame: ${msg.type}` }));
        }
      }

      /** Queues `work` behind whatever is already in flight on this connection. */
      function chain(work: Promise<void>): void {
        const link: Promise<void> = work.then(
          () => {
            if (tail === link) tail = null;
          },
          (err: unknown) => {
            if (tail === link) tail = null;
            // Fail-closed (21): a handler that rejects must not take the
            // process down, and must not look like success to the client.
            console.warn("[raptor] server handler rejected:", err);
            if (phase !== "closed") {
              conn.send(encodeMessage({ type: "error", code: 500, message: "internal error" }));
            }
          },
        );
        tail = link;
      }

      conn.onMessage((bytes) => {
        if (phase === "closed") return;
        let msg: Message;
        try {
          msg = decodeMessage(bytes);
        } catch (err) {
          conn.send(encodeMessage({ type: "error", code: 400, message: String(err) }));
          return;
        }
        if (tail) {
          chain(tail.then(() => (phase === "closed" ? undefined : handle(msg))));
          return;
        }
        const work = handle(msg);
        if (work) chain(work);
      });
    },
  };
  return api;
}

export { PROTOCOL_VERSION };
