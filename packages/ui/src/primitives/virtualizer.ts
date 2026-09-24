/**
 * virtualizer - fereastra peste o lista foarte lunga.
 *
 * Componenta-teza. Cu 50.000 de randuri, `indices()` intoarce ~20 de numere;
 * la scroll, `For` keyed reutilizeaza nodurile indicilor care raman in fereastra
 * si creeaza doar pentru cei intrati. Un scroll de un rand => un singur rand nou.
 *
 * **De ce indici si nu obiecte `{index, start, size}`:** `For` e keyed pe
 * identitatea valorii. Un obiect nou la fiecare recalcul ar fi o cheie noua, deci
 * fereastra intreaga s-ar reconstrui la fiecare pixel de scroll - exact opusul
 * scopului. Numerele sunt primitive: indicele 5 e aceeasi cheie mereu. Offset-ul
 * si marimea se obtin din `itemStyle(i)` / `offsetOf(i)`.
 *
 * Metricile (inaltimea viewportului, scrollTop) sunt citite din element cand
 * exista, dar pot fi si impinse din afara (`setViewport`, `setScroll`) - asa
 * primitiva e testabila fara layout real si utilizabila la SSR.
 */
import { state, derived, onCleanup, type Accessor } from "@raptor/core";
import { type El } from "./env.ts";

export interface VirtualizerOptions {
  /** Numarul total de itemi. */
  count: Accessor<number>;
  /** Inaltimea (sau latimea) unui item in px. */
  itemSize: number;
  /** Itemi randati in plus la fiecare capat. Implicit 3. */
  overscan?: number;
  /** Marimea viewportului in px, daca nu vrei sa fie citita din element. */
  viewportSize?: number;
  horizontal?: boolean;
}

export interface Virtualizer {
  /** `ref` pentru containerul care deruleaza. */
  ref: (el: El) => void;
  /** Indicii care trebuie randati acum. Chei stabile pentru `For`. */
  indices: Accessor<number[]>;
  /** Marimea totala a continutului, pentru spacer-ul de scroll. */
  totalSize: Accessor<number>;
  /** Stil pentru spacer-ul care da bara de scroll corecta. */
  spacerStyle: Accessor<string>;
  /** Stil absolut pentru itemul de la indexul dat. */
  itemStyle: (index: number) => string;
  /** Offsetul in px al unui index. */
  offsetOf: (index: number) => number;
  scrollTo: (index: number) => void;
  setScroll: (offset: number) => void;
  setViewport: (size: number) => void;
  range: Accessor<{ start: number; end: number }>;
}

export function virtualizer(options: VirtualizerOptions): Virtualizer {
  const overscan = options.overscan ?? 3;
  const itemSize = options.itemSize;
  const horizontal = options.horizontal ?? false;

  const scroll = state(0);
  const viewport = state(options.viewportSize ?? 0);
  let element: El = null;

  const range = derived(
    () => {
      const total = options.count();
      const view = viewport();
      if (total <= 0 || itemSize <= 0) return { start: 0, end: 0 };
      // Fara viewport masurat inca: randam doar overscan-ul, nu toata lista.
      const visible = view > 0 ? Math.ceil(view / itemSize) : overscan;
      const first = Math.max(0, Math.floor(scroll() / itemSize) - overscan);
      const last = Math.min(total, first + visible + overscan * 2);
      return { start: first, end: last };
    },
    // Fereastra se schimba doar cand se schimba capetele: un scroll de 3px
    // in interiorul aceluiasi rand nu invalideaza nimic mai departe.
    // La prima rulare valoarea precedenta e `undefined` (vezi reactive.ts:216),
    // deci comparatorul trebuie sa suporte asta.
    { equal: (a, b) => a != null && b != null && a.start === b.start && a.end === b.end },
  );

  const indices = derived<number[]>(() => {
    const { start, end } = range();
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  });

  const totalSize = derived(() => options.count() * itemSize);

  const ref = (el: El): void => {
    if (!el) return;
    element = el;

    const measure = (): void => {
      const size = horizontal ? el.clientWidth : el.clientHeight;
      if (typeof size === "number" && size > 0) viewport.set(size);
    };
    const onScroll = (): void => {
      const offset = horizontal ? el.scrollLeft : el.scrollTop;
      scroll.set(typeof offset === "number" ? offset : 0);
    };

    measure();
    el.addEventListener("scroll", onScroll);

    // ResizeObserver daca exista; altfel viewportul ramane cel masurat/dat.
    const RO = (globalThis as any).ResizeObserver;
    let observer: any = null;
    if (typeof RO === "function") {
      observer = new RO(measure);
      observer.observe(el);
    }

    onCleanup(() => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect?.();
      element = null;
    });
  };

  const offsetOf = (index: number): number => index * itemSize;

  const scrollTo = (index: number): void => {
    const offset = offsetOf(index);
    scroll.set(offset);
    if (element) {
      if (horizontal) element.scrollLeft = offset;
      else element.scrollTop = offset;
    }
  };

  const spacerStyle: Accessor<string> = () =>
    (horizontal ? "width:" : "height:") + totalSize() + "px;position:relative";

  const itemStyle = (index: number): string =>
    horizontal
      ? `position:absolute;left:${offsetOf(index)}px;width:${itemSize}px;top:0;bottom:0`
      : `position:absolute;top:${offsetOf(index)}px;height:${itemSize}px;left:0;right:0`;

  return {
    ref,
    indices: () => indices(),
    totalSize: () => totalSize(),
    spacerStyle,
    itemStyle,
    offsetOf,
    scrollTo,
    setScroll: (offset: number) => scroll.set(offset),
    setViewport: (size: number) => viewport.set(size),
    range: () => range(),
  };
}
