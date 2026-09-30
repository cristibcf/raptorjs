/**
 * The same application, a fourth time: now as an HTTP service.
 *
 * What stays identical to `desktop-shell`, `mobile-shell` and `web-shell`: the
 * state lives in `@raptorstack/raptorjs` signals, and everything platform-related goes
 * through `bridge`. What changes is the shape of the interaction - here there is
 * no DOM and no user, just requests coming in and responses going out.
 *
 * Requests arrive as `serve.request` events and leave through `serve.respond`,
 * because the bridge only transports JSON. This looks like a detour compared to a
 * directly called handler, but it is exactly the path a request will take when
 * the host is a separate process - so the code here does not change then.
 */
import { derived, state } from "@raptorstack/raptorjs";
import type { HostBridge } from "@raptorstack/host";

export interface Note {
  readonly text: string;
  readonly atMs: number;
}

export interface Service {
  readonly notes: () => readonly Note[];
  readonly url: () => string | null;
  readonly ready: () => boolean;
  readonly served: () => number;
  /** The summary that `/health` also reports. */
  readonly summary: () => string;
  /** Requests the listener, loads the state and declares itself ready for traffic. */
  start(): Promise<void>;
  /** Stops accepting new requests and tells the host it is no longer ready. */
  stop(): Promise<void>;
}

const NOTES_KEY = "notes";

interface RequestEvent {
  readonly id: number;
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

export function createService(bridge: HostBridge): Service {
  const notes = state<readonly Note[]>([]);
  const url = state<string | null>(null);
  const ready = state(false);
  const served = state(0);
  let greeting = "Raptor Service";

  const summary = derived(() => `${ready() ? "ready" : "starting"} - ${notes().length} notes, ${served()} requests`);

  const json = (value: unknown, status = 200): { status: number; headers: Record<string, string>; body: string } => ({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

  /** Minimal routing; the contract is Web-standard, not a custom framework. */
  const handle = async (event: RequestEvent): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
    const path = new URL(event.url).pathname;

    if (event.method === "GET" && path === "/health") {
      // The health reported here and the one declared to the host are the same truth.
      return json({ status: ready() ? "ready" : "starting", notes: notes().length, served: served() });
    }
    if (event.method === "GET" && path === "/note") {
      return json({ greeting, notes: notes() });
    }
    if (event.method === "POST" && path === "/note") {
      let text: unknown;
      try {
        text = (JSON.parse(event.body ?? "{}") as { text?: unknown }).text;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        return json({ error: "the 'text' field is required" }, 400);
      }

      const next = [...notes(), { text: text.trim(), atMs: Date.now() }];
      // Write to the host before publishing the state, as in the other three shells.
      await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
      notes.set(next);
      return json({ stored: next.length }, 201);
    }

    return json({ error: `no route for ${event.method} ${path}` }, 404);
  };

  bridge.on("serve.request", (payload) => {
    const event = payload as unknown as RequestEvent;
    void (async (): Promise<void> => {
      served.update((count) => count + 1);
      let answer: { status: number; headers: Record<string, string>; body: string };
      try {
        answer = await handle(event);
      } catch (error) {
        // A request that crashes must not leave the socket hanging: the host
        // waits for a `serve.respond` for every `serve.request`.
        answer = json({ error: (error as Error).message }, 500);
      }
      await bridge.call("serve.respond", { id: event.id, ...answer });
    })();
  });

  return {
    notes: () => notes(),
    url: () => url(),
    ready: () => ready(),
    served: () => served(),
    summary: () => summary(),

    async start(): Promise<void> {
      const configured = await bridge.call<string | null>("config.get", { key: "GREETING" });
      if (configured) greeting = configured;

      const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
      if (stored) notes.set(JSON.parse(stored) as Note[]);

      // The port is not chosen by the app: it requests the listener by name, the
      // host knows which port the deployment allocated it.
      const listener = await bridge.call<{ url: string }>("serve.listen", { name: "public" });
      url.set(listener.url);

      await bridge.call("health.set", { state: "ready" });
      ready.set(true);
    },

    async stop(): Promise<void> {
      await bridge.call("health.set", { state: "unhealthy" });
      ready.set(false);
      await bridge.call("serve.stop", { name: "public" });
      url.set(null);
    },
  };
}
