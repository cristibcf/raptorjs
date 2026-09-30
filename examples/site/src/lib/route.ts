/**
 * Nested hash routing via a signal (dogfoods raptorjs). The whole path lives
 * in one signal; `section()` / `sub()` derive the parts. Changing it re-binds
 * only the view region in the shell — no page re-render.
 */
import { state, derived } from "raptorjs";

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
 * The section and the rest of the path are `derived`, NOT plain functions.
 *
 * It matters: a function that reads `path()` makes its subscriber depend on the
 * WHOLE path, so the region in the shell that does `switch (section())` would
 * re-run on every navigation - including between two components in the same
 * section - and would rebuild the whole screen (sidebar and its scroll along with it).
 *
 * As a `derived`, the value is memoised and compared: when you go from
 * `components/button` to `components/slider`, `section` stays "components" and
 * notifies no one. Only the region that depends on `sub` changes.
 */
const sectionMemo = derived(() => path().split("/")[0] || "home");
const subMemo = derived(() => path().split("/").slice(1).join("/"));

/** Top-level section: home | learn | reference | playground. */
export const section = (): string => sectionMemo();
/** Everything after the section (e.g. "state-and-reactivity"). */
export const sub = (): string => subMemo();

window.addEventListener("hashchange", () => path.set(fromHash()));
window.addEventListener("popstate", () => path.set(fromHash()));
