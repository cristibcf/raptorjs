/**
 * Definitia serverului pentru dashboard-ul realtime, reutilizata de demo si de
 * testul e2e. Metrici (cpu/memory) ca signals server, plus o colectie "jobs" de
 * id-uri si obiecte "job:ID" actualizate prin patch-uri delta (whitepaper 24, 26.1).
 */
import { raptorServer, type RaptorServer, type ReactiveStore } from "@raptor/wire/server";

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
    // Proiectia expusa clientului: metrici + lista + obiectele de job.
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
      // Un singur field patch -> delta minim pe fir.
      store.patch(`job:${id}`, { progress });
      return { id, progress };
    },
  });

  // Seed initial.
  const store = app.store;
  store.setSignal("cpu", 12);
  store.setSignal("memory", 40);
  addJob(store, 1, "build", 10);
  addJob(store, 2, "test", 30);
  addJob(store, 3, "deploy", 0);

  return app;
}
