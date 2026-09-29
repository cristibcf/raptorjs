/**
 * Slider / RangeSlider - selectare de valoare prin tragere.
 *
 * Componenta-teza. Tragerea manerului produce `pointermove` la 60-120Hz; aici
 * fiecare eveniment scrie **doua atribute** (pozitia manerului si `aria-valuenow`)
 * si nu atinge niciun nod. Testul trage 60 de evenimente si verifica
 * `stats.createElement === 0`.
 *
 * Geometria pistei se citeste din `getBoundingClientRect`; acolo unde nu exista
 * (mini-dom, SSR) `setTrack()` o poate impinge din afara, deci logica de
 * cuantizare si plafonare e testabila fara layout real.
 */
import { state, onCleanup, type Accessor, type State } from "raptorjs";
import { R } from "raptorjs/dom";
import { onDoc, pointOf, type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SliderProps {
  /** Semnalul detinut de tine. Slider-ul doar il scrie. */
  value: State<number>;
  min?: number;
  max?: number;
  /** Cuantizare. Implicit 1. `0` inseamna continuu. */
  step?: number;
  vertical?: boolean;
  disabled?: () => boolean;
  /** Text citit de screen reader in locul numarului (ex. "12 lei"). */
  valueText?: (value: number) => string;
  label?: string;
  onChange?: (value: number) => void;
  /** La final de drag (util pentru salvare/commit). */
  onCommit?: (value: number) => void;
  class?: string;
}

interface Track {
  start: number;
  size: number;
}

/** Geometria pistei; fallback {0,1} ca sa nu impartim la zero fara layout. */
function trackOf(el: El, vertical: boolean): Track {
  if (el && typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    if (r) {
      const start = vertical ? Number(r.y ?? r.top ?? 0) : Number(r.x ?? r.left ?? 0);
      const size = vertical ? Number(r.height ?? 0) : Number(r.width ?? 0);
      if (size > 0) return { start, size };
    }
  }
  return { start: 0, size: 0 };
}

interface Axis {
  min: number;
  max: number;
  step: number;
  vertical: boolean;
}

function quantize(raw: number, axis: Axis): number {
  const { min, max, step } = axis;
  const stepped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
  const clamped = Math.min(max, Math.max(min, stepped));
  // Evitam 0.30000000000000004 la pasi fractionari.
  return step > 0 && !Number.isInteger(step) ? Number(clamped.toFixed(10)) : clamped;
}

function fractionOf(value: number, axis: Axis): number {
  const span = axis.max - axis.min || 1;
  return Math.min(1, Math.max(0, (value - axis.min) / span));
}

/** Un maner: pointer + tastatura + ARIA. Refolosit de Slider si RangeSlider. */
function thumb(
  axis: Axis,
  read: Accessor<number>,
  write: (value: number) => void,
  commit: () => void,
  track: () => Track,
  opts: { label?: string; valueText?: (v: number) => string; disabled?: () => boolean },
): El {
  const dragging = state(false);

  const fromPointer = (e: any): void => {
    const t = track();
    if (t.size <= 0) return;
    const p = pointOf(e);
    const raw = axis.vertical
      ? 1 - (p.y - t.start) / t.size // vertical: sus = max
      : (p.x - t.start) / t.size;
    write(quantize(axis.min + raw * (axis.max - axis.min), axis));
  };

  const onKey = (e: any): void => {
    if (opts.disabled?.()) return;
    const stepSize = axis.step > 0 ? axis.step : (axis.max - axis.min) / 100;
    const big = (axis.max - axis.min) / 10;
    const current = read();
    let next: number | null = null;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + stepSize;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current - stepSize;
        break;
      case "PageUp":
        next = current + big;
        break;
      case "PageDown":
        next = current - big;
        break;
      case "Home":
        next = axis.min;
        break;
      case "End":
        next = axis.max;
        break;
    }
    if (next === null) return;
    e.preventDefault?.();
    write(quantize(next, axis));
    commit();
  };

  const onPointerDown = (e: any): void => {
    if (opts.disabled?.()) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault?.();
    dragging.set(true);
    fromPointer(e);

    const unMove = onDoc("pointermove", fromPointer);
    const unUp = onDoc("pointerup", (up: any) => {
      fromPointer(up);
      dragging.set(false);
      unMove();
      unUp();
      commit();
    });
    onCleanup(() => {
      unMove();
      unUp();
    });
  };

  return R.div({
    class: () => (dragging() ? "rui-slider-thumb rui-dragging" : "rui-slider-thumb"),
    role: "slider",
    tabindex: () => (opts.disabled?.() ? "-1" : "0"),
    "aria-valuemin": String(axis.min),
    "aria-valuemax": String(axis.max),
    "aria-valuenow": () => String(read()),
    "aria-orientation": axis.vertical ? "vertical" : "horizontal",
    ...(opts.label ? { "aria-label": opts.label } : {}),
    ...(opts.valueText ? { "aria-valuetext": () => opts.valueText!(read()) } : {}),
    "aria-disabled": () => (opts.disabled?.() ? "true" : "false"),
    // Singurul stil care se misca in timpul drag-ului.
    style: () =>
      (axis.vertical ? "bottom:" : "left:") + (fractionOf(read(), axis) * 100).toFixed(3) + "%",
    "on:pointerdown": onPointerDown,
    "on:keydown": onKey,
  });
}

export function Slider(props: SliderProps): El {
  const axis: Axis = {
    min: props.min ?? 0,
    max: props.max ?? 100,
    step: props.step ?? 1,
    vertical: props.vertical ?? false,
  };
  let trackEl: El = null;
  let override: Track | null = null;
  const track = (): Track => override ?? trackOf(trackEl, axis.vertical);

  const write = (next: number): void => {
    if (props.disabled?.()) return;
    if (next === props.value.peek()) return;
    props.value.set(next);
    props.onChange?.(next);
  };

  const el = R.div(
    {
      class: () =>
        "rui-slider" +
        (axis.vertical ? " rui-vertical" : "") +
        (props.disabled?.() ? " rui-disabled" : "") +
        (props.class ? " " + props.class : ""),
      ref: (node: El) => {
        trackEl = node;
      },
    },
    R.div({ class: "rui-slider-track" }, R.div({
      class: "rui-slider-range",
      style: () =>
        (axis.vertical ? "height:" : "width:") + (fractionOf(props.value(), axis) * 100).toFixed(3) + "%",
    })),
    thumb(axis, () => props.value(), write, () => props.onCommit?.(props.value.peek()), track, {
      label: props.label,
      valueText: props.valueText,
      disabled: props.disabled,
    }),
  );

  // Punte de test/SSR: impinge geometria pistei fara layout real.
  (el as any).setTrack = (start: number, size: number): void => {
    override = { start, size };
  };
  return el;
}

export interface RangeSliderProps extends Omit<SliderProps, "value"> {
  /** `[jos, sus]`. Manerele nu se pot depasi. */
  value: State<readonly [number, number]>;
}

export function RangeSlider(props: RangeSliderProps): El {
  const axis: Axis = {
    min: props.min ?? 0,
    max: props.max ?? 100,
    step: props.step ?? 1,
    vertical: props.vertical ?? false,
  };
  let trackEl: El = null;
  let override: Track | null = null;
  const track = (): Track => override ?? trackOf(trackEl, axis.vertical);

  const commit = (): void => props.onCommit?.(props.value.peek()[0]);

  const writeAt = (index: 0 | 1) => (next: number): void => {
    if (props.disabled?.()) return;
    const [lo, hi] = props.value.peek();
    // Manerele nu trec unul peste altul: se opresc la vecin.
    const bounded = index === 0 ? Math.min(next, hi) : Math.max(next, lo);
    const pair: readonly [number, number] = index === 0 ? [bounded, hi] : [lo, bounded];
    if (pair[0] === lo && pair[1] === hi) return;
    props.value.set(pair);
    props.onChange?.(bounded);
  };

  const el = R.div(
    {
      class: () =>
        "rui-slider rui-range" +
        (axis.vertical ? " rui-vertical" : "") +
        (props.disabled?.() ? " rui-disabled" : "") +
        (props.class ? " " + props.class : ""),
      ref: (node: El) => {
        trackEl = node;
      },
    },
    R.div({ class: "rui-slider-track" }, R.div({
      class: "rui-slider-range",
      style: () => {
        const [lo, hi] = props.value();
        const a = fractionOf(lo, axis) * 100;
        const b = fractionOf(hi, axis) * 100;
        return axis.vertical
          ? `bottom:${a.toFixed(3)}%;height:${(b - a).toFixed(3)}%`
          : `left:${a.toFixed(3)}%;width:${(b - a).toFixed(3)}%`;
      },
    })),
    thumb(axis, () => props.value()[0], writeAt(0), commit, track, {
      label: props.label ? props.label + " (minim)" : "minim",
      valueText: props.valueText,
      disabled: props.disabled,
    }),
    thumb(axis, () => props.value()[1], writeAt(1), commit, track, {
      label: props.label ? props.label + " (maxim)" : "maxim",
      valueText: props.valueText,
      disabled: props.disabled,
    }),
  );

  (el as any).setTrack = (start: number, size: number): void => {
    override = { start, size };
  };
  return el;
}
