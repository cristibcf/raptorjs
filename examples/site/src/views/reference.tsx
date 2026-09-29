/**
 * Reference: index „ce pachet imi trebuie?" + pagina per pachet, cu acelasi
 * format ca sectiunea Components — demo care ruleaza, import, semnatura,
 * parametri, exemplu, note.
 */
import { untracked } from "raptorjs/dom";
import { sub, navigate } from "../lib/route.ts";
import { Code, inline } from "../lib/ui.tsx";
import { API_DEMOS } from "../demos/api.tsx";
import { REF_PACKAGES, PACKAGE_ROUTES, type RefPackage, type ApiEntry } from "../content/reference.ts";

const current = (): RefPackage | null => REF_PACKAGES.find((p) => p.slug === sub()) ?? null;

/** Cele 6 pachete publicate; intrarile de referinta se grupeaza sub ele dupa prefixul numelui. */
const PACKAGE_GROUPS = ["raptorjs", "@raptor/wire", "@raptor/engine", "@raptor/runtime", "@raptor/host", "@raptor/test"] as const;
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
 * Numele importabil al unei intrari, sau `null` daca nu e unul.
 *
 * `state` -> `state`; `raptor-bundle (CLI)` -> `raptor-bundle`, care nu e
 * identificator, deci `null`; `raptor.runtime.json` la fel. Regula e simpla
 * dinadins: daca dupa curatare nu ramane un identificator JS, nu inventam o
 * linie de import.
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
          {/* Untracked ca la Components: o componenta care citeste un semnal in
              timp ce se construieste nu trebuie sa aboneze bindingul paginii. */}
          <div class="cmp-stage">{untracked(() => makeDemo())}</div>
        </div>
      ) : null}

      {/* Linia de import se arata doar cand intrarea CHIAR e un simbol
          importabil. Intrarile care descriu un fisier de manifest, un spatiu de
          nume sau un binar produceau altfel text care nu se compileaza
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
            "Start with `raptorjs/dom`. It is the DOM runtime, and it re-exports the reactive primitives too, " +
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
