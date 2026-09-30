/**
 * The server definition for the realtime dashboard, reused by the demo and the
 * e2e test. Metrics (cpu/memory) as server signals, plus a "jobs" collection of
 * ids and "job:ID" objects updated through delta patches (whitepaper 24, 26.1).
 */
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptorstack/wire/server";

export const DASHBOARD_QUERY = "dashboard";
export const DASHBOARD_PREFIXES = ["cpu", "memory", "jobs", "job:"];

export function addJob(store: ReactiveStore, id: number, name: string, progress = 0): void {
  store.transaction(() => {
    store.setField(`job:${id}`, "name", name);
    store.setField(`job:${id}`, "progress", progress);
    store.append("jobs", id);
  });
}

export function buildDashboardApp(): RaptorServer {
  const app = raptorServer({ build: "dashboard-0.1.0" });

  app.query(DASHBOARD_QUERY, {
    // The projection exposed to the client: metrics + list + job objects.
    select: () => DASHBOARD_PREFIXES,
  });

  app.mutation("addJob", {
    authorize: () => true,
    run: ({ input, store }) => {
      const job = input as { id: number; name: string };
      addJob(store, job.id, job.name, 0);
      return { ok: true, id: job.id };
    },
  });

  app.mutation("setProgress", {
    run: ({ input, store }) => {
      const { id, progress } = input as { id: number; progress: number };
      // A single field patch -> minimal delta on the wire.
      store.patch(`job:${id}`, { progress });
      return { id, progress };
    },
  });

  // Initial seed.
  const store = app.store;
  store.setSignal("cpu", 12);
  store.setSignal("memory", 40);
  addJob(store, 1, "build", 10);
  addJob(store, 2, "test", 30);
  addJob(store, 3, "deploy", 0);

  return app;
}
