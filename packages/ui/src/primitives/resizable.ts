/**
 * resizable - redimensionare prin drag pe un maner.
 *
 * Componenta-teza a bibliotecii. Un split-pane tras cu mouse-ul produce
 * `pointermove` la 60-120Hz. Intr-un framework cu Virtual DOM fiecare eveniment
 * declanseaza un re-render si o reconciliere; aici `size` e un semnal si tot ce
 * se intampla pe frame e **o singura scriere de atribut de stil**. Testul din
 * `tests/primitives.test.ts` verifica exact asta: dupa un drag complet,
 * `stats.createElement === 0`.
 *
 * Marimea e tinuta in `size` (semnal) - poti sa o citesti, sa o setezi
 * programatic sau sa o persisti, fara sa intrebi DOM-ul.
 */
import { state, onCleanup, type Accessor } from "@raptor/core";
import { onDoc, pointOf, type El } from "./env.ts";

export interface ResizableOptions {
  /** Axa pe care se redimensioneaza. Implicit `x`. */
  axis?: "x" | "y";
  /** Marimea initiala in px. */
  initial?: number;
  min?: number;
  max?: number;
  /** Cuantizare (ex. 8 => se opreste din 8 in 8 px). */
  step?: number;
  /** Inverseaza directia (maner pe stanga/sus). */
  invert?: boolean;
  onResize?: (size: number) => void;
  onEnd?: (size: number) => void;
}

export interface Resizable {
  /** `ref` pentru manerul care se trage. */
  handle: (el: El) => void;
  size: Accessor<number>;
  setSize: (value: number) => void;
  resizing: Accessor<boolean>;
  /** Stil gata de pus pe panoul redimensionat. */
  style: Accessor<string>;
  /** Pas de tastatura, pentru accesibilitate (sageti pe maner). */
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

    // ARIA: un maner de resize e un separator cu valoare.
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
