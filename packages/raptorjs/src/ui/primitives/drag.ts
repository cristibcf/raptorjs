/**
 * draggable / droppable / sortable - drag cu pointer events.
 *
 * Folosim pointer events, nu HTML5 drag-and-drop: acela nu merge pe touch, nu
 * se poate stiliza si nu da pozitii utile in timpul miscarii. `pointermove` si
 * `pointerup` se asculta pe **document**, nu pe element - altfel pierzi drag-ul
 * in momentul in care cursorul iese de pe el.
 *
 * Miscarea e locul in care fine-grained se vede: la 120Hz, un drag scrie un
 * singur atribut de stil pe frame, fara reconciliere.
 */
import { state, onCleanup, type Accessor, type State } from "raptorjs";
import { onDoc, pointOf, type El } from "./env.ts";

export interface DragEvent {
  /** Deplasare fata de punctul de start. */
  dx: number;
  dy: number;
  /** Pozitia curenta a pointerului. */
  x: number;
  y: number;
  event: any;
}

export interface DraggableOptions {
  axis?: "x" | "y" | "both";
  /** Prag in pixeli sub care nu consideram ca a inceput drag-ul. Implicit 0. */
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
      // Capturam pointerul ca sa primim move/up chiar daca iese de pe element.
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
  /** Filtreaza ce se accepta; ce nu trece nu marcheaza zona ca activa. */
  accepts?: (payload: T) => boolean;
  onEnter?: (payload: T) => void;
  onLeave?: () => void;
}

export interface Droppable {
  ref: (el: El) => void;
  over: Accessor<boolean>;
}

/**
 * Canal de transfer intre draggable si droppable. HTML5 dataTransfer nu exista
 * la pointer events, deci payload-ul trece printr-un semnal partajat.
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
  /** `ref` pentru randul de la indexul dat. */
  item: (index: number) => (el: El) => void;
  dragging: Accessor<number>;
  over: Accessor<number>;
  /** Mutare programatica (tastatura, butoane sus/jos). */
  move: (from: number, to: number) => void;
}

/**
 * Reordonare prin drag. Muta doar indici in semnalul de items - nodurile sunt
 * reasezate de `For` keyed, care le reutilizeaza pe toate.
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
