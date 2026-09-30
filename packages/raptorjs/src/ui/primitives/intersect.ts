/**
 * intersects / infiniteScroll - visibility as a signal.
 *
 * `IntersectionObserver` exists neither in Node nor on mini-dom. Both primitives
 * therefore expose a manual `trigger()`: in the browser the observer calls it,
 * in tests you call it yourself. That way the loading logic is testable without
 * real layout.
 */
import { state, onCleanup, type Accessor } from "@raptorstack/raptorjs";
import { type El } from "./env.ts";

export interface IntersectOptions {
  /** How much of the element must be seen (0..1). Defaults to 0. */
  threshold?: number;
  /** Margin around the root, CSS syntax. */
  rootMargin?: string;
  /** After the first entry into the viewport, stop observing. Defaults to `false`. */
  once?: boolean;
}

export interface Intersect {
  ref: (el: El) => void;
  visible: Accessor<boolean>;
  /** Manually mark visibility (tests, SSR, control from outside). */
  trigger: (visible: boolean) => void;
}

export function intersects(options?: IntersectOptions): Intersect {
  const visible = state(false);
  let done = false;

  const trigger = (next: boolean): void => {
    if (done) return;
    visible.set(next);
    if (next && options?.once) done = true;
  };

  const ref = (el: El): void => {
    if (!el) return;
    const IO = (globalThis as any).IntersectionObserver;
    if (typeof IO !== "function") return;

    const observer = new IO(
      (entries: any[]) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        trigger(Boolean(entry.isIntersecting));
        if (done) observer.disconnect();
      },
      { threshold: options?.threshold ?? 0, rootMargin: options?.rootMargin ?? "0px" },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  return { ref, visible: () => visible(), trigger };
}

export interface InfiniteScrollOptions {
  /** Called when the sentinel becomes visible and a load isn't already in progress. */
  onLoad: () => void | Promise<void>;
  /** While this returns `false`, nothing more loads (the list is exhausted). */
  hasMore?: () => boolean;
  rootMargin?: string;
}

export interface InfiniteScroll {
  /** `ref` for the sentinel placed at the end of the list. */
  ref: (el: El) => void;
  loading: Accessor<boolean>;
  /** Manually trigger a load (tests, "load more" button). */
  load: () => void;
}

export function infiniteScroll(options: InfiniteScrollOptions): InfiniteScroll {
  const loading = state(false);

  const load = (): void => {
    if (loading.peek()) return;
    if (options.hasMore && !options.hasMore()) return;
    loading.set(true);
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      loading.set(false);
    };
    try {
      const result = options.onLoad();
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(finish, finish);
      } else {
        finish();
      }
    } catch {
      finish();
    }
  };

  const sentinel = intersects({ rootMargin: options.rootMargin ?? "200px" });

  const ref = (el: El): void => {
    if (!el) return;
    sentinel.ref(el);
    // The observer doesn't exist in tests: we expose `load` and attach a
    // synthetic listener that tests (or a button) can trigger.
    const onReach = (): void => load();
    el.addEventListener("raptor:reach", onReach);
    onCleanup(() => el.removeEventListener("raptor:reach", onReach));
  };

  return { ref, loading: () => loading(), load };
}
