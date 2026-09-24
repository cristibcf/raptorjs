/**
 * mediaQuery - un media query ca semnal.
 *
 * `const isWide = mediaQuery("(min-width: 768px)")` apoi `isWide()` oriunde ai
 * nevoie. Nu exista `matchMedia` pe server sau in teste: atunci intoarce
 * `fallback` si nu se aboneaza la nimic.
 */
import { state, onCleanup, type Accessor } from "@raptor/core";

export function mediaQuery(query: string, fallback = false): Accessor<boolean> {
  const mm = (globalThis as any).matchMedia;
  if (typeof mm !== "function") return () => fallback;

  const list = mm.call(globalThis, query);
  const matches = state<boolean>(Boolean(list.matches));
  const onChange = (e: any): void => matches.set(Boolean(e.matches));

  // Safari < 14 nu are addEventListener pe MediaQueryList.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    onCleanup(() => list.removeEventListener("change", onChange));
  } else if (typeof list.addListener === "function") {
    list.addListener(onChange);
    onCleanup(() => list.removeListener(onChange));
  }

  return () => matches();
}

/** Breakpoint-uri uzuale, ca semnale. */
export function breakpoints(): {
  sm: Accessor<boolean>;
  md: Accessor<boolean>;
  lg: Accessor<boolean>;
  xl: Accessor<boolean>;
} {
  return {
    sm: mediaQuery("(min-width: 640px)"),
    md: mediaQuery("(min-width: 768px)"),
    lg: mediaQuery("(min-width: 1024px)"),
    xl: mediaQuery("(min-width: 1280px)"),
  };
}

/** `true` daca utilizatorul a cerut mai putina miscare. */
export function prefersReducedMotion(): Accessor<boolean> {
  return mediaQuery("(prefers-reduced-motion: reduce)");
}
