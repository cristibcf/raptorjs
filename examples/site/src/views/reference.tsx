/**
 * Reference: a "which package do I need?" index + a page per package, in the same
 * format as the Components section — a running demo, import, signature,
 * parameters, example, notes.
 */
import { untracked } from "@raptorstack/raptorjs/dom";
import { sub, navigate } from "../lib/route.ts";
import { Code, inline } from "../lib/ui.tsx";
import { API_DEMOS } from "../demos/api.tsx";
import { REF_PACKAGES, PACKAGE_ROUTES, type RefPackage, type ApiEntry } from "../content/reference.ts";

const current = (): RefPackage | null => REF_PACKAGES.find((p) => p.slug === sub()) ?? null;

/** The 6 published packages; the reference entries group under them by their name prefix. */
const PACKAGE_GROUPS = ["@raptorstack/raptorjs", "@raptorstack/wire", "@raptorstack/engine", "@raptorstack/runtime", "@raptorstack/host", "@raptorstack/test"] as const;
const groupOf = (name: string): string => PACKAGE_GROUPS.find((g) => name.startsWith(g)) ?? PACKAGE_GROUPS[0];

function Sidebar() {
  return (
    <aside class="sidebar">
      <div class="side-group">
        <span
          class={() => "side-item" + (current() === null ? " active" : "")}
          on:click={() => navigate("reference")}
        >
          Which package?
        </span>
      </div>
      {PACKAGE_GROUPS.map((g) => {
        const items = REF_PACKAGES.filter((p) => groupOf(p.name) === g).sort((a, b) =>
          a.name === g ? -1 : b.name === g ? 1 : a.name.localeCompare(b.name),
        );
        return (
          <div class="side-group">
            <div class="side-title" style="font-family:var(--mono)">{g}</div>
            {items.map((p) => (
              <span
                class={() => "side-item" + (current()?.slug === p.slug ? " active" : "")}
                on:click={() => navigate("reference/" + p.slug)}
                style="padding-left:18px"
              >
                {p.name === g ? "overview" : p.name.slice(g.length)}
              </span>
            ))}
          </div>
        );
      })}
    </aside>
  );
}

/**
 * The importable name of an entry, or `null` if it is not one.
 *
 * `state` -> `state`; `raptor-bundle (CLI)` -> `raptor-bundle`, which is not an
 * identifier, so `null`; `raptor.runtime.json` likewise. The rule is deliberately
 * simple: if after cleanup no JS identifier remains, we do not invent an
 * import line.
 */
function importableSymbol(name: string): string | null {
  const bare = name.replace(/\s*\(.*\)$/, "").trim();
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bare) ? bare : null;
}

function Entry(props: { e: ApiEntry; pkg: string }) {
  const e = props.e;
  const makeDemo = e.demo ? API_DEMOS[e.demo] : undefined;
  return (
    <div class="api">
      <h3 id={e.name} style="font-family:var(--mono)">{e.name}</h3>
      <div class="sig">{e.signature}</div>
      <p style="color:var(--muted);margin:12px 0">{inline(e.summary)}</p>

      {makeDemo ? (
        <div>
          <div class="api-live">
            Live<span class="cmp-live">running in this page</span>
          </div>
          {/* Untracked, as in Components: a component that reads a signal while
              it is being built must not subscribe the page's binding. */}
          <div class="cmp-stage">{untracked(() => makeDemo())}</div>
        </div>
      ) : null}

      {/* The import line is shown only when the entry REALLY is an importable
          symbol. Entries that describe a manifest file, a namespace or a binary
          otherwise produced text that does not compile
          (`import { raptor: modules } from ...`). */}
      {importableSymbol(e.name) !== null ? (
        <div class="api-import">
          <code class="inl">
            import {"{"} {importableSymbol(e.name)} {"}"} from "{props.pkg}"
          </code>
        </div>
      ) : null}

      {e.params && e.params.length > 0 ? (
        <div class="params">
          {e.params.map((p) => (
            <div class="param">
              <span class="pn2">{p.name}<span style="color:var(--dim)">: {p.type}</span></span>
              <span style="color:var(--muted)">{inline(p.desc)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {e.returns ? (
        <p style="color:var(--muted);font-size:14px">
          <b style="color:var(--accent)">Returns</b> — {inline(e.returns)}
        </p>
      ) : null}

      <Code code={e.example} lang={e.lang} />

      {e.notes && e.notes.length > 0 ? (
        <div class="api-notes">
          <div class="ct">Notes</div>
          <ul>{e.notes.map((n) => <li>{inline(n)}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function PackagePage(p: RefPackage) {
  return (
    <article class="prose pane-enter">
      <div class="crumbs">
        <b on:click={() => navigate("reference")} style="cursor:pointer">Reference</b> / packages
      </div>
      <h1 style="font-family:var(--mono)">{p.name}</h1>
      <p class="intro">{inline(p.tagline)}</p>
      {p.entries.map((e) => <Entry e={e} pkg={p.name} />)}
    </article>
  );
}

/* -------------------------------------------------------------------- index -- */

function Index() {
  return (
    <article class="prose pane-enter">
      <div class="crumbs">
        <b>Reference</b> / packages
      </div>
      <h1>Which package do I need?</h1>
      <p class="intro">
        {inline(
          "Raptor ships as separate packages so you can take only the layer you want. Find the row that " +
            "matches what you are building — most apps need one or two.",
        )}
      </p>

      <div class="routes">
        {PACKAGE_ROUTES.map((r) => (
          <div class="route" on:click={() => navigate("reference/" + r.to)}>
            <div class="route-want">{r.want}</div>
            <div>
              <div class="route-pkgs">
                {r.packages.map((name) => (
                  <code class="inl">{name}</code>
                ))}
              </div>
              <p class="route-note">{inline(r.note)}</p>
            </div>
          </div>
        ))}
      </div>

      <div class="callout tip">
        <div class="ct">
          <span>⚡</span>Not sure yet?
        </div>
        <div>
          {inline(
            "Start with `@raptorstack/raptorjs/dom`. It is the DOM runtime, and it re-exports the reactive primitives too, " +
              "so a first app needs one import and you can add realtime or the component library later without " +
              "moving any of them. The [Quick start](/learn/quick-start) assumes exactly that.",
          )}
        </div>
      </div>

      <h2 id="all">Every package</h2>
      <div class="routes">
        {REF_PACKAGES.map((p) => (
          <div class="route" on:click={() => navigate("reference/" + p.slug)}>
            <div class="route-want" style="font-family:var(--mono);font-size:13.5px">{p.name}</div>
            <p class="route-note">{inline(p.tagline)}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function ReferenceView() {
  return (
    <div class="view wrap doc-shell">
      <Sidebar />
      {() => {
        const p = current();
        return p ? PackagePage(p) : Index();
      }}
    </div>
  );
}
