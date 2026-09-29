/**
 * Live, interactive demos used across the site (Home, Learn, Playground). Each is
 * a plain function returning real DOM — the same fine-grained runtime that ships.
 */
import { state, derived, effect, For, onCleanup } from "raptorjs/dom";
import { raptorServer } from "@raptor/wire/server";
import { createLoopback, flushLoopback, RaptorClient } from "@raptor/wire/client";

/* ------------------------------------------------------------------ Counter -- */
export function DemoCounter() {
  const count = state(0);
  const doubled = derived(() => count() * 2);
  const parity = derived(() => (count() % 2 === 0 ? "even" : "odd"));
  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="counter-val" style="margin:6px 0 12px">{count}</div>
      <div class="row" style="margin-bottom:14px">
        <button class="sbtn" on:click={() => count.update((n) => n - 1)}>−</button>
        <button class="sbtn" on:click={() => count.update((n) => n + 1)}>+</button>
        <button class="sbtn" style="width:auto;padding:0 14px;font-size:14px" on:click={() => count.set(0)}>reset</button>
      </div>
      <div class="row">
        <span class="chip">doubled = <b>{doubled}</b></span>
        <span class="chip">parity = <b>{parity}</b></span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Todo -- */
interface Todo {
  id: number;
  text: string;
  done: boolean;
}
export function DemoTodo() {
  const items = state<Todo[]>([
    { id: 1, text: "Learn signals", done: true },
    { id: 2, text: "Build a component", done: false },
    { id: 3, text: "Ship it", done: false },
  ]);
  let nextId = 4;
  let inputEl: any = null;
  const isDone = (id: number) => () => items().find((i) => i.id === id)?.done ?? false;
  const remaining = derived(() => items().filter((i) => !i.done).length);

  const add = () => {
    const v = String(inputEl?.value ?? "").trim();
    if (!v) return;
    items.update((xs) => [...xs, { id: nextId++, text: v, done: false }]);
    if (inputEl) inputEl.value = "";
  };
  const toggle = (id: number) => items.update((xs) => xs.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const remove = (id: number) => items.update((xs) => xs.filter((i) => i.id !== id));

  return (
    <div class="demo">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div class="badge-live">live</div>
        <span class="chip"><b>{remaining}</b> left</span>
      </div>
      <div class="row" style="margin-bottom:12px;flex-wrap:nowrap">
        <input
          class="pg-code"
          style="height:auto;padding:9px 12px;flex:1;font-family:var(--sans);font-size:14px"
          placeholder="Add a task, press Enter…"
          ref={(el: any) => (inputEl = el)}
          on:keydown={(e: any) => {
            if (e.key === "Enter") add();
          }}
        />
        <button class="sbtn" style="width:auto;padding:0 16px" on:click={add}>Add</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <For each={() => items()}>
          {(it: Todo) => (
            <div class="row" style="justify-content:space-between;padding:6px 2px;border-bottom:1px solid var(--border)">
              <div class="row" style="cursor:pointer;gap:9px" on:click={() => toggle(it.id)}>
                <span style="font-size:17px">{() => (isDone(it.id)() ? "☑" : "☐")}</span>
                <span style={() => (isDone(it.id)() ? "text-decoration:line-through;color:var(--dim)" : "")}>{it.text}</span>
              </div>
              <button class="sbtn" style="width:30px;height:30px;font-size:15px" on:click={() => remove(it.id)}>✕</button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Temperature -- */
export function DemoTemperature() {
  const celsius = state(20);
  const fahrenheit = derived(() => Math.round((celsius() * 9) / 5 + 32));
  const label = derived(() => (celsius() <= 0 ? "freezing" : celsius() < 25 ? "comfortable" : celsius() < 35 ? "warm" : "hot"));
  let slider: any = null;
  effect(() => {
    if (slider) slider.value = String(celsius());
  });
  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="gap:24px;margin:10px 0 16px">
        <div class="stat"><span class="lbl">Celsius</span><span class="metric-big">{() => celsius() + "°C"}</span></div>
        <div class="stat"><span class="lbl">Fahrenheit</span><span class="metric-big">{() => fahrenheit() + "°F"}</span></div>
        <div class="stat"><span class="lbl">Feels</span><span class="metric-big" style="font-size:20px;color:var(--accent)">{label}</span></div>
      </div>
      <input
        type="range"
        min="-20"
        max="45"
        value="20"
        style="width:100%"
        ref={(el: any) => (slider = el)}
        on:input={(e: any) => celsius.set(Number(e.target.value))}
      />
      <p class="sub" style="font-size:13px;margin-top:10px">
        `fahrenheit` and `label` are `derived` — they recompute only when `celsius` changes.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- Timer -- */
export function DemoTimer() {
  const secs = state(0);
  const running = state(true);
  const fmt = derived(() => {
    const m = Math.floor(secs() / 60);
    const s = secs() % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  });
  const id = setInterval(() => {
    if (running.peek()) secs.update((n) => n + 1);
  }, 1000);
  onCleanup(() => clearInterval(id));
  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="counter-val" style="font-size:44px;margin:8px 0 14px">{fmt}</div>
      <div class="row">
        <button class="sbtn" style="width:auto;padding:0 16px;font-size:14px" on:click={() => running.update((r) => !r)}>
          {() => (running() ? "Pause" : "Resume")}
        </button>
        <button class="sbtn" style="width:auto;padding:0 16px;font-size:14px" on:click={() => secs.set(0)}>Reset</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Realtime ---- */
interface JobObj {
  name?: string;
  progress?: number;
}
function buildDashboardServer() {
  const app = raptorServer({ build: "site-dashboard" });
  app.query("dashboard", { select: () => ["cpu", "memory", "jobs", "job:"] });
  const store = app.store;
  store.setSignal("cpu", 24);
  store.setSignal("memory", 41);
  store.transaction(() => {
    for (const [id, name] of [[1, "build"], [2, "test"], [3, "deploy"]] as const) {
      store.setField("job:" + id, "name", name);
      store.setField("job:" + id, "progress", id * 15);
      store.append("jobs", id);
    }
  });
  return app;
}

export function DemoRealtime() {
  const app = buildDashboardServer();
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client, { build: "site-web" });

  const raptorTotal = state(0);
  const jsonTotal = state(0);
  const tick = state(0);
  const reduction = derived(() => (jsonTotal() > 0 ? Math.round(100 * (1 - raptorTotal() / jsonTotal())) : 0));

  let handle: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  void client.connect().then(async () => {
    if (disposed) return;
    client.subscribe("dashboard");
    await flushLoopback();
    if (disposed) return;
    handle = setInterval(() => {
      const before = link.stats.serverToClientBytes;
      app.store.transaction(() => {
        app.store.setSignal("cpu", Math.round(18 + 70 * Math.random()));
        app.store.setSignal("memory", Math.round(30 + 55 * Math.random()));
        const jobs = (client.signal<number[]>("jobs")() ?? []) as number[];
        if (jobs.length > 0) {
          const id = jobs[tick.peek() % jobs.length]!;
          const cur = ((client.signal("job:" + id)() as JobObj) ?? {}).progress ?? 0;
          app.store.patch("job:" + id, { progress: cur >= 100 ? 0 : cur + 10 });
        }
      });
      raptorTotal.update((n) => n + (link.stats.serverToClientBytes - before));
      tick.update((n) => n + 1);
      void flushLoopback().then(() => {
        const jobs = (client.signal<number[]>("jobs")() ?? []) as number[];
        const snap = { cpu: client.signal("cpu")(), memory: client.signal("memory")(), jobs: jobs.map((id) => client.signal("job:" + id)()) };
        jsonTotal.update((n) => n + new TextEncoder().encode(JSON.stringify(snap)).length);
      });
    }, 1100);
  });
  onCleanup(() => {
    disposed = true;
    if (handle) clearInterval(handle);
    client.close();
  });

  const cpu = () => (client.signal<number>("cpu")() ?? 0) as number;
  const mem = () => (client.signal<number>("memory")() ?? 0) as number;

  return (
    <div class="demo">
      <div class="row" style="justify-content:space-between">
        <div class="badge-live">server ↔ RaptorWire ↔ client</div>
        <span class="chip">tick <b>{tick}</b></span>
      </div>
      <div class="grid cols-2" style="margin:14px 0">
        <div class="stat"><span class="lbl">CPU</span><span class="metric-big">{() => cpu() + "%"}</span><div class="bar"><span style={() => "width:" + cpu() + "%"}></span></div></div>
        <div class="stat"><span class="lbl">Memory</span><span class="metric-big">{() => mem() + "%"}</span><div class="bar"><span style={() => "width:" + mem() + "%"}></span></div></div>
      </div>
      <table class="jobs">
        <For each={() => (client.signal<number[]>("jobs")() ?? []) as number[]}>
          {(id: number) => (
            <tr>
              <td>#{id}</td>
              <td>{() => ((client.signal("job:" + id)() as JobObj) ?? {}).name ?? "?"}</td>
              <td style="width:50%"><div class="bar"><span style={() => "width:" + (((client.signal("job:" + id)() as JobObj) ?? {}).progress ?? 0) + "%"}></span></div></td>
              <td style="text-align:right">{() => (((client.signal("job:" + id)() as JobObj) ?? {}).progress ?? 0) + "%"}</td>
            </tr>
          )}
        </For>
      </table>
      <div class="grid cols-3" style="margin-top:16px">
        <div class="stat"><span class="lbl">RaptorWire</span><span class="metric-big">{() => raptorTotal() + " B"}</span></div>
        <div class="stat"><span class="lbl">JSON resend</span><span class="metric-big">{() => jsonTotal() + " B"}</span></div>
        <div class="stat"><span class="lbl">Saved</span><span class="metric-big win">{() => reduction() + "%"}</span></div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- registry ---- */
export const DEMOS: Record<string, () => any> = {
  counter: DemoCounter,
  todo: DemoTodo,
  temperature: DemoTemperature,
  timer: DemoTimer,
  realtime: DemoRealtime,
};
