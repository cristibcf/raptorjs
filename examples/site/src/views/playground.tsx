/**
 * Live playground: edit a component and see it run. To avoid shipping a JSX
 * compiler to the browser, examples use the `R` hyperscript builder
 * (`R.div(props, ...children)`) — the same runtime primitives JSX compiles to.
 * User code is evaluated to an `App` function and rendered into the preview;
 * errors are caught and shown.
 */
import { R, state, derived, effect, batch, onCleanup, For, Show, render } from "@raptorstack/raptorjs/dom";
import { SectionHead } from "../lib/ui.tsx";

interface Example {
  name: string;
  code: string;
}

const EXAMPLES: Example[] = [
  {
    name: "Counter",
    code: `// A signal + a derived value. Edit and watch it update.
function App() {
  const count = state(0);
  const doubled = derived(() => count() * 2);

  return R.div(
    R.div({ style: "font-size:44px;font-weight:800" }, () => count()),
    R.p({ style: "color:#5b6270;margin:4px 0 14px" },
      "doubled = ", () => doubled()),
    R.button({ class: "sbtn", style: "width:auto;padding:0 16px",
      "on:click": () => count.update(n => n + 1) }, "+1"),
    R.button({ class: "sbtn",
      style: "width:auto;padding:0 16px;margin-left:8px",
      "on:click": () => count.set(0) }, "reset")
  );
}`,
  },
  {
    name: "Greeting",
    code: `// Two-way-ish: input drives a signal, text reacts.
function App() {
  const name = state("world");
  return R.div(
    R.input({
      value: "world",
      style: "padding:9px 12px;border-radius:8px;border:1px solid #d7dae0;background:#ffffff;color:#15181d;width:100%",
      "on:input": (e) => name.set(e.target.value)
    }),
    R.h2({ style: "margin-top:14px" },
      "Hello, ", () => name() || "…", "!")
  );
}`,
  },
  {
    name: "List",
    code: `// Reactive array with For.
function App() {
  const items = state(["alpha", "beta"]);
  let n = 3;
  return R.div(
    R.button({ class: "sbtn", style: "width:auto;padding:0 14px",
      "on:click": () => items.update(xs => xs.concat("item " + n++)) },
      "add item"),
    R.ul({ style: "margin-top:12px;line-height:1.9" },
      For({ each: () => items(), children: (x) => R.li(x) })
    )
  );
}`,
  },
  {
    name: "Toggle",
    code: `// Show + a boolean signal.
function App() {
  const on = state(true);
  return R.div(
    R.button({ class: "sbtn", style: "width:auto;padding:0 16px",
      "on:click": () => on.update(v => !v) },
      () => on() ? "Hide" : "Show"),
    R.div({ style: "margin-top:14px" },
      Show({
        when: () => on(),
        children: R.p({ style: "color:#0f6e4f" }, "Now you see me ✨"),
        fallback: R.p({ style: "color:#8a909c" }, "(hidden)")
      })
    )
  );
}`,
  },
  {
    name: "To-do app",
    code: `// Filtered to-do app: add, toggle, remove, filter, live count.
function App() {
  const items = state([
    { id: 1, text: "Learn signals", done: true },
    { id: 2, text: "Build a component", done: false }
  ]);
  const filter = state("all");
  let nextId = 3, input;

  const done = (id) => {
    const it = items().find(x => x.id === id);
    return it ? it.done : false;
  };
  const visible = derived(() => items().filter(t =>
    filter() === "all" ? true : filter() === "active" ? !t.done : t.done));
  const left = derived(() => items().filter(t => !t.done).length);

  const add = () => {
    const v = (input.value || "").trim();
    if (!v) return;
    items.update(xs => xs.concat({ id: nextId++, text: v, done: false }));
    input.value = "";
  };
  const toggle = (id) => items.update(xs =>
    xs.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id) => items.update(xs => xs.filter(t => t.id !== id));

  const chip = (name) => R.button({
    class: "sbtn",
    style: () => "width:auto;padding:0 12px;height:32px;font-size:13px" +
      (filter() === name ? ";color:#17457a;border-color:#17457a" : ""),
    "on:click": () => filter.set(name)
  }, name);

  return R.div(
    R.input({ ref: (el) => { input = el; },
      placeholder: "Add a task, press Enter",
      style: "width:100%;padding:9px 12px;border-radius:8px;border:1px solid #d7dae0;background:#ffffff;color:#15181d",
      "on:keydown": (e) => { if (e.key === "Enter") add(); } }),
    R.div({ style: "display:flex;gap:6px;margin:12px 0;align-items:center" },
      chip("all"), chip("active"), chip("done"),
      R.span({ style: "margin-left:auto;color:#5b6270;font-size:13px" },
        () => left() + " left")),
    For({ each: () => visible(), children: (t) =>
      R.div({ style: "display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #d7dae0" },
        R.span({ style: "cursor:pointer", "on:click": () => toggle(t.id) },
          () => done(t.id) ? "☑ " : "☐ ",
          R.span({ style: () => done(t.id) ? "text-decoration:line-through;color:#8a909c" : "" }, t.text)),
        R.button({ class: "sbtn", style: "width:26px;height:26px;font-size:13px",
          "on:click": () => remove(t.id) }, "✕"))
    })
  );
}`,
  },
  {
    name: "Shopping cart",
    code: `// Derived aggregation: line items → totals that recompute automatically.
function App() {
  const cart = state([
    { id: 1, name: "Keyboard", price: 79, qty: 1 },
    { id: 2, name: "Mouse", price: 39, qty: 2 }
  ]);
  const total = derived(() => cart().reduce((s, i) => s + i.price * i.qty, 0));
  const count = derived(() => cart().reduce((s, i) => s + i.qty, 0));
  const qtyOf = (id) => { const it = cart().find(x => x.id === id); return it ? it.qty : 0; };
  const setQty = (id, d) => cart.update(xs =>
    xs.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + d) } : i)
      .filter(i => i.qty > 0));

  return R.div(
    For({ each: () => cart(), children: (i) =>
      R.div({ style: "display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #d7dae0" },
        R.div(
          R.div({ style: "font-weight:600" }, i.name),
          R.div({ style: "color:#5b6270;font-size:13px" }, "$" + i.price + " each")),
        R.div({ style: "display:flex;align-items:center;gap:8px" },
          R.button({ class: "sbtn", style: "width:28px;height:28px", "on:click": () => setQty(i.id, -1) }, "−"),
          R.span({ style: "min-width:22px;text-align:center" }, () => qtyOf(i.id)),
          R.button({ class: "sbtn", style: "width:28px;height:28px", "on:click": () => setQty(i.id, 1) }, "+")))
    }),
    R.div({ style: "display:flex;justify-content:space-between;margin-top:16px;font-size:18px;font-weight:800" },
      R.span(() => count() + " items"),
      R.span({ style: "color:#0f6e4f" }, () => "$" + total()))
  );
}`,
  },
  {
    name: "Stopwatch",
    code: `// effect-free timer with onCleanup — the interval is cleared on dispose.
function App() {
  const ms = state(0);
  const running = state(false);
  let id = null;
  const label = derived(() => (ms() / 1000).toFixed(1) + "s");

  const start = () => { if (!running()) { running.set(true); id = setInterval(() => ms.update(v => v + 100), 100); } };
  const pause = () => { running.set(false); if (id) clearInterval(id); id = null; };
  const reset = () => { pause(); ms.set(0); };
  onCleanup(() => { if (id) clearInterval(id); });

  return R.div(
    R.div({ style: "font-size:46px;font-weight:850;font-variant-numeric:tabular-nums" }, () => label()),
    R.div({ style: "display:flex;gap:8px;margin-top:12px" },
      R.button({ class: "sbtn", style: "width:auto;padding:0 18px",
        "on:click": () => running() ? pause() : start() }, () => running() ? "Pause" : "Start"),
      R.button({ class: "sbtn", style: "width:auto;padding:0 18px", "on:click": reset }, "Reset"))
  );
}`,
  },
  {
    name: "Form + validation",
    code: `// Derived validation: errors and submit-enabled recompute from the inputs.
function App() {
  const email = state("");
  const pass = state("");
  const emailErr = derived(() => email() && !email().includes("@") ? "Enter a valid email" : "");
  const passErr = derived(() => pass() && pass().length < 6 ? "At least 6 characters" : "");
  const valid = derived(() => email() && pass() && !emailErr() && !passErr());
  const sent = state("");

  const field = (label, sig, err, type) => R.div({ style: "margin-bottom:12px" },
    R.label({ style: "display:block;font-size:13px;color:#5b6270;margin-bottom:4px" }, label),
    R.input({ type: type || "text",
      style: "width:100%;padding:9px 12px;border-radius:8px;border:1px solid #d7dae0;background:#ffffff;color:#15181d",
      "on:input": (e) => sig.set(e.target.value) }),
    R.div({ style: "color:#b42318;font-size:12px;min-height:15px;margin-top:3px" }, () => err()));

  return R.div(
    field("Email", email, emailErr, "text"),
    field("Password", pass, passErr, "password"),
    R.button({
      style: () => "padding:10px 18px;border-radius:9px;border:0;font-weight:700;background:#17457a;color:#ffffff;cursor:pointer" +
        (valid() ? "" : ";opacity:0.45;cursor:not-allowed"),
      "on:click": () => { if (valid()) sent.set("Signed up as " + email() + " ✓"); }
    }, "Sign up"),
    R.div({ style: "color:#0f6e4f;margin-top:12px" }, () => sent())
  );
}`,
  },
];

export function PlaygroundView() {
  const active = state(0);
  const error = state("");
  let previewEl: any = null;
  let ta: any = null;
  let disposeFn: (() => void) | null = null;

  function run(code: string) {
    if (!previewEl) return;
    if (disposeFn) {
      try {
        disposeFn();
      } catch {
        /* ignore */
      }
      disposeFn = null;
    }
    previewEl.textContent = "";
    try {
      const factory = new Function(
        "R", "state", "derived", "effect", "batch", "onCleanup", "For", "Show", "render",
        code + "\nreturn App;",
      );
      const App = factory(R, state, derived, effect, batch, onCleanup, For, Show, render);
      if (typeof App !== "function") throw new Error("Define a function named `App` that returns UI.");
      disposeFn = render(App, previewEl);
      error.set("");
    } catch (err: any) {
      error.set(String(err && err.message ? err.message : err));
    }
  }

  const load = (i: number) => {
    active.set(i);
    if (ta) ta.value = EXAMPLES[i]!.code;
    run(EXAMPLES[i]!.code);
  };

  return (
    <div class="view wrap block" style="padding-top:44px">
      <SectionHead
        eyebrow="Playground"
        title="Edit code, see it run"
        sub="Real RaptorJS running in your browser. Examples use h(tag, props, …children) — the primitives JSX compiles to — so no compiler is needed here."
      />

      <div class="pg-tabs" style="margin:20px 0 14px">
        {EXAMPLES.map((ex, i) => (
          <span class={() => "pg-tab" + (active() === i ? " active" : "")} on:click={() => load(i)}>
            {ex.name}
          </span>
        ))}
      </div>

      <div class="pg">
        <div class="pg-editor">
          <textarea
            class="pg-code"
            spellcheck="false"
            ref={(el: any) => {
              ta = el;
              el.value = EXAMPLES[0]!.code;
            }}
            on:input={(e: any) => run(e.target.value)}
          ></textarea>
          <div class="pg-err">{() => error()}</div>
        </div>
        <div class="pg-preview">
          <div class="phead">
            <span>Preview</span>
            <span class="badge-live">live</span>
          </div>
          <div
            ref={(el: any) => {
              previewEl = el;
              run(EXAMPLES[0]!.code);
            }}
          ></div>
        </div>
      </div>

      <p class="sub" style="margin-top:16px;font-size:13.5px">
        Available in scope: <code class="inl">h</code>, <code class="inl">state</code>,
        <code class="inl"> derived</code>, <code class="inl">effect</code>, <code class="inl">For</code>,
        <code class="inl"> Show</code>. Define a function <code class="inl">App</code> that returns UI.
      </p>
    </div>
  );
}
