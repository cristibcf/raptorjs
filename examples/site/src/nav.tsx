/** Top navigation (light editorial theme). Active state reactive on section(). */
import { state, derived, Show } from "@raptorstack/raptorjs/dom";
import { section, navigate } from "./lib/route.ts";
import { search } from "./lib/search.ts";

function link(name: string, label: string) {
  return (
    <span class={() => "nav-link" + (section() === name ? " active" : "")} on:click={() => navigate(name)}>
      {label}
    </span>
  );
}

function Search() {
  const q = state("");
  const open = state(false);
  const results = derived(() => search(q(), 8));
  let inputEl: any = null;

  const choose = (path: string) => {
    navigate(path);
    q.set("");
    open.set(false);
    if (inputEl) inputEl.blur();
  };

  // "/" focuses the search from anywhere; Esc closes it.
  window.addEventListener("keydown", (e) => {
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (e.key === "/" && tag !== "input" && tag !== "textarea") {
      e.preventDefault();
      inputEl?.focus();
    } else if (e.key === "Escape") {
      open.set(false);
      inputEl?.blur();
    }
  });

  return (
    <div class="search">
      <span class="search-ic">⌕</span>
      <input
        class="search-input"
        placeholder="Search"
        spellcheck="false"
        ref={(el: any) => (inputEl = el)}
        on:input={(e: any) => {
          q.set(e.target.value);
          open.set(true);
        }}
        on:focus={() => open.set(true)}
        on:blur={() => setTimeout(() => open.set(false), 130)}
      />
      <span class="search-slash">/</span>
      <Show
        when={() => open() && results().length > 0}
        children={
          <div class="search-panel">
            {() =>
              results().map((r) => (
                <div class="search-item" on:mousedown={(e: any) => { e.preventDefault(); choose(r.path); }}>
                  <span class="search-title">{r.title}</span>
                  <span class="search-kind">{r.kind}</span>
                </div>
              ))
            }
          </div>
        }
      />
      <Show
        when={() => open() && q().trim().length >= 2 && results().length === 0}
        children={<div class="search-panel"><div class="search-empty">No matches</div></div>}
      />
    </div>
  );
}

export function Nav() {
  return (
    <header class="nav">
      <div class="wrap nav-inner">
        <div class="brand" on:click={() => navigate("home")}>
          <span class="logo"></span>
          <span class="name">raptor</span>
          <span class="ver">v0.1.0-alpha</span>
        </div>
        <nav class="links">
          {link("home", "Overview")}
          {link("learn", "Learn")}
          {link("tutorial", "Tutorial")}
          {link("components", "Components")}
          {link("reference", "Docs")}
          {link("playground", "Playground")}
          {link("showcase", "Showcase")}
        </nav>
        <div class="nav-right">
          <Search />
          <a class="ghost-btn" href="https://github.com/cristibcf/raptorjs" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </header>
  );
}
