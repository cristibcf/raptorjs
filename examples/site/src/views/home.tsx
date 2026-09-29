/** Overview page — light editorial design: hero, three bets, live demos, the
 *  four-layer diagram, honest numbers, and current-status positioning. */
import { navigate } from "../lib/route.ts";
import { COMPONENT_COUNT } from "../catalog/index.ts";
import { RUNTIME_DEPENDENCIES, TEST_COUNT } from "../content/stats.ts";
import { SectionHead, highlight } from "../lib/ui.tsx";
import { DemoCounter, DemoTodo, DemoRealtime } from "../demos/index.tsx";

const HERO_SRC = `import { render, state, derived } from "raptorjs/dom";

function Counter() {
  const count = state(0);
  const doubled = derived(() => count() * 2);

  return (
    <button on:click={() => count.update(n => n + 1)}>
      {count} · doubled {doubled}
    </button>
  );
}

render(Counter, document.getElementById("app"));
// compiled: 1 binding, 0 diffs, 0 re-renders`;

const GOOD_FIT = [
  "You are building realtime UI — dashboards, collaborative editing, live monitoring — where the server pushes changes continuously.",
  "The screen updates far more often than it navigates: many small state changes per second, each touching a few nodes.",
  "You work in TypeScript on Node and want an install graph small enough to read end to end.",
];

const NOT_YET = [
  "You need a mature ecosystem — auth, i18n, payments, CMS adapters — that already exists and is documented.",
  "Your build depends on a plugin chain: MDX, image pipelines, framework-specific integrations.",
  "The team needs conventions it already knows and answers it can look up today.",
];

const BETS = [
  { n: "01", title: "No virtual DOM", body: "The compiler resolves every reactive expression to a binding. A state change reaches exactly one binding — nothing is diffed, nothing re-renders." },
  { n: "02", title: "State-aware protocol", body: "Server and client hold the same graph, so the wire carries delta operations rather than whole documents. Around 65% smaller than equivalent JSON re-sends." },
  { n: "03", title: "Zero dependencies", body: "Raptor ships its own bundler and runs TypeScript natively on Node. No Vite, no webpack, no plugin chain to keep in sync with the framework." },
];

const LAYERS = [
  { t: "Compiler", s: ".tsx → bindings" },
  { t: "Runtime", s: "signals" },
  { t: "Network", s: "delta ops" },
  { t: "UI", s: "DOM nodes" },
];

function Diagram() {
  const nodes: any[] = [];
  LAYERS.forEach((l, i) => {
    nodes.push(
      <div class="layer">
        <div class="box"><div class="t">{l.t}</div><div class="s">{l.s}</div></div>
      </div>,
    );
    if (i < LAYERS.length - 1) nodes.push(<div class="conn"></div>);
  });
  return (
    <div class="card" style="padding:32px 26px">
      <div class="layers">{nodes}</div>
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:15px;text-align:center;font-family:var(--mono);font-size:11.5px;color:var(--dim)">
        one schema · declared once · checked at compile time
      </div>
    </div>
  );
}

function FitList(props: { items: string[]; kind: "yes" | "no" }) {
  return (
    <ul class={"fit " + props.kind}>
      {props.items.map((text) => (
        <li>
          <span class="m">{props.kind === "yes" ? "✓" : "—"}</span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function NumberCard(props: { label: string; children: any }) {
  return (
    <div class="card" style="padding:26px">
      <div style="font-size:13px;color:var(--dim);margin-bottom:20px">{props.label}</div>
      {props.children}
    </div>
  );
}

function Bar(props: { name: string; value: string; pct: number; accent?: boolean }) {
  return (
    <div class="barrow" style="margin-bottom:15px">
      <div class="top" style={props.accent ? "color:var(--accent);font-weight:500" : ""}>
        <span>{props.name}</span>
        <span>{props.value}</span>
      </div>
      <div class="bartrack"><div class="barfill" style={"width:" + props.pct + "%;background:" + (props.accent ? "var(--accent)" : "#c5cad3")}></div></div>
    </div>
  );
}

export function HomeView() {
  return (
    <div class="view">
      <section class="hero">
        <div class="wrap hero-grid">
          <div>
            <div class="pill">Early prototype · open source · MIT</div>
            <h1>
              The compiler, the runtime and the <span class="grad">wire</span> share one state graph.
            </h1>
            <p class="lead">
              Raptor is a zero-dependency stack for reactive and realtime apps. Fine-grained signals replace
              the virtual DOM, and a state-aware binary protocol sends delta operations instead of
              re-serialized JSON.
            </p>
            <div class="cta">
              <span class="btn btn-primary" on:click={() => navigate("learn/quick-start")}>Start learning</span>
              <span class="btn btn-ghost" on:click={() => navigate("reference")}>Read the docs</span>
            </div>
          </div>
          <div class="codewin">
            <div class="wbar">
              <span class="wt">counter.tsx</span>
              <span class="wsub">runs on Node, no build step</span>
            </div>
            <pre class="code">{highlight(HERO_SRC)}</pre>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="wrap">
          <SectionHead
            eyebrow="Is this for you?"
            title="What Raptor is good at — and what it isn't"
            sub="Raptor is v0.1.0-alpha. It is worth your time for a specific shape of app, and a bad trade for others. Here is the honest split before you read further."
          />
          <div class="grid cols-2">
            <div class="card">
              <h3>Reach for Raptor when</h3>
              <FitList items={GOOD_FIT} kind="yes" />
            </div>
            <div class="card">
              <h3>Choose something else when</h3>
              <FitList items={NOT_YET} kind="no" />
            </div>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="wrap">
          <div class="eyebrow">Three bets</div>
          <div class="grid cols-3">
            {BETS.map((b) => (
              <div class="card">
                <div class="num-lbl">{b.n}</div>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="block soft">
        <div class="wrap">
          <SectionHead eyebrow="It runs, right here" title="Not screenshots — live components" sub="Every widget below uses the real reactive runtime and the RaptorWire protocol, compiled by RaptorBundle in this very page." />
          <div class="grid cols-3" style="align-items:start">
            <div>
              <h3 style="font-size:16px;margin-bottom:2px">Reactivity</h3>
              <p class="sub" style="font-size:13.5px;margin-bottom:8px">One signal, live bindings.</p>
              <DemoCounter />
            </div>
            <div>
              <h3 style="font-size:16px;margin-bottom:2px">Control flow</h3>
              <p class="sub" style="font-size:13.5px;margin-bottom:8px">Keyed list with For.</p>
              <DemoTodo />
            </div>
            <div>
              <h3 style="font-size:16px;margin-bottom:2px">Realtime</h3>
              <p class="sub" style="font-size:13.5px;margin-bottom:8px">Server ↔ wire ↔ client.</p>
              <DemoRealtime />
            </div>
          </div>
          <div class="row" style="margin-top:26px">
            <span
              style="cursor:pointer;font-size:14.5px;font-weight:500;color:var(--accent)"
              on:click={() => navigate("components")}
            >
              Browse the component library — {String(COMPONENT_COUNT)} components, each with a live demo →
            </span>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="wrap" style="display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:56px;align-items:center">
          <div>
            <h2 class="h2">Change a field once, not four times</h2>
            <p class="sub" style="margin:16px 0 14px;font-size:17px;color:var(--text)">
              Rename a field in one place and the UI binding, the realtime message and the types all follow.
              There is no second schema to keep in sync — and if you miss a use, it is a compile error, not a
              runtime surprise.
            </p>
            <p class="sub" style="margin:0 0 18px">
              That is what the four layers buy you. Most stacks re-describe the same data four times: a
              TypeScript type, a validation schema, a wire format, and a component's props. Raptor derives
              all four from one declaration.
            </p>
            <span style="cursor:pointer;font-size:14.5px;font-weight:500;color:var(--accent)" on:click={() => navigate("learn/realtime-with-raptorwire")}>Read: the state graph →</span>
          </div>
          <Diagram />
        </div>
      </section>

      <section class="block">
        <div class="wrap">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;flex-wrap:wrap">
            <h2 class="h2" style="margin:0">Numbers, honestly</h2>
            <p style="font-family:var(--mono);font-size:12px;color:var(--faint);margin:0;max-width:46ch;text-align:right">
              Chromium and jsdom, production builds, median of six. Reproduce the browser numbers with{" "}
              <span style="color:#3c424d">cd benchmarks &amp;&amp; npm run build:browser &amp;&amp; npm run serve:browser</span>,
              the jsdom ones with <span style="color:#3c424d">npm run bench</span>.
            </p>
          </div>
          <div class="grid cols-3">
            <NumberCard label="Update 100 rows of 1,000 — browser, ms">
              <Bar name="Raptor" value="0.35" pct={14} accent={true} />
              <Bar name="React 19" value="1.10" pct={43} />
              <Bar name="Solid 1.9" value="1.25" pct={49} />
              <Bar name="Preact 10" value="2.55" pct={100} />
              <div style="margin-top:16px;font-size:13.5px;color:var(--muted)">
                Same DOM mutations in every framework. The gap is reconciliation, not DOM work.
              </div>
            </NumberCard>
            <NumberCard label="Signal propagation — updates/sec">
              <Bar name="@preact/signals" value="455k" pct={100} />
              <Bar name="Raptor" value="186k" pct={41} />
              <div style="margin-top:16px;font-size:13.5px;color:var(--muted)">
                <b style="color:var(--text)">Raptor loses this one</b> — 2.4× slower on a pure computation
                graph, identical checksum. Years of tuning we have not done yet.
              </div>
            </NumberCard>
            <NumberCard label="Wire payload, realtime dashboard tick">
              <Bar name="JSON re-send" value="~370 B" pct={100} />
              <Bar name="Raptor delta ops" value="~140 B" pct={38} accent={true} />
              <div style="margin-top:16px;font-size:13.5px;color:var(--muted)">~62% less traffic for the same update.</div>
            </NumberCard>
          </div>
          <div class="row" style="margin-top:26px;gap:28px;flex-wrap:wrap">
            <span
              style="cursor:pointer;font-size:14.5px;font-weight:500;color:var(--accent)"
              on:click={() => navigate("learn/performance")}
            >
              All eight operations, the two Preact wins, and what is not measured →
            </span>
            <span style="font-size:13.5px;color:var(--muted)">
              {String(RUNTIME_DEPENDENCIES)} runtime dependencies · {String(TEST_COUNT)} tests
            </span>
          </div>
        </div>
      </section>

      <section class="block soft" style="border-bottom:0">
        <div class="wrap" style="max-width:880px">
          <div class="eyebrow">Where Raptor is today</div>
          <p class="serif" style="font-size:23px;line-height:1.5;margin:24px 0 22px;text-wrap:pretty">
            Raptor is an architecture bet: one state graph, carried from the compiler all the way to the
            wire. The bet is not yet proven anywhere but this repository's own benchmarks.
          </p>
          <p style="font-size:16px;line-height:1.65;color:var(--muted);margin:0 0 30px;max-width:66ch">
            What you get here instead is a small, readable stack where the compiler, runtime and network agree
            on one model — and a codebase early enough that your issue can change the design.
          </p>
          <div class="cta" style="margin-top:0">
            <span class="btn btn-primary" on:click={() => navigate("tutorial")}>Start the tutorial</span>
            <span class="btn btn-ghost" on:click={() => navigate("playground")}>Open the playground</span>
          </div>
        </div>
      </section>
    </div>
  );
}
