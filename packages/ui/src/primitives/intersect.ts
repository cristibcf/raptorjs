/**
 * intersects / infiniteScroll - vizibilitate ca semnal.
 *
 * `IntersectionObserver` nu exista in Node si nici pe mini-dom. Ambele
 * primitive expun de aceea un `trigger()` manual: in browser il apeleaza
 * observatorul, in teste il apelezi tu. Asa logica de incarcare e testabila
 * fara layout real.
 */
import { state, onCleanup, type Accessor } from "@raptor/core";
import { type El } from "./env.ts";

export interface IntersectOptions {
  /** Cat din element trebuie vazut (0..1). Implicit 0. */
  threshold?: number;
  /** Margine in jurul rootului, sintaxa CSS. */
  rootMargin?: string;
  /** Dupa prima intrare in viewport, nu mai observa. Implicit `false`. */
  once?: boolean;
}

export interface Intersect {
  ref: (el: El) => void;
  visible: Accessor<boolean>;
  /** Marcheaza manual vizibilitatea (teste, SSR, control din afara). */
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
  /** Se apeleaza cand santinela devine vizibila si nu e deja o incarcare in curs. */
  onLoad: () => void | Promise<void>;
  /** Cat timp intoarce `false`, nu se mai incarca (s-a terminat lista). */
  hasMore?: () => boolean;
  rootMargin?: string;
}

export interface InfiniteScroll {
  /** `ref` pentru santinela pusa la finalul listei. */
  ref: (el: El) => void;
  loading: Accessor<boolean>;
  /** Declanseaza manual o incarcare (teste, buton "load more"). */
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
    // Observatorul nu exista in teste: expunem `load` si atasam un listener
    // sintetic pe care testele (sau un buton) il pot declansa.
    const onReach = (): void => load();
    el.addEventListener("raptor:reach", onReach);
    onCleanup(() => el.removeEventListener("raptor:reach", onReach));
  };

  return { ref, loading: () => loading(), load };
}
