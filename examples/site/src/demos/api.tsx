/**
 * Live demos for the Docs entries. Unlike the ones in `demos/index.tsx` (which
 * show what you can build), these show HOW a primitive BEHAVES - usually by
 * counting something that would otherwise be invisible: how many times a
 * computation runs, how many DOM nodes are created, how many bytes go over the wire.
 */
import { state, derived, effect, batch, untracked, For, Show, onCleanup } from "@raptorstack/raptorjs/dom";
import { raptorServer } from "@raptorstack/wire/server";
import { createLoopback, RaptorClient } from "@raptorstack/wire/client";

function Stat(props: { label: string; value: any }) {
  return (
    <span class="chip">
      {props.label} = <b>{props.value}</b>
    </span>
  );
}

/* ---------------------------------------------------------------- raptorjs -- */

/** `state`: read, set, update — and `peek`, which does NOT subscribe. */
export function ApiState() {
  const count = state(0);
  const log = state<string[]>([]);
  const push = (line: string) => log.update((xs) => [line, ...xs].slice(0, 4));

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" on:click={() => count.update((n) => n + 1)}>+1</button>
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px" on:click={() => count.set(0)}>
          set(0)
        </button>
        <button
          class="sbtn"
          style="width:auto;padding:0 12px;font-size:13px"
          on:click={() => push(`peek() → ${count.peek()} (no subscription)`)}
        >
          peek()
        </button>
      </div>
      <div class="row">
        <Stat label="count()" value={count} />
      </div>
      <ul style="margin:12px 0 0;padding:0;list-style:none;font-family:var(--mono);font-size:12px;color:var(--muted)">
        <For each={log}>{(line: string) => <li style="padding:2px 0">{line}</li>}</For>
      </ul>
    </div>
  );
}

/** `derived`: memoised and lazy — the counter shows it does not recompute needlessly. */
export function ApiDerived() {
  const a = state(2);
  const b = state(3);
  let runs = 0;
  const runCount = state(0);
  const sum = derived(() => {
    runs++;
    // We don't write to the signal during the computation: defer it until after commit.
    queueMicrotask(() => runCount.set(runs));
    return a() + b();
  });

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" on:click={() => a.update((n) => n + 1)}>a+1</button>
        <button class="sbtn" on:click={() => b.update((n) => n + 1)}>b+1</button>
      </div>
      <div class="row">
        <Stat label="a" value={a} />
        <Stat label="b" value={b} />
        <Stat label="a+b" value={sum} />
        <Stat label="recomputes" value={runCount} />
      </div>
      <p class="sub" style="font-size:12.5px;margin-top:10px">
        Press the same button twice: the value recomputes once per click, not once per read.
      </p>
    </div>
  );
}

/** `effect`: runs now, then on every change — until you stop it. */
export function ApiEffect() {
  const n = state(0);
  const lines = state<string[]>([]);
  const live = state(true);
  let stop: (() => void) | null = null;

  const start = (): void => {
    stop = effect(() => {
      const value = n();
      queueMicrotask(() => lines.update((xs) => [`effect saw ${value}`, ...xs].slice(0, 4)));
    });
    live.set(true);
  };
  start();
  onCleanup(() => stop?.());

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" on:click={() => n.update((x) => x + 1)}>+1</button>
        <Show when={live}>
          <button
            class="sbtn"
            style="width:auto;padding:0 12px;font-size:13px"
            on:click={() => {
              stop?.();
              stop = null;
              live.set(false);
              lines.update((xs) => ["— disposed —", ...xs].slice(0, 4));
            }}
          >
            dispose()
          </button>
        </Show>
        <Show when={() => !live()}>
          <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px" on:click={start}>
            re-effect()
          </button>
        </Show>
      </div>
      <div class="row">
        <Stat label="n" value={n} />
      </div>
      <ul style="margin:12px 0 0;padding:0;list-style:none;font-family:var(--mono);font-size:12px;color:var(--muted)">
        <For each={lines}>{(line: string) => <li style="padding:2px 0">{line}</li>}</For>
      </ul>
    </div>
  );
}

/** `batch`: two writes, a single commit. */
export function ApiBatch() {
  const first = state("Ada");
  const last = state("Lovelace");
  let runs = 0;
  const runCount = state(0);
  effect(() => {
    first();
    last();
    runs++;
    queueMicrotask(() => runCount.set(runs));
  });

  const rename = (f: string, l: string, grouped: boolean): void => {
    if (grouped) batch(() => { first.set(f); last.set(l); });
    else { first.set(f); last.set(l); }
  };

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px"
                on:click={() => rename("Grace", "Hopper", false)}>
          two writes
        </button>
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px"
                on:click={() => rename("Ada", "Lovelace", true)}>
          batch(...)
        </button>
      </div>
      <div class="row">
        <Stat label="name" value={() => `${first()} ${last()}`} />
        <Stat label="effect runs" value={runCount} />
      </div>
      <p class="sub" style="font-size:12.5px;margin-top:10px">
        Without batching the effect runs twice and passes through an inconsistent state ("Grace Lovelace").
        With it, once.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- raptorjs/dom -- */

/** `For`: a stable key — existing rows are NOT recreated. */
export function ApiFor() {
  interface Row { id: number; label: string }
  const rows = state<Row[]>([
    { id: 1, label: "alpha" },
    { id: 2, label: "beta" },
  ]);
  let next = 3;
  const created = state(0);

  const Row = (r: Row) => {
    // Runs exactly once per row: the counter shows precisely that.
    queueMicrotask(() => created.update((n) => n + 1));
    return (
      <li style="padding:3px 0;font-family:var(--mono);font-size:12.5px">
        #{r.id} {r.label}
      </li>
    );
  };

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px"
                on:click={() => rows.update((xs) => [...xs, { id: next, label: `row ${next++}` }])}>
          add
        </button>
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px"
                on:click={() => rows.update((xs) => [...xs].reverse())}>
          reverse
        </button>
      </div>
      <ul style="margin:0;padding:0;list-style:none">
        <For each={rows}>{(r: Row) => Row(r)}</For>
      </ul>
      <div class="row" style="margin-top:10px">
        <Stat label="rows" value={() => rows().length} />
        <Stat label="nodes ever created" value={created} />
      </div>
      <p class="sub" style="font-size:12.5px;margin-top:10px">
        Reverse the list a few times: no new node is created, they are only moved.
      </p>
    </div>
  );
}

/** `Show`: mount / unmount, not just `display:none`. */
export function ApiShow() {
  const open = state(false);
  const mounts = state(0);
  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 12px">
        <button class="sbtn" style="width:auto;padding:0 12px;font-size:13px" on:click={() => open.update((v) => !v)}>
          {() => (open() ? "hide" : "show")}
        </button>
      </div>
      <Show when={open}>
        {(() => {
          queueMicrotask(() => mounts.update((n) => n + 1));
          return (
            <div class="chip" style="display:inline-flex">
              mounted content
            </div>
          );
        })()}
      </Show>
      <div class="row" style="margin-top:10px">
        <Stat label="mounts" value={mounts} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- @raptorstack/wire/client -- */

function todoServer() {
  const app = raptorServer({ build: "docs-demo" });
  let counter = 0;
  app.query("list", { select: () => ["order", "item:"] });
  app.mutation("add", {
    run: ({ input, store }) => {
      const id = ++counter;
      store.setField(`item:${id}`, "text", String((input as { text: string }).text));
      store.append("order", id);
      return { id };
    },
  });
  return app;
}

/**
 * `RaptorClient` + `signal`: two clients on the same server (loopback), with the
 * byte counter on display. You write in one, it appears in the other.
 */
export function ApiClient() {
  const app = todoServer();
  const mk = (label: string) => {
    const link = createLoopback();
    app.serve(link.server);
    const client = new RaptorClient(link.client, { build: label });
    void client.connect().then(() => client.subscribe("list"));
    return { client, link };
  };
  const a = mk("A");
  const b = mk("B");
  // `snapshotsReceived` / `opsFramesReceived` are plain counters on the client, not
  // signals: nothing would notify a binding. We sample them periodically, like the bytes.
  const bytes = state(0);
  const snapshots = state(0);
  const opsFrames = state(0);
  const tick = (): void => {
    bytes.set(a.link.stats.serverToClientBytes + b.link.stats.serverToClientBytes);
    snapshots.set(a.client.snapshotsReceived);
    opsFrames.set(a.client.opsFramesReceived);
  };
  const timer = setInterval(tick, 200);
  onCleanup(() => clearInterval(timer));

  let n = 0;
  const order = (c: RaptorClient) => () => (c.signal<number[]>("order")() ?? []) as number[];
  const text = (c: RaptorClient, id: number) => (c.signal(`item:${id}`)() as { text?: string } | undefined)?.text ?? "";

  const Pane = (props: { c: RaptorClient; label: string }) => (
    <div style="flex:1;min-width:0">
      <div style="font-family:var(--mono);font-size:11px;color:var(--faint);margin-bottom:6px">{props.label}</div>
      <ul style="margin:0;padding:0;list-style:none;min-height:54px">
        <For each={order(props.c)}>
          {(id: number) => (
            <li style="padding:2px 0;font-size:12.5px">{() => text(props.c, id)}</li>
          )}
        </For>
      </ul>
    </div>
  );

  return (
    <div class="demo">
      <div class="badge-live">live</div>
      <div class="row" style="margin:10px 0 14px">
        <button
          class="sbtn"
          style="width:auto;padding:0 12px;font-size:13px"
          on:click={() => void a.client.mutate("add", { text: `from A · ${++n}` })}
        >
          write in A
        </button>
        <button
          class="sbtn"
          style="width:auto;padding:0 12px;font-size:13px"
          on:click={() => void b.client.mutate("add", { text: `from B · ${++n}` })}
        >
          write in B
        </button>
      </div>
      <div style="display:flex;gap:18px">
        <Pane c={a.client} label="client A" />
        <Pane c={b.client} label="client B" />
      </div>
      <div class="row" style="margin-top:12px">
        <Stat label="bytes server→client" value={bytes} />
        <Stat label="snapshots A" value={snapshots} />
        <Stat label="ops frames A" value={opsFrames} />
      </div>
      <p class="sub" style="font-size:12.5px;margin-top:10px">
        The snapshot count stays at 1 however much you write: after the first sync only operations travel.
      </p>
    </div>
  );
}

/** Key → demo mapping, used by the Docs page. */
export const API_DEMOS: Record<string, () => any> = {
  state: ApiState,
  derived: ApiDerived,
  effect: ApiEffect,
  batch: ApiBatch,
  for: ApiFor,
  show: ApiShow,
  client: ApiClient,
};

export { untracked };
