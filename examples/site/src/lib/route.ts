/**
 * Nested hash routing via a signal (dogfoods @raptor/core). The whole path lives
 * in one signal; `section()` / `sub()` derive the parts. Changing it re-binds
 * only the view region in the shell — no page re-render.
 */
import { state, derived } from "@raptor/core";

function fromHash(): string {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  return h.replace(/\/+$/, "") || "home";
}

export const path = state<string>(fromHash());

export function navigate(p: string): void {
  const clean = p.replace(/^#?\/?/, "").replace(/\/+$/, "") || "home";
  if (location.hash !== "#/" + clean) history.pushState(null, "", "#/" + clean);
  path.set(clean);
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

/**
 * Sectiunea si restul caii sunt `derived`, NU functii simple.
 *
 * Conteaza: o functie care citeste `path()` isi face abonatul dependent de
 * INTREAGA cale, deci regiunea din shell care face `switch (section())` s-ar
 * re-executa la fiecare navigare - inclusiv intre doua componente din aceeasi
 * sectiune - si ar reconstrui tot ecranul (sidebar cu tot cu scroll-ul lui).
 *
 * Ca `derived`, valoarea e memoizata si comparata: cand treci de la
 * `components/button` la `components/slider`, `section` ramane "components" si
 * nu notifica pe nimeni. Se schimba doar regiunea care depinde de `sub`.
 */
const sectionMemo = derived(() => path().split("/")[0] || "home");
const subMemo = derived(() => path().split("/").slice(1).join("/"));

/** Top-level section: home | learn | reference | playground. */
export const section = (): string => sectionMemo();
/** Everything after the section (e.g. "state-and-reactivity"). */
export const sub = (): string => subMemo();

window.addEventListener("hashchange", () => path.set(fromHash()));
window.addEventListener("popstate", () => path.set(fromHash()));
