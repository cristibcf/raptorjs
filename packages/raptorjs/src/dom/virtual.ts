/**
 * `VirtualFor` - a windowed keyed list. A plain `For` materializes every row, so
 * 10,000 rows mean 10,000 live nodes; `VirtualFor` renders only the rows inside
 * the scroll viewport (plus an overscan margin) and positions them absolutely
 * against a full-height sizer, so the DOM holds a constant handful of nodes no
 * matter how long the list is.
 *
 * Rows are keyed by index + item identity: scrolling reuses the nodes already
 * mounted, and a row rebuilds only when the item at its index actually changes.
 * It owns its scroll container; `rowHeight` and `height` are fixed pixel sizes
 * (fixed-height rows are what make the geometry exact without measuring).
 */
import { state, effect, createRoot, onCleanup, type Accessor } from "@raptorstack/raptorjs";
import { createElement, mountChild, disposeDetached, block, type Block, type Child } from "./runtime.ts";

export interface VirtualForProps<T> {
  each: Accessor<readonly T[]>;
  /** Fixed row height in pixels. */
  rowHeight: number;
  /** Height of the scroll viewport in pixels. */
  height: number;
  /** Rows rendered beyond each edge of the viewport, to cover fast scrolls. Default 4. */
  overscan?: number;
  children: (item: T, index: number) => Child;
}

interface Row {
  node: El;
  dispose: () => void;
  /** The item this row was built from; a change at the same index rebuilds it. */
  item: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

/** Reduces a row Child to a single positionable element (wrapping text/blocks). */
function asRow(child: Child): El {
  if (child != null && typeof child === "object" && typeof (child as El).nodeType === "number") {
    return child;
  }
  const wrapper = createElement("div");
  mountChild(wrapper, child, null);
  return wrapper;
}

/** Keyed, windowed list over a fixed-height scroll viewport. */
export function VirtualFor<T>(props: VirtualForProps<T>): Block {
  const overscan = props.overscan ?? 4;

  return block((parent, anchor) => {
    const viewport = createElement("div");
    viewport.style.position = "relative";
    viewport.style.overflow = "auto";
    viewport.style.height = props.height + "px";

    // The sizer reserves the full scroll height so the scrollbar is correct even
    // though only the visible rows exist; rows are positioned inside it.
    const sizer = createElement("div");
    sizer.style.position = "relative";
    sizer.style.width = "100%";
    viewport.appendChild(sizer);

    const scrollTop = state(0);
    viewport.addEventListener("scroll", () => scrollTop.set(Number(viewport.scrollTop) || 0));

    const rows = new Map<number, Row>();

    const drop = (index: number, row: Row): void => {
      disposeDetached(row.node, row.dispose);
      rows.delete(index);
    };

    effect(() => {
      const items = props.each();
      const rowHeight = props.rowHeight;
      sizer.style.height = items.length * rowHeight + "px";

      const top = scrollTop();
      const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const last = Math.min(items.length, Math.ceil((top + props.height) / rowHeight) + overscan);

      // Drop rows that scrolled out of the window.
      for (const [index, row] of rows) {
        if (index < first || index >= last) drop(index, row);
      }

      // Create (or rebuild) the rows inside the window.
      for (let index = first; index < last; index++) {
        const existing = rows.get(index);
        if (existing && existing.item === items[index]) continue; // reuse unchanged
        if (existing) drop(index, existing); // same slot, different item -> rebuild

        let node!: El;
        let dispose!: () => void;
        createRoot((d) => {
          node = asRow(props.children(items[index]!, index));
          dispose = d;
        });
        node.style.position = "absolute";
        node.style.top = index * rowHeight + "px";
        node.style.left = "0";
        node.style.right = "0";
        sizer.appendChild(node);
        rows.set(index, { node, dispose, item: items[index] });
      }
    });

    // Rows live in detached `createRoot` scopes, so they are not torn down by the
    // owning effect; dispose them when the whole list is unmounted.
    onCleanup(() => {
      for (const [index, row] of rows) drop(index, row);
    });

    if (anchor) parent.insertBefore(viewport, anchor);
    else parent.appendChild(viewport);
  });
}
