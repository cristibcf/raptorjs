/**
 * draggable / droppable / sortable - drag with pointer events.
 *
 * We use pointer events, not HTML5 drag-and-drop: that one doesn't work on
 * touch, can't be styled and doesn't give useful positions during the move.
 * `pointermove` and `pointerup` are listened for on the **document**, not on the
 * element - otherwise you lose the drag the moment the cursor leaves it.
 *
 * Movement is where fine-grained shows: at 120Hz, a drag writes a single style
 * attribute per frame, with no reconciliation.
 */
import { state, onCleanup, type Accessor, type State } from "raptorjs";
import { onDoc, pointOf, type El } from "./env.ts";

export interface DragEvent {
  /** Offset from the start point. */
  dx: number;
  dy: number;
  /** The pointer's current position. */
  x: number;
  y: number;
  event: any;
}

export interface DraggableOptions {
  axis?: "x" | "y" | "both";
  /** Threshold in pixels below which we don't consider the drag started. Defaults to 0. */
  threshold?: number;
  onStart?: (e: DragEvent) => void;
  onMove?: (e: DragEvent) => void;
  onEnd?: (e: DragEvent) => void;
  enabled?: () => boolean;
}

export interface Draggable {
  ref: (el: El) => void;
  dragging: Accessor<boolean>;
  delta: Accessor<{ dx: number; dy: number }>;
}

const ZERO = { dx: 0, dy: 0 };

export function draggable(options?: DraggableOptions): Draggable {
  const dragging = state(false);
  const delta = state<{ dx: number; dy: number }>(ZERO);
  const axis = options?.axis ?? "both";
  const threshold = options?.threshold ?? 0;

  const project = (dx: number, dy: number): { dx: number; dy: number } => ({
    dx: axis === "y" ? 0 : dx,
    dy: axis === "x" ? 0 : dy,
  });

  const ref = (el: El): void => {
    if (!el) return;
    let origin: { x: number; y: number } | null = null;
    let started = false;
    let unbindMove: (() => void) | null = null;
    let unbindUp: (() => void) | null = null;

    const stopTracking = (): void => {
      unbindMove?.();
      unbindUp?.();
      unbindMove = null;
      unbindUp = null;
    };

    const onPointerMove = (e: any): void => {
      if (!origin) return;
      const p = pointOf(e);
      const raw = project(p.x - origin.x, p.y - origin.y);

      if (!started) {
        if (Math.abs(raw.dx) < threshold && Math.abs(raw.dy) < threshold) return;
        started = true;
        dragging.set(true);
        options?.onStart?.({ ...raw, ...p, event: e });
      }
      delta.set(raw);
      options?.onMove?.({ ...raw, ...p, event: e });
    };

    const onPointerUp = (e: any): void => {
      if (!origin) return;
      const p = pointOf(e);
      const raw = project(p.x - origin.x, p.y - origin.y);
      origin = null;
      stopTracking();
      if (started) {
        started = false;
        dragging.set(false);
        options?.onEnd?.({ ...raw, ...p, event: e });
      }
      delta.set(ZERO);
    };

    const onPointerDown = (e: any): void => {
      if (options?.enabled && !options.enabled()) return;
      if (e.button != null && e.button !== 0) return;
      origin = pointOf(e);
      started = threshold === 0;
      if (started) {
        dragging.set(true);
        delta.set(ZERO);
        options?.onStart?.({ ...ZERO, ...origin, event: e });
      }
      // We capture the pointer so we get move/up even if it leaves the element.
      if (typeof el.setPointerCapture === "function" && e.pointerId != null) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture optional */
        }
      }
      unbindMove = onDoc("pointermove", onPointerMove);
      unbindUp = onDoc("pointerup", onPointerUp);
    };

    el.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      el.removeEventListener("pointerdown", onPointerDown);
      stopTracking();
    });
  };

  return { ref, dragging: () => dragging(), delta: () => delta() };
}

/* ------------------------------------------------------------------ drop --- */

export interface DroppableOptions<T = unknown> {
  onDrop: (payload: T, event: any) => void;
  /** Filters what is accepted; what doesn't pass doesn't mark the zone active. */
  accepts?: (payload: T) => boolean;
  onEnter?: (payload: T) => void;
  onLeave?: () => void;
}

export interface Droppable {
  ref: (el: El) => void;
  over: Accessor<boolean>;
}

/**
 * Transfer channel between draggable and droppable. HTML5 dataTransfer doesn't
 * exist with pointer events, so the payload passes through a shared signal.
 */
export function dragPayload<T>(): State<T | null> {
  return state<T | null>(null);
}

export function droppable<T>(payload: Accessor<T | null>, options: DroppableOptions<T>): Droppable {
  const over = state(false);

  const ref = (el: El): void => {
    if (!el) return;

    const current = (): T | null => {
      const value = payload();
      if (value == null) return null;
      if (options.accepts && !options.accepts(value)) return null;
      return value;
    };

    const onEnter = (): void => {
      const value = current();
      if (value == null) return;
      over.set(true);
      options.onEnter?.(value);
    };
    const onLeave = (): void => {
      if (!over.peek()) return;
      over.set(false);
      options.onLeave?.();
    };
    const onUp = (e: any): void => {
      const value = current();
      over.set(false);
      if (value == null) return;
      options.onDrop(value, e);
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerup", onUp);
    onCleanup(() => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerup", onUp);
    });
  };

  return { ref, over: () => over() };
}

/* ------------------------------------------------------------------ sort --- */

export interface SortableOptions<T> {
  items: State<readonly T[]>;
  onReorder?: (items: readonly T[], from: number, to: number) => void;
}

export interface Sortable {
  /** `ref` for the row at the given index. */
  item: (index: number) => (el: El) => void;
  dragging: Accessor<number>;
  over: Accessor<number>;
  /** Programmatic move (keyboard, up/down buttons). */
  move: (from: number, to: number) => void;
}

/**
 * Reordering by drag. It only moves indices in the items signal - the nodes are
 * rearranged by keyed `For`, which reuses all of them.
 */
export function sortable<T>(options: SortableOptions<T>): Sortable {
  const dragging = state(-1);
  const over = state(-1);

  const move = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0) return;
    options.items.update((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = prev.slice();
      const moved = next.splice(from, 1)[0];
      if (moved === undefined) return prev;
      next.splice(to, 0, moved);
      options.onReorder?.(next, from, to);
      return next;
    });
  };

  const item = (index: number) => (el: El): void => {
    if (!el) return;

    const onDown = (): void => dragging.set(index);
    const onEnter = (): void => {
      if (dragging.peek() >= 0) over.set(index);
    };
    const onUp = (): void => {
      const from = dragging.peek();
      const to = over.peek();
      dragging.set(-1);
      over.set(-1);
      if (from >= 0 && to >= 0) move(from, to);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerup", onUp);
    onCleanup(() => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerup", onUp);
    });
  };

  return { item, dragging: () => dragging(), over: () => over(), move };
}
