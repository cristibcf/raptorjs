/** Headless behaviours. */
import { state, derived, For, R } from "@raptorstack/raptorjs/dom";
import { Button } from "@raptorstack/raptorjs/ui/button";
import {
  Portal,
  Transition,
  VisuallyHidden,
  clickOutside,
  clipboard,
  draggable,
  dragPayload,
  droppable,
  focusTrap,
  hotkeys,
  idle,
  infiniteScroll,
  intersects,
  mediaQuery,
  networkStatus,
  persistedState,
  resizable,
  selectionState,
  sortable,
  undoRedo,
  virtualizer,
} from "@raptorstack/raptorjs/ui/primitives";
import type { CatalogGroup } from "./types.ts";

export const PRIMITIVES: CatalogGroup = {
  slug: "primitives",
  title: "Headless behaviours",
  blurb:
    "These render nothing. They attach through a `ref` or hand you signals, and most of the components above are built out of them — which is why the components stay small.",
  items: [
    {
      slug: "portal",
      name: "Portal",
      tier: "T1",
      summary:
        "Mounts children somewhere else in the document — the escape hatch every overlay needs from `overflow: hidden`. It creates one host node, so cleanup removes one node, not N.",
      code: `Portal({ mount: document.body, children: overlay });`,
      demo: () => {
        const on = state(false);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Send a node to <body>", onClick: () => on.update((v) => !v) })}
            </div>
            {() =>
              on()
                ? Portal({
                    children: R.div(
                      {
                        style:
                          "position:fixed;left:16px;bottom:16px;z-index:200;background:var(--accent);color:#fff;" +
                          "padding:10px 14px;border-radius:8px;font-size:13px",
                      },
                      "I live in document.body",
                    ),
                  })
                : null
            }
          </div>
        );
      },
    },
    {
      slug: "focus-trap",
      name: "focusTrap",
      tier: "T1",
      summary: "Keeps Tab inside a region while it is active and gives focus back where it came from when it is not.",
      code: `R.div({ ref: focusTrap({ active: () => open() }) }, dialogContent);`,
      demo: () => {
        const on = state(false);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Toggle trap", onClick: () => on.update((v) => !v) })}
              <span class="chip">
                trapped = <b>{() => String(on())}</b>
              </span>
            </div>
            {R.div(
              {
                class: "cmp-panel",
                ref: focusTrap({ active: () => on() }),
              },
              R.div({ class: "cmp-row" }, Button({ children: "First" }), Button({ children: "Second" }), Button({ children: "Third" })),
              R.div({ style: "font-size:13px;color:var(--muted)" }, "With the trap on, Tab cycles between these three."),
            )}
          </div>
        );
      },
    },
    {
      slug: "click-outside",
      name: "clickOutside",
      tier: "T1",
      summary:
        "Runs a handler when a click lands outside an element, with an `ignore` list for the trigger that opened it — and it only listens while `enabled` says so.",
      code: `R.div({ ref: clickOutside(() => open.set(false), { enabled: () => open() }) }, panel);`,
      demo: () => {
        const open = state(true);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Show the panel", onClick: () => open.set(true) })}
            </div>
            {() =>
              open()
                ? R.div(
                    { class: "cmp-panel", ref: clickOutside(() => open.set(false), { enabled: () => open() }) },
                    "Click anywhere outside this box to dismiss it.",
                  )
                : R.div({ style: "font-size:14px;color:var(--muted)" }, "Dismissed.")
            }
          </div>
        );
      },
    },
    {
      slug: "visually-hidden",
      name: "VisuallyHidden",
      tier: "T1",
      summary: "Text for screen readers only — still in the accessibility tree, off the screen. The focusable variant appears when tabbed to, which is how skip links work.",
      code: `R.button({}, "✕", VisuallyHidden("Close the dialog"));`,
      demo: () => (
        <div class="cmp-row">
          {R.button({ class: "rui-btn rui-btn-secondary rui-btn-md" }, "✕", VisuallyHidden("Close the dialog"))}
          <span class="chip">the button reads as “✕ Close the dialog”</span>
        </div>
      ),
    },
    {
      slug: "transition",
      name: "Transition",
      tier: "T1",
      summary:
        "Keeps a node mounted for `duration` after it closes, adding `-enter` / `-exit` classes so CSS can animate the way out. Without it, an exit animation has nothing left to animate.",
      code: `Transition({ when: () => open(), duration: 200, name: "fade", children: panel });`,
      demo: () => {
        const on = state(true);
        return (
          <div>
            <div class="cmp-row">{Button({ children: "Toggle", onClick: () => on.update((v) => !v) })}</div>
            {Transition({
              when: () => on(),
              duration: 250,
              children: R.div({ class: "cmp-panel", style: "transition:opacity .25s" }, "Mounted for 250 ms after you close it."),
            })}
          </div>
        );
      },
    },
    {
      slug: "draggable",
      name: "draggable",
      tier: "T1",
      summary: "Pointer-events dragging with an axis lock and a threshold, giving you `dragging` and the current delta as signals.",
      code: `const drag = draggable({ axis: "x", threshold: 3 });
R.div({ ref: drag.ref, style: () => "transform:translateX(" + drag.delta().dx + "px)" }, handle);`,
      demo: () => {
        const drag = draggable({ threshold: 2 });
        const held = state({ x: 0, y: 0 });
        return (
          <div>
            <div class="cmp-panel" style="height:150px;position:relative;overflow:hidden">
              {R.div(
                {
                  ref: drag.ref,
                  style: () =>
                    "position:absolute;left:12px;top:12px;width:110px;height:56px;border-radius:8px;cursor:grab;" +
                    "display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;background:var(--accent);" +
                    "transform:translate(" + (held().x + drag.delta().dx) + "px," + (held().y + drag.delta().dy) + "px)",
                  "on:pointerup": () =>
                    held.update((p) => ({ x: p.x + drag.delta().dx, y: p.y + drag.delta().dy })),
                },
                "drag me",
              )}
            </div>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                dragging = <b>{() => String(drag.dragging())}</b>
              </span>
              <span class="chip">
                delta = <b>{() => drag.delta().dx + ", " + drag.delta().dy}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "droppable",
      name: "droppable",
      tier: "T2",
      summary:
        "A drop target that only lights up for a payload it accepts. The payload travels through a signal, because pointer events have no `dataTransfer`.",
      code: `const payload = dragPayload<Card>();
const zone = droppable(payload, { accepts: (c) => c.kind === "task", onDrop: (c) => move(c) });`,
      demo: () => {
        const payload = dragPayload<string>();
        const dropped = state<readonly string[]>([]);
        const zone = droppable(payload, {
          onDrop: (value: string) => dropped.update((xs) => [...xs, value]),
        });
        const chip = (label: string) => {
          const drag = draggable({
            threshold: 2,
            onStart: () => payload.set(label),
            onEnd: () => payload.set(null),
          });
          return R.span(
            {
              ref: drag.ref,
              class: "chip",
              style: () => "cursor:grab;user-select:none;opacity:" + (drag.dragging() ? "0.5" : "1"),
            },
            label,
          );
        };
        return (
          <div>
            <div class="cmp-row">{["alpha", "beta", "gamma"].map(chip)}</div>
            {R.div(
              {
                ref: zone.ref,
                class: "cmp-panel",
                style: () =>
                  "text-align:center;font-size:14px;border-style:dashed;" +
                  (zone.over() ? "border-color:var(--accent);background:var(--accent-soft)" : ""),
              },
              "Drag a chip in here",
            )}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                dropped: <b>{() => dropped().join(", ") || "nothing yet"}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "sortable",
      name: "sortable",
      tier: "T1",
      thesis:
        "Reordering only rewrites the array of items. The keyed `For` then moves the existing nodes — nothing is recreated, so an input being typed into, or a video playing, survives the reorder.",
      summary: "Drag to reorder a list, with a programmatic `move` for keyboard and buttons.",
      code: `const items = state(["one", "two", "three"]);
const sort = sortable({ items, onReorder: (next) => persist(next) });
For({ each: items, children: (item, i) => R.li({ ref: sort.item(i()) }, item) });`,
      demo: () => {
        const items = state<readonly string[]>(["Parse", "Optimise", "Emit", "Cache"]);
        const sort = sortable({ items });
        return (
          <div>
            <ul style="list-style:none;margin:0;padding:0;display:grid;gap:6px;max-width:320px">
              {For({
                each: () => items(),
                children: (item: string, index: number) => {
                  /** The live position, so the buttons stay right after a reorder. */
                  const at = () => items().indexOf(item);
                  return R.li(
                    {
                      ref: sort.item(index),
                      class: "cmp-panel",
                      style: () =>
                        "display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:grab;padding:10px 12px;" +
                        (sort.dragging() === index ? "opacity:.5;" : "") +
                        (sort.over() === index ? "border-color:var(--accent);" : ""),
                    },
                    R.span({}, item),
                    R.span(
                      { class: "cmp-row", style: "margin:0" },
                      Button({ children: "↑", size: "sm", label: "Move up", onClick: () => sort.move(at(), at() - 1) }),
                      Button({ children: "↓", size: "sm", label: "Move down", onClick: () => sort.move(at(), at() + 1) }),
                    ),
                  );
                },
              })}
            </ul>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">{() => items().join(" → ")}</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "resizable",
      name: "resizable",
      tier: "T1",
      summary:
        "A drag handle that produces a size signal and a ready-made style string, with bounds, quantisation and an arrow-key `nudge` for accessibility.",
      code: `const handle = resizable({ axis: "x", initial: 240, min: 120, max: 480 });
R.div({ style: handle.style }, panel);
R.div({ ref: handle.handle });`,
      demo: () => {
        const handle = resizable({ axis: "x", initial: 200, min: 80, max: 420, step: 4 });
        return (
          <div>
            <div class="cmp-panel" style="display:flex;height:120px;padding:0;overflow:hidden">
              {R.div({ style: () => handle.style() + ";background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-size:13px" }, "resizable")}
              {R.div({ ref: handle.handle, style: "width:8px;cursor:col-resize;background:var(--border-strong)" })}
              {R.div({ style: "flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted)" }, "the rest")}
            </div>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                size = <b>{() => String(Math.round(handle.size()))}</b> px
              </span>
              <span class="chip">quantised to 4 px; focus the handle and use ← →</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "virtualizer",
      name: "virtualizer",
      tier: "T1",
      thesis:
        "The window is a `derived` with an equality check on its endpoints: scrolling three pixels inside the same row invalidates nothing at all. Only crossing a row boundary produces new indices.",
      summary: "A window over a very long list: it gives you the indices to render, the spacer size, and the style for each item.",
      code: `const v = virtualizer({ count: () => rows().length, itemSize: 28, overscan: 4 });
R.div({ ref: v.ref, style: "overflow:auto;height:300px" },
  R.div({ style: v.spacerStyle }, For({ each: v.indices, children: (i) => row(i) })));`,
      demo: () => {
        const total = 50_000;
        const v = virtualizer({ count: () => total, itemSize: 28, overscan: 4 });
        const rendered = derived(() => v.indices().length);
        return (
          <div>
            {R.div(
              { ref: v.ref, class: "cmp-panel", style: "height:220px;overflow:auto;padding:0" },
              R.div(
                { style: () => v.spacerStyle() },
                For({
                  each: () => v.indices(),
                  children: (i: number) =>
                    R.div(
                      {
                        style: () => v.itemStyle(i) + ";padding:0 12px;display:flex;align-items:center;font-size:13px;border-bottom:1px solid var(--border)",
                      },
                      "row " + (i + 1),
                    ),
                }),
              ),
            )}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                50 000 rows, <b>{() => String(rendered())}</b> nodes in the DOM
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "infinite-scroll",
      name: "infiniteScroll",
      tier: "T2",
      summary: "A sentinel at the end of a list that loads the next page when it comes into view, and never fires twice while a load is in flight.",
      code: `const more = infiniteScroll({ onLoad: fetchNextPage, hasMore: () => page() < pages });`,
      demo: () => {
        const items = state<readonly number[]>(Array.from({ length: 12 }, (_, i) => i + 1));
        const more = infiniteScroll({
          hasMore: () => items().length < 48,
          onLoad: () =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                items.update((xs) => [...xs, ...Array.from({ length: 12 }, (_, i) => xs.length + i + 1)]);
                resolve();
              }, 500),
            ),
        });
        return (
          <div>
            <div class="cmp-panel" style="height:200px;overflow:auto">
              {For({
                each: () => items(),
                children: (n: number) => R.div({ style: "padding:6px 0;border-bottom:1px solid var(--border);font-size:13px" }, "item " + n),
              })}
              {R.div({ ref: more.ref, style: "height:1px" })}
              {() => (more.loading() ? R.div({ style: "padding:10px 0;font-size:13px;color:var(--muted)" }, "loading…") : null)}
            </div>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                <b>{() => String(items().length)}</b> of 48 loaded — scroll to the bottom
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "intersects",
      name: "intersects",
      tier: "T2",
      summary: "Visibility as a signal, with `once` for lazy loading and a manual `trigger` so it is testable without a browser.",
      code: `const seen = intersects({ threshold: 0.5, once: true });
R.img({ ref: seen.ref, src: () => (seen.visible() ? real : placeholder) });`,
      demo: () => {
        const seen = intersects({ threshold: 0.8 });
        return (
          <div>
            <div class="cmp-panel" style="height:160px;overflow:auto">
              <div style="height:140px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted)">
                scroll down inside this box ↓
              </div>
              {R.div(
                {
                  ref: seen.ref,
                  style: () =>
                    "height:80px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;background:" +
                    (seen.visible() ? "var(--green)" : "var(--faint)"),
                },
                () => (seen.visible() ? "visible" : "not visible"),
              )}
              <div style="height:140px"></div>
            </div>
          </div>
        );
      },
    },
    {
      slug: "clipboard",
      name: "clipboard",
      tier: "T2",
      summary: "Copy plus the `copied` and `error` signals, resetting itself after a while. CopyButton is a thin shell over it.",
      code: `const clip = clipboard();
R.button({ "on:click": () => clip.copy(text) }, () => (clip.copied() ? "copied" : "copy"));`,
      demo: () => {
        const clip = clipboard();
        return (
          <div class="cmp-row">
            {R.button(
              { class: "rui-btn rui-btn-secondary rui-btn-md", "on:click": () => void clip.copy("state(0)") },
              () => (clip.copied() ? "copied ✓" : "copy state(0)"),
            )}
            <span class="chip">
              copied = <b>{() => String(clip.copied())}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "hotkeys",
      name: "hotkeys",
      tier: "T1",
      summary:
        "Keyboard shortcuts with `mod` standing for Ctrl on Windows and Cmd on macOS, ignored while someone is typing in a field unless you say otherwise.",
      code: `hotkeys({ "mod+k": openPalette, "mod+shift+p": openCommands, "?": showHelp });`,
      demo: () => {
        const last = state("—");
        hotkeys({
          "mod+j": () => last.set("mod+J"),
          "mod+shift+u": () => last.set("mod+Shift+U"),
          "?": () => last.set("?"),
        });
        return (
          <div class="cmp-row">
            <span class="chip">try Ctrl/Cmd+J, Ctrl/Cmd+Shift+U, or ?</span>
            <span class="chip">
              last: <b>{last}</b>
            </span>
          </div>
        );
      },
      notes: ["The shortcuts are bound while this page is open and unbound when you navigate away — `onCleanup` does that."],
    },
    {
      slug: "media-query",
      name: "mediaQuery",
      tier: "T1",
      summary: "A media query as a signal, with `breakpoints()` for the usual four and `prefersReducedMotion()` for the one that matters most.",
      code: `const wide = mediaQuery("(min-width: 1024px)");
const { sm, md, lg } = breakpoints();`,
      demo: () => {
        const wide = mediaQuery("(min-width: 900px)");
        const dark = mediaQuery("(prefers-color-scheme: dark)");
        return (
          <div class="cmp-row">
            <span class="chip">
              (min-width: 900px) = <b>{() => String(wide())}</b>
            </span>
            <span class="chip">
              prefers dark = <b>{() => String(dark())}</b>
            </span>
            <span class="chip">resize the window and watch the first one flip</span>
          </div>
        );
      },
    },
    {
      slug: "idle",
      name: "idle",
      tier: "T3",
      summary: "Whether the person has stopped interacting — for pausing polling, or asking “are you still there?”.",
      code: `const away = idle({ timeout: 60_000 });`,
      demo: () => {
        const away = idle({ timeout: 4000 });
        return (
          <div class="cmp-row">
            <span class="chip">
              idle = <b>{() => String(away())}</b>
            </span>
            <span class="chip">stop moving for 4 seconds</span>
          </div>
        );
      },
    },
    {
      slug: "network-status",
      name: "networkStatus",
      tier: "T3",
      summary: "Online or offline, plus when it last changed — the signal behind an “you are offline” banner.",
      code: `const net = networkStatus();
Show({ when: () => !net.online(), children: offlineBanner });`,
      demo: () => {
        const net = networkStatus();
        return (
          <div class="cmp-row">
            <span class="chip">
              online = <b>{() => String(net.online())}</b>
            </span>
            <span class="chip">
              last change: <b>{() => (net.since() ? new Date(net.since()!).toLocaleTimeString("en-GB") : "—")}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "persisted-state",
      name: "persistedState",
      tier: "T2",
      summary:
        "A signal mirrored into `localStorage`, synchronised across tabs. Writes are intercepted rather than run through an effect, so opening the page does not write back what it just read.",
      code: `const theme = persistedState("theme", "light");
theme.set("dark"); // stored, and other tabs follow`,
      demo: () => {
        const count = persistedState("raptor-site-demo-counter", 0);
        return (
          <div class="cmp-row">
            {Button({ children: "+1", onClick: () => count.update((n) => n + 1) })}
            {Button({ children: "Reset", onClick: () => count.set(0) })}
            <span class="chip">
              value = <b>{count}</b>
            </span>
            <span class="chip">reload the page — it is still there</span>
          </div>
        );
      },
    },
    {
      slug: "undo-redo",
      name: "undoRedo",
      tier: "T2",
      summary:
        "History with a bounded size — the limit is not optional, because an editor left open all day with unlimited history keeps every intermediate state in memory. `replace` updates without adding an entry, which is what a drag needs.",
      code: `const doc = undoRedo("", { limit: 50 });
doc.set("hello");
doc.undo();
doc.canRedo(); // true`,
      demo: () => {
        const history = undoRedo("start", { limit: 20 });
        const push = (text: string) => () => history.set(text);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Write “alpha”", size: "sm", onClick: push("alpha") })}
              {Button({ children: "Write “beta”", size: "sm", onClick: push("beta") })}
              {Button({ children: "Write “gamma”", size: "sm", onClick: push("gamma") })}
            </div>
            <div class="cmp-row">
              {Button({ children: "Undo", size: "sm", disabled: () => !history.canUndo(), onClick: () => history.undo() })}
              {Button({ children: "Redo", size: "sm", disabled: () => !history.canRedo(), onClick: () => history.redo() })}
              <span class="chip">
                value = <b>{() => history.value()}</b>
              </span>
              <span class="chip">
                past <b>{() => String(history.size().past)}</b> / future <b>{() => String(history.size().future)}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "selection-state",
      name: "selectionState",
      tier: "T2",
      summary:
        "File-manager selection: a plain click selects one, Ctrl/Cmd toggles, Shift takes the range from the anchor. ListView and Table use it, and so can you.",
      code: `const sel = selectionState({ items: () => rows() });
R.tr({ "on:click": (e) => sel.click(row, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }) });`,
      demo: () => {
        const rows = ["Parse", "Optimise", "Emit", "Cache", "Ship"];
        const sel = selectionState({ items: () => rows });
        return (
          <div>
            <div style="display:grid;gap:6px;max-width:320px">
              {rows.map((row) =>
                R.div(
                  {
                    class: "cmp-panel",
                    style: () =>
                      "padding:8px 12px;cursor:default;font-size:14px;" +
                      (sel.isSelected(row) ? "border-color:var(--accent);background:var(--accent-soft)" : ""),
                    "on:click": (e: any) => sel.click(row, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }),
                  },
                  row,
                ),
              )}
            </div>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                selected <b>{() => String(sel.count())}</b>
              </span>
              {Button({ children: "Select all", size: "sm", onClick: () => sel.selectAll() })}
              {Button({ children: "Clear", size: "sm", onClick: () => sel.clear() })}
            </div>
          </div>
        );
      },
    },
  ],
};
