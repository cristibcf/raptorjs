/**
 * resizable - resizing by dragging a handle.
 *
 * A thesis component of the library. A split-pane dragged with the mouse
 * produces `pointermove` at 60-120Hz. In a Virtual DOM framework each event
 * triggers a re-render and a reconciliation; here `size` is a signal and all
 * that happens per frame is **a single style attribute write**. The test in
 * `tests/primitives.test.ts` checks exactly that: after a full drag,
 * `stats.createElement === 0`.
 *
 * The size is held in `size` (a signal) - you can read it, set it
 * programmatically or persist it, without asking the DOM.
 */
import { state, onCleanup, type Accessor } from "raptorjs";
import { onDoc, pointOf, type El } from "./env.ts";

export interface ResizableOptions {
  /** The axis it resizes on. Defaults to `x`. */
  axis?: "x" | "y";
  /** Initial size in px. */
  initial?: number;
  min?: number;
  max?: number;
  /** Quantization (e.g. 8 => it stops in 8px increments). */
  step?: number;
  /** Invert the direction (handle on the left/top). */
  invert?: boolean;
  onResize?: (size: number) => void;
  onEnd?: (size: number) => void;
}

export interface Resizable {
  /** `ref` for the handle that gets dragged. */
  handle: (el: El) => void;
  size: Accessor<number>;
  setSize: (value: number) => void;
  resizing: Accessor<boolean>;
  /** Style ready to put on the resized pane. */
  style: Accessor<string>;
  /** Keyboard step, for accessibility (arrows on the handle). */
  nudge: (delta: number) => void;
}

export function resizable(options?: ResizableOptions): Resizable {
  const axis = options?.axis ?? "x";
  const min = options?.min ?? 0;
  const max = options?.max ?? Number.POSITIVE_INFINITY;
  const step = options?.step ?? 0;
  const sign = options?.invert ? -1 : 1;

  const size = state(clamp(options?.initial ?? 0));
  const resizing = state(false);

  function clamp(value: number): number {
    const stepped = step > 0 ? Math.round(value / step) * step : value;
    return Math.min(max, Math.max(min, stepped));
  }

  const setSize = (value: number): void => {
    const next = clamp(value);
    if (next === size.peek()) return;
    size.set(next);
    options?.onResize?.(next);
  };

  const nudge = (delta: number): void => setSize(size.peek() + delta);

  const handle = (el: El): void => {
    if (!el) return;
    let startSize = 0;
    let origin: { x: number; y: number } | null = null;
    let unbindMove: (() => void) | null = null;
    let unbindUp: (() => void) | null = null;

    const stop = (): void => {
      unbindMove?.();
      unbindUp?.();
      unbindMove = null;
      unbindUp = null;
    };

    const onMove = (e: any): void => {
      if (!origin) return;
      const p = pointOf(e);
      const delta = axis === "x" ? p.x - origin.x : p.y - origin.y;
      setSize(startSize + sign * delta);
    };

    const onUp = (): void => {
      if (!origin) return;
      origin = null;
      stop();
      resizing.set(false);
      options?.onEnd?.(size.peek());
    };

    const onDown = (e: any): void => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault?.();
      origin = pointOf(e);
      startSize = size.peek();
      resizing.set(true);
      if (typeof el.setPointerCapture === "function" && e.pointerId != null) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture optional */
        }
      }
      unbindMove = onDoc("pointermove", onMove);
      unbindUp = onDoc("pointerup", onUp);
    };

    const onKey = (e: any): void => {
      const amount = step > 0 ? step : 8;
      const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
      const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
      if (e.key === back) {
        e.preventDefault?.();
        nudge(-sign * amount);
      } else if (e.key === fwd) {
        e.preventDefault?.();
        nudge(sign * amount);
      } else if (e.key === "Home" && Number.isFinite(min)) {
        e.preventDefault?.();
        setSize(min);
      } else if (e.key === "End" && Number.isFinite(max)) {
        e.preventDefault?.();
        setSize(max);
      }
    };

    // ARIA: a resize handle is a separator with a value.
    el.setAttribute?.("role", "separator");
    el.setAttribute?.("tabindex", "0");
    el.setAttribute?.("aria-orientation", axis === "x" ? "vertical" : "horizontal");

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("keydown", onKey);
    onCleanup(() => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("keydown", onKey);
      stop();
    });
  };

  const style: Accessor<string> = () =>
    (axis === "x" ? "width:" : "height:") + size() + "px";

  return {
    handle,
    size: () => size(),
    setSize,
    resizing: () => resizing(),
    style,
    nudge,
  };
}
