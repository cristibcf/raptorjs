/**
 * Progress - a determinate or indeterminate progress bar.
 *
 * The simplest thesis component, and therefore the clearest: a value that
 * climbs from 0 to 100 in 100 steps writes **two attributes** on each step (the
 * fill width and `aria-valuenow`) and touches no node. In a Virtual DOM
 * framework those same 100 steps mean 100 re-renders and 100 reconciliations of
 * the subtree.
 */
import { derived, type Accessor } from "@raptorstack/raptorjs";
import { R, Show, type Child } from "@raptorstack/raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface ProgressProps {
  /** The current value. Omitted (or `indeterminate`) => indeterminate bar. */
  value?: Accessor<number>;
  min?: number;
  max?: number;
  indeterminate?: boolean;
  /** Label for the screen reader. */
  label?: string;
  /** Text shown next to the bar; `true` shows the percentage. */
  caption?: Child | true;
  class?: string;
}

export function Progress(props: ProgressProps): El {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const span = max - min || 1;
  const indeterminate = props.indeterminate === true || props.value === undefined;

  /** Percent 0..100, capped. A single `derived` feeds everything. */
  const percent = derived(() => {
    if (indeterminate) return 0;
    const raw = (props.value!() - min) / span;
    return Math.min(100, Math.max(0, raw * 100));
  });

  return R.div(
    {
      class: props.class ? "rui-progress " + props.class : "rui-progress",
      role: "progressbar",
      "aria-valuemin": String(min),
      "aria-valuemax": String(max),
      ...(props.label ? { "aria-label": props.label } : {}),
      // Indeterminate: no `aria-valuenow`, as the ARIA spec requires.
      ...(indeterminate
        ? { "data-indeterminate": "true" }
        : { "aria-valuenow": () => String(Math.round(props.value!())) }),
    },
    R.div(
      { class: "rui-progress-track" },
      R.div({
        class: indeterminate ? "rui-progress-fill rui-indeterminate" : "rui-progress-fill",
        // The only thing that changes on each step.
        ...(indeterminate ? {} : { style: () => "width:" + percent().toFixed(2) + "%" }),
      }),
    ),
    Show({
      when: () => props.caption !== undefined,
      children: R.span(
        { class: "rui-progress-caption" },
        props.caption === true ? () => Math.round(percent()) + "%" : (props.caption as Child),
      ),
    }),
  );
}

/**
 * CircularProgress - the same logic, rendered as an SVG ring.
 * `stroke-dashoffset` is the only attribute that moves.
 */
export interface CircularProgressProps extends ProgressProps {
  size?: number;
  thickness?: number;
}

export function CircularProgress(props: CircularProgressProps): El {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const span = max - min || 1;
  const size = props.size ?? 40;
  const thickness = props.thickness ?? 4;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = props.indeterminate === true || props.value === undefined;

  const fraction = derived(() => {
    if (indeterminate) return 0.25;
    const raw = (props.value!() - min) / span;
    return Math.min(1, Math.max(0, raw));
  });

  return R.svg(
    {
      class: indeterminate ? "rui-circular rui-indeterminate" : "rui-circular",
      width: String(size),
      height: String(size),
      viewBox: `0 0 ${size} ${size}`,
      role: "progressbar",
      "aria-valuemin": String(min),
      "aria-valuemax": String(max),
      ...(props.label ? { "aria-label": props.label } : {}),
      ...(indeterminate ? {} : { "aria-valuenow": () => String(Math.round(props.value!())) }),
    },
    R.circle({
      class: "rui-circular-track",
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(radius),
      fill: "none",
      "stroke-width": String(thickness),
    }),
    R.circle({
      class: "rui-circular-fill",
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(radius),
      fill: "none",
      "stroke-width": String(thickness),
      "stroke-dasharray": String(circumference),
      "stroke-linecap": "round",
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      "stroke-dashoffset": () => (circumference * (1 - fraction())).toFixed(2),
    }),
  );
}
