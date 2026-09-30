/**
 * Slider / RangeSlider - value selection by dragging.
 *
 * A thesis component. Dragging the thumb produces `pointermove` at 60-120Hz;
 * here each event writes **two attributes** (the thumb position and
 * `aria-valuenow`) and touches no node. The test drags 60 events and checks
 * `stats.createElement === 0`.
 *
 * The track geometry is read from `getBoundingClientRect`; where it doesn't
 * exist (mini-dom, SSR) `setTrack()` can push it from outside, so the
 * quantization and clamping logic is testable without real layout.
 */
import { state, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R } from "@raptorstack/raptorjs/dom";
import { onDoc, pointOf, type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SliderProps {
  /** The signal you own. The slider just writes it. */
  value: State<number>;
  min?: number;
  max?: number;
  /** Quantization. Defaults to 1. `0` means continuous. */
  step?: number;
  vertical?: boolean;
  disabled?: () => boolean;
  /** Text read by the screen reader instead of the number (e.g. "12 lei"). */
  valueText?: (value: number) => string;
  label?: string;
  onChange?: (value: number) => void;
  /** At the end of a drag (useful for save/commit). */
  onCommit?: (value: number) => void;
  class?: string;
}

interface Track {
  start: number;
  size: number;
}

/** The track geometry; fallback {0,1} so we don't divide by zero without layout. */
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
  // We avoid 0.30000000000000004 for fractional steps.
  return step > 0 && !Number.isInteger(step) ? Number(clamped.toFixed(10)) : clamped;
}

function fractionOf(value: number, axis: Axis): number {
  const span = axis.max - axis.min || 1;
  return Math.min(1, Math.max(0, (value - axis.min) / span));
}

/** One thumb: pointer + keyboard + ARIA. Reused by Slider and RangeSlider. */
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
      ? 1 - (p.y - t.start) / t.size // vertical: top = max
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
    // The only style that moves during the drag.
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

  // Test/SSR bridge: push the track geometry without real layout.
  (el as any).setTrack = (start: number, size: number): void => {
    override = { start, size };
  };
  return el;
}

export interface RangeSliderProps extends Omit<SliderProps, "value"> {
  /** `[low, high]`. The thumbs can't cross each other. */
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
    // The thumbs don't cross each other: they stop at the neighbor.
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
      label: props.label ? props.label + " (minimum)" : "minimum",
      valueText: props.valueText,
      disabled: props.disabled,
    }),
    thumb(axis, () => props.value()[1], writeAt(1), commit, track, {
      label: props.label ? props.label + " (maximum)" : "maximum",
      valueText: props.valueText,
      disabled: props.disabled,
    }),
  );

  (el as any).setTrack = (start: number, size: number): void => {
    override = { start, size };
  };
  return el;
}
