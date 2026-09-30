/**
 * virtualizer - a window over a very long list.
 *
 * A thesis component. With 50,000 rows, `indices()` returns ~20 numbers; on
 * scroll, keyed `For` reuses the nodes of the indices that stay in the window
 * and only creates for the ones that entered. A one-row scroll => a single new row.
 *
 * **Why indices and not `{index, start, size}` objects:** `For` is keyed on
 * value identity. A new object on each recompute would be a new key, so the
 * whole window would rebuild on every scroll pixel - the exact opposite of the
 * goal. Numbers are primitives: index 5 is always the same key. The offset and
 * size come from `itemStyle(i)` / `offsetOf(i)`.
 *
 * The metrics (viewport height, scrollTop) are read from the element when it
 * exists, but can also be pushed from outside (`setViewport`, `setScroll`) - so
 * the primitive is testable without real layout and usable at SSR.
 */
import { state, derived, onCleanup, type Accessor } from "raptorjs";
import { type El } from "./env.ts";

export interface VirtualizerOptions {
  /** The total number of items. */
  count: Accessor<number>;
  /** The height (or width) of one item in px. */
  itemSize: number;
  /** Extra items rendered at each end. Defaults to 3. */
  overscan?: number;
  /** The viewport size in px, if you don't want it read from the element. */
  viewportSize?: number;
  horizontal?: boolean;
}

export interface Virtualizer {
  /** `ref` for the container that scrolls. */
  ref: (el: El) => void;
  /** The indices that must be rendered now. Stable keys for `For`. */
  indices: Accessor<number[]>;
  /** The total content size, for the scroll spacer. */
  totalSize: Accessor<number>;
  /** Style for the spacer that gives the correct scrollbar. */
  spacerStyle: Accessor<string>;
  /** Absolute style for the item at the given index. */
  itemStyle: (index: number) => string;
  /** The offset in px of an index. */
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
      // No viewport measured yet: we render only the overscan, not the whole list.
      const visible = view > 0 ? Math.ceil(view / itemSize) : overscan;
      const first = Math.max(0, Math.floor(scroll() / itemSize) - overscan);
      const last = Math.min(total, first + visible + overscan * 2);
      return { start: first, end: last };
    },
    // The window changes only when the ends change: a 3px scroll within the
    // same row invalidates nothing further.
    // On the first run the previous value is `undefined` (see reactive.ts:216),
    // so the comparator must support that.
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

    // ResizeObserver if it exists; otherwise the viewport stays the measured/given one.
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
