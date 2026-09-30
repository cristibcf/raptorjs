/**
 * mediaQuery - a media query as a signal.
 *
 * `const isWide = mediaQuery("(min-width: 768px)")` then `isWide()` wherever you
 * need it. There is no `matchMedia` on the server or in tests: in that case it
 * returns `fallback` and subscribes to nothing.
 */
import { state, onCleanup, type Accessor } from "raptorjs";

export function mediaQuery(query: string, fallback = false): Accessor<boolean> {
  const mm = (globalThis as any).matchMedia;
  if (typeof mm !== "function") return () => fallback;

  const list = mm.call(globalThis, query);
  const matches = state<boolean>(Boolean(list.matches));
  const onChange = (e: any): void => matches.set(Boolean(e.matches));

  // Safari < 14 has no addEventListener on MediaQueryList.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    onCleanup(() => list.removeEventListener("change", onChange));
  } else if (typeof list.addListener === "function") {
    list.addListener(onChange);
    onCleanup(() => list.removeListener(onChange));
  }

  return () => matches();
}

/** Common breakpoints, as signals. */
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

/** `true` if the user has requested reduced motion. */
export function prefersReducedMotion(): Accessor<boolean> {
  return mediaQuery("(prefers-reduced-motion: reduce)");
}
