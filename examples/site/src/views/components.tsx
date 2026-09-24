/**
 * Components: the @raptor/ui catalog. Sidebar of groups, one page per component
 * with a live demo built by the shipped component itself, its source, and props.
 *
 * Everything here is data-driven from `src/catalog` — the routes, the sidebar,
 * the index page and prev/next all come from the same array.
 */
import { untracked } from "@raptor/dom";
import { effect } from "@raptor/core";
import { sub, navigate } from "../lib/route.ts";
import { importLine } from "../catalog/modules.ts";
import { Code, inline } from "../lib/ui.tsx";
import {
  CATALOG,
  ALL_COMPONENTS,
  COMPONENT_COUNT,
  findComponent,
  groupOf,
  type ComponentDoc,
  type CatalogGroup,
} from "../catalog/index.ts";

const current = (): ComponentDoc | null => findComponent(sub());

function Sidebar() {
  /**
   * Sidebar-ul e construit O SINGURA DATA si nu se mai reconstruieste la
   * navigare — doar clasa `active` a unui element se schimba. Asa isi pastreaza
   * scroll-ul, ceea ce conteaza intr-o lista de ~200 de componente.
   */
  const items = new Map<string, HTMLElement>();

  // Cand ajungi la o componenta altfel decat prin click (Prev/Next, link direct,
  // butonul Back), o aducem in vizor. `nearest` nu misca nimic daca e deja
  // vizibila, deci nu smucim pagina sub degetul utilizatorului.
  effect(() => {
    const slug = current()?.slug;
    const el = slug ? items.get(slug) : undefined;
    if (!el || typeof el.getBoundingClientRect !== "function") return;
    const list = el.closest(".sidebar");
    if (!list) return;
    const a = el.getBoundingClientRect();
    const b = list.getBoundingClientRect();
    if (a.top >= b.top && a.bottom <= b.bottom) return; // deja vizibila
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  return (
    <aside class="sidebar">
      <div class="side-group">
        <span
          class={() => "side-item" + (current() === null ? " active" : "")}
          on:click={() => navigate("components")}
        >
          All components
        </span>
      </div>
      {CATALOG.map((g) => (
        <div class="side-group">
          <div class="side-title">{g.title}</div>
          {g.items.map((c) => (
            <span
              class={() => "side-item" + (current()?.slug === c.slug ? " active" : "")}
              ref={(el: HTMLElement) => items.set(c.slug, el)}
              on:click={() => navigate("components/" + c.slug)}
            >
              {c.name}
            </span>
          ))}
        </div>
      ))}
    </aside>
  );
}

function Tier(props: { tier?: ComponentDoc["tier"] }) {
  if (!props.tier) return null;
  const text =
    props.tier === "T1" ? "core" : props.tier === "T2" ? "expected" : "specialised";
  return <span class={"tier " + props.tier.toLowerCase()}>{props.tier} · {text}</span>;
}

/* ------------------------------------------------------------------ detail -- */

function PrevNext() {
  const i = ALL_COMPONENTS.findIndex((c) => c.slug === current()?.slug);
  const prev = ALL_COMPONENTS[i - 1];
  const next = ALL_COMPONENTS[i + 1];
  return (
    <div class="prevnext">
      {prev ? (
        <div class="pn" on:click={() => navigate("components/" + prev.slug)}>
          <div class="d">← Previous</div>
          <div class="t">{prev.name}</div>
        </div>
      ) : (
        <div></div>
      )}
      {next ? (
        <div class="pn next" on:click={() => navigate("components/" + next.slug)}>
          <div class="d">Next →</div>
          <div class="t">{next.name}</div>
        </div>
      ) : (
        <div></div>
      )}
    </div>
  );
}

function Detail(c: ComponentDoc) {
  const group = groupOf(c.slug);
  return (
    <article class="prose pane-enter">
      <div class="crumbs">
        <b on:click={() => navigate("components")} style="cursor:pointer">
          Components
        </b>{" "}
        / {group?.title ?? ""}
      </div>
      <h1>{c.name}</h1>
      <div class="cmp-meta">
        <Tier tier={c.tier} />
        <code class="inl">{importLine(c.name)}</code>
      </div>
      <p class="intro">{inline(c.summary)}</p>
      {c.thesis ? (
        <div class="callout tip">
          <div class="ct">
            <span>⚡</span>Why fine-grained wins here
          </div>
          <div>{inline(c.thesis)}</div>
        </div>
      ) : null}

      <h2 id="demo">
        Live
        <span class="cmp-live">running in this page</span>
      </h2>
      {/* The demo is built untracked: a component that reads a signal while it
          builds must not subscribe the view binding, or changing that signal
          would re-render the whole page instead of the one binding it belongs to. */}
      <div class="cmp-stage">{untracked(() => c.demo())}</div>

      <Code code={c.code} file="usage.ts" />

      {c.props && c.props.length > 0 ? (
        <div>
          <h2 id="props">Props</h2>
          <div class="params">
            {c.props.map((p) => (
              <div class="param">
                <span class="pn2">{p.name}</span>
                <span>
                  <code class="inl">{p.type}</code>
                  <span style="display:block;color:var(--muted);margin-top:4px">{p.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {c.notes && c.notes.length > 0 ? (
        <div>
          <h2 id="notes">Notes</h2>
          <ul>{c.notes.map((n) => <li>{inline(n)}</li>)}</ul>
        </div>
      ) : null}

      <PrevNext />
    </article>
  );
}

/* ------------------------------------------------------------------- index -- */

function GroupCard(props: { group: CatalogGroup }) {
  const g = props.group;
  return (
    <div class="cmp-group">
      <div class="cmp-group-head">
        <h2 id={g.slug} style="margin:0">
          {g.title}
        </h2>
        <span class="cmp-count">{g.items.length}</span>
      </div>
      <p style="margin:6px 0 14px">{g.blurb}</p>
      <div class="cmp-chips">
        {g.items.map((c) => (
          <span class="cmp-chip" on:click={() => navigate("components/" + c.slug)}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function Index() {
  return (
    <article class="prose pane-enter">
      <div class="crumbs">
        <b>Components</b> / @raptor/ui
      </div>
      <h1>Components</h1>
      <p class="intro">
        {inline(
          "`@raptor/ui` is built on the same fine-grained bindings as everything else: no component " +
            "re-renders, every dynamic piece is a binding that touches exactly one attribute, text node or row. " +
            "Styles are optional and separate — the components only set `rui-*` classes and ARIA attributes.",
        )}
      </p>
      <div class="cmp-stats">
        <div class="s">
          <div class="num">{COMPONENT_COUNT}</div>
          <div class="cap">documented here, each with a live demo</div>
        </div>
        <div class="s">
          <div class="num">0</div>
          <div class="cap">runtime dependencies</div>
        </div>
        <div class="s">
          <div class="num">CSS</div>
          <div class="cap">optional — import it, override it, or ignore it</div>
        </div>
      </div>
      <div class="callout">
        <div class="ct">
          <span>ℹ</span>Using them
        </div>
        <div>
          {inline(
            "Components are plain functions returning real DOM, so JSX is optional: call `Button({ ... })` " +
              "directly, or use `<Button />` if you compile JSX. For the stylesheet, call `installStyles()` " +
              "from `@raptor/ui/styles` once at startup.",
          )}
        </div>
      </div>
      {CATALOG.map((g) => (
        <GroupCard group={g} />
      ))}
    </article>
  );
}

export function ComponentsView() {
  return (
    <div class="view wrap doc-shell">
      <Sidebar />
      {() => {
        const c = current();
        return c ? Detail(c) : Index();
      }}
    </div>
  );
}
