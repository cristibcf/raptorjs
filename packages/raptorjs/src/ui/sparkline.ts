/**
 * Sparkline - a tiny, inline chart with no axes.
 *
 * The flagship component for live data. A stream sending one value per second
 * rewrites **a single attribute** (the path's `d`) and touches no nodes. In a
 * framework with a Virtual DOM, the same stream would re-create the SVG tree on
 * every tick and reconcile it point by point.
 *
 * It needs the SVG support from `@raptor/dom` (`createElementNS`) - without it,
 * `document.createElement("svg")` produces an HTML element that doesn't render.
 */
import { derived, type Accessor } from "raptorjs";
import { R, Show } from "raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface SparklineProps {
  data: Accessor<readonly number[]>;
  width?: number;
  height?: number;
  /** Line thickness. Default 1.5. */
  thickness?: number;
  /** Fill the area below the line. Default `false`. */
  area?: boolean;
  /** Mark the last point with a circle. Default `false`. */
  lastPoint?: boolean;
  /** Fix the vertical scale; otherwise min/max are taken from the data. */
  min?: number;
  max?: number;
  /** Label for the screen reader (the chart itself is `aria-hidden`). */
  label?: string;
  class?: string;
}

interface Geometry {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  empty: boolean;
}

function geometry(
  data: readonly number[],
  width: number,
  height: number,
  pad: number,
  fixedMin?: number,
  fixedMax?: number,
): Geometry {
  const n = data.length;
  if (n === 0) return { line: "", area: "", lastX: 0, lastY: 0, empty: true };

  let lo = fixedMin ?? Number.POSITIVE_INFINITY;
  let hi = fixedMax ?? Number.NEGATIVE_INFINITY;
  if (fixedMin === undefined || fixedMax === undefined) {
    for (const v of data) {
      if (fixedMin === undefined && v < lo) lo = v;
      if (fixedMax === undefined && v > hi) hi = v;
    }
  }
  // Constant series: a line in the middle, not a division by zero.
  const span = hi - lo || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  let line = "";
  let lastX = pad;
  let lastY = pad + innerH / 2;
  for (let i = 0; i < n; i++) {
    const x = pad + i * stepX;
    const y = pad + innerH - ((data[i]! - lo) / span) * innerH;
    line += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    lastX = x;
    lastY = y;
  }

  const base = (height - pad).toFixed(2);
  const area = line + `L${lastX.toFixed(2)} ${base}L${pad.toFixed(2)} ${base}Z`;
  return { line, area, lastX, lastY, empty: false };
}

export function Sparkline(props: SparklineProps): El {
  const width = props.width ?? 120;
  const height = props.height ?? 32;
  const thickness = props.thickness ?? 1.5;
  const pad = thickness; // so the line isn't clipped at the edges

  // A single derived feeds all the attributes; each attribute is its own
  // binding, so only what changed gets rewritten.
  const geo = derived(() => geometry(props.data(), width, height, pad, props.min, props.max));

  return R.span(
    { class: props.class ? "rui-sparkline " + props.class : "rui-sparkline", role: "img", ...(props.label ? { "aria-label": props.label } : {}) },
    R.svg(
      {
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        "aria-hidden": "true",
        preserveAspectRatio: "none",
      },
      props.area
        ? R.path({ class: "rui-sparkline-area", d: () => geo().area, stroke: "none" })
        : null,
      R.path({
        class: "rui-sparkline-line",
        fill: "none",
        "stroke-width": String(thickness),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        d: () => geo().line,
      }),
      props.lastPoint
        ? Show({
            when: () => !geo().empty,
            children: R.circle({
              class: "rui-sparkline-point",
              r: String(thickness + 0.5),
              cx: () => geo().lastX.toFixed(2),
              cy: () => geo().lastY.toFixed(2),
            }),
          })
        : null,
    ),
  );
}
