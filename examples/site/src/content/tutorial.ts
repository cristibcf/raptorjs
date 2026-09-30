/**
 * Interactive tutorial: small steps, each with an explanation + starter code that
 * runs in the preview. The code uses the `R` builder (not JSX), so we don't ship
 * a compiler to the browser — the same primitives JSX compiles to.
 */
export interface TutorialStep {
  slug: string;
  title: string;
  intro: string;
  /** Key takeaways, optional. */
  points?: string[];
  code: string;
}

export const TUTORIAL: TutorialStep[] = [
  {
    slug: "a-signal",
    title: "A signal",
    intro:
      "A signal is a value that remembers who reads it. Call it to read, `.set` / `.update` to write. Only the exact DOM that read it updates — no diffing.",
    points: [
      "`state(0)` creates a signal with an initial value.",
      "`count()` reads it; `count.update(fn)` writes.",
      "The text node bound to `() => count()` is the only thing that changes on click.",
    ],
    code: `function App() {
  const count = state(0);
  return R.div(
    R.div({ style: "font-size:44px;font-weight:800" }, () => count()),
    R.button({ class: "sbtn", style: "width:auto;padding:0 16px",
      "on:click": () => count.update(n => n + 1) }, "+1")
  );
}`,
  },
  {
    slug: "derived",
    title: "Derived values",
    intro:
      "A derived value recomputes automatically when the signals it reads change. It is lazy and memoised — it only runs when something reads it, and only when its inputs actually changed.",
    points: [
      "`derived(fn)` tracks whatever signals `fn` reads.",
      "`doubled` never has a stale value and never recomputes needlessly.",
    ],
    code: `function App() {
  const count = state(1);
  const doubled = derived(() => count() * 2);
  return R.div(
    R.p("count = ", () => count()),
    R.p({ style: "color:#0f6e4f;font-weight:700" }, "doubled = ", () => doubled()),
    R.button({ class: "sbtn", style: "width:auto;padding:0 16px",
      "on:click": () => count.update(n => n + 1) }, "+1")
  );
}`,
  },
  {
    slug: "effects",
    title: "Effects",
    intro:
      "An effect runs a side effect and re-runs when its dependencies change. Use it for things outside the UI — logging, the title, a subscription. Here it mirrors the count into a line of text.",
    points: [
      "`effect(fn)` runs `fn` now and again whenever a signal it read changes.",
      "Dependencies are re-collected each run — a branch that didn't execute creates no dependency.",
    ],
    code: `function App() {
  const count = state(0);
  const log = state("effect saw 0");
  effect(() => log.set("effect saw " + count()));
  return R.div(
    R.button({ class: "sbtn", style: "width:auto;padding:0 16px",
      "on:click": () => count.update(n => n + 1) }, "+1"),
    R.pre({ style: "margin-top:14px;color:#5b6270" }, () => log())
  );
}`,
  },
  {
    slug: "lists",
    title: "Lists with For",
    intro:
      "`For` renders a reactive array by key. When the array changes, only the rows that changed are touched — added, removed or moved — not the whole list.",
    points: [
      "`For({ each: () => items(), children: (x) => ... })` keys by identity.",
      "Adding one item creates one row; the rest are left alone.",
    ],
    code: `function App() {
  const items = state(["alpha", "beta"]);
  let n = 3;
  return R.div(
    R.button({ class: "sbtn", style: "width:auto;padding:0 14px",
      "on:click": () => items.update(xs => xs.concat("item " + n++)) }, "add item"),
    R.ul({ style: "margin-top:12px;line-height:1.9" },
      For({ each: () => items(), children: (x) => R.li(x) })
    )
  );
}`,
  },
  {
    slug: "put-it-together",
    title: "Put it together",
    intro:
      "Signals, derived and For in one small app: a task list with a live count. Everything you edit here re-runs instantly — try changing the layout or adding a filter.",
    points: [
      "State is plain data; derived values (`left`) fall out of it.",
      "No component re-renders — each binding updates on its own.",
    ],
    code: `function App() {
  const items = state([
    { id: 1, text: "Learn signals", done: true },
    { id: 2, text: "Build something", done: false }
  ]);
  let nextId = 3, input;
  const left = derived(() => items().filter(t => !t.done).length);
  const done = (id) => { const it = items().find(x => x.id === id); return it ? it.done : false; };
  const add = () => {
    const v = (input.value || "").trim();
    if (!v) return;
    items.update(xs => xs.concat({ id: nextId++, text: v, done: false }));
    input.value = "";
  };
  const toggle = (id) => items.update(xs => xs.map(t => t.id === id ? { ...t, done: !t.done } : t));

  return R.div(
    R.input({ ref: (el) => { input = el; }, placeholder: "Add a task, press Enter",
      style: "width:100%;padding:9px 12px;border-radius:8px;border:1px solid #d7dae0",
      "on:keydown": (e) => { if (e.key === "Enter") add(); } }),
    R.p({ style: "color:#5b6270;font-size:13px;margin:10px 0" }, () => left() + " left"),
    For({ each: () => items(), children: (t) =>
      R.div({ style: "padding:7px 0;border-bottom:1px solid #eef0f3;cursor:pointer",
        "on:click": () => toggle(t.id) },
        () => done(t.id) ? "☑ " : "☐ ",
        R.span({ style: () => done(t.id) ? "text-decoration:line-through;color:#8a909c" : "" }, t.text))
    })
  );
}`,
  },
];
