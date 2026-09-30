/**
 * ChartPrimitives / LineChart / AreaChart / BarChart.
 *
 * Basic charts, not a visualization library. They cover the common cases
 * (time series, comparison across categories) and stop there: scales, axes,
 * grid, legend, tooltip. For anything else - sankey, treemap, maps - you need
 * a dedicated library, and that's fine.
 *
 * The fine-grained thesis: data that changes rewrites the `d` attribute of a
 * `path` or the `height` of a `rect`. Nodes are not recreated, because `For`
 * is keyed on index (as in `virtualizer`), not on new objects at every tick.
 */
import { derived, state, type Accessor } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ scale */

export interface LinearScale {
  (value: number): number;
  domain: readonly [number, number];
  range: readonly [number, number];
  /** "Round" values for the axis. */
  ticks: (count?: number) => number[];
  invert: (pixel: number) => number;
}

/** Linear value → pixel scale. */
export function scaleLinear(domain: readonly [number, number], range: readonly [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  // Degenerate domain (all values equal): map to the middle, not to NaN.
  const span = d1 - d0;
  const fn = ((value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;

  fn.domain = domain;
  fn.range = range;
  fn.invert = (pixel: number): number =>
    r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span;
  fn.ticks = (count = 5): number[] => niceTicks(d0, d1, count);
  return fn;
}

/** "Round" steps (1, 2, 5, 10...) that cover the interval. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  // The smallest "round" step that is >= raw. Order matters: with `>=` instead
  // of `<=` you'd always pick the next step up and end up with half the ticks.
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step / 1000; v += step) {
    // Clean up floating-point errors accumulated from repeated additions.
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

export interface BandScale {
  (index: number): number;
  bandwidth: number;
  step: number;
}

/** Categorical scale: splits the interval into `count` bands with space between them. */
export function scaleBand(count: number, range: readonly [number, number], padding = 0.2): BandScale {
  const [r0, r1] = range;
  const width = r1 - r0;
  const step = count > 0 ? width / count : width;
  const bandwidth = step * (1 - padding);
  const fn = ((index: number): number => r0 + index * step + (step - bandwidth) / 2) as BandScale;
  fn.bandwidth = bandwidth;
  fn.step = step;
  return fn;
}

/** Extends the domain to 0 and adds margin, so the peak doesn't touch the frame. */
export function extent(values: readonly number[], includeZero = true): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) return hi === 0 ? [0, 1] : [Math.min(0, hi), hi * 1.1];
  return [lo, hi];
}

/* ------------------------------------------------------------- primitive */

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 12, right: 12, bottom: 28, left: 44 };

export interface AxisProps {
  scale: LinearScale | BandScale;
  /** The axis position in the chart's coordinate system. */
  orientation: "bottom" | "left";
  /** For the bottom axis with `scaleBand`: the category labels. */
  labels?: readonly string[];
  tickCount?: number;
  format?: (value: number) => string;
  /** Where the axis is drawn (y for `bottom`, x for `left`). */
  at: number;
  /** The length of the grid lines; 0 disables them. */
  gridLength?: number;
}

/** Axis with ticks and, optionally, grid lines. The ticks are `aria-hidden`. */
export function Axis(props: AxisProps): El {
  const isBand = typeof (props.scale as BandScale).bandwidth === "number";
  const format = props.format ?? ((v: number) => String(v));

  const marks = (): Array<{ position: number; label: string }> => {
    if (isBand) {
      const scale = props.scale as BandScale;
      return (props.labels ?? []).map((label, i) => ({
        position: scale(i) + scale.bandwidth / 2,
        label,
      }));
    }
    const scale = props.scale as LinearScale;
    return scale.ticks(props.tickCount ?? 5).map((value) => ({
      position: scale(value),
      label: format(value),
    }));
  };

  return R.g(
    { class: "rui-axis rui-axis-" + props.orientation, "aria-hidden": "true" },
    () =>
      marks().map((mark) =>
        props.orientation === "bottom"
          ? R.g(
              { class: "rui-tick" },
              props.gridLength
                ? R.line({
                    class: "rui-grid-line",
                    x1: String(mark.position),
                    x2: String(mark.position),
                    y1: String(props.at),
                    y2: String(props.at - props.gridLength),
                  })
                : null,
              R.text(
                {
                  class: "rui-tick-label",
                  x: String(mark.position),
                  y: String(props.at + 16),
                  "text-anchor": "middle",
                },
                mark.label,
              ),
            )
          : R.g(
              { class: "rui-tick" },
              props.gridLength
                ? R.line({
                    class: "rui-grid-line",
                    x1: String(props.at),
                    x2: String(props.at + props.gridLength),
                    y1: String(mark.position),
                    y2: String(mark.position),
                  })
                : null,
              R.text(
                {
                  class: "rui-tick-label",
                  x: String(props.at - 8),
                  y: String(mark.position + 4),
                  "text-anchor": "end",
                },
                mark.label,
              ),
            ),
      ),
  );
}

export interface LegendItem {
  label: string;
  color: string;
}

export function Legend(props: { items: readonly LegendItem[]; class?: string }): El {
  return R.ul(
    { class: props.class ? "rui-legend " + props.class : "rui-legend" },
    props.items.map((item) =>
      R.li(
        { class: "rui-legend-item" },
        R.span({ class: "rui-legend-swatch", style: "background:" + item.color, "aria-hidden": "true" }),
        item.label,
      ),
    ),
  );
}

/* ------------------------------------------------------------- series ---- */

export interface Series {
  label: string;
  values: readonly number[];
  color?: string;
}

export interface BaseChartProps {
  series: Accessor<readonly Series[]> | readonly Series[];
  /** The X-axis labels; their length gives the number of points. */
  labels?: Accessor<readonly string[]> | readonly string[];
  width?: number;
  height?: number;
  margin?: Partial<ChartMargin>;
  /** Format for the Y-axis values. */
  formatValue?: (value: number) => string;
  /** Include zero in the domain. Default `true`. */
  zeroBased?: boolean;
  grid?: boolean;
  legend?: boolean;
  /** Description for screen readers; the chart itself is `aria-hidden`. */
  summary?: string;
  class?: string;
}

/** Default palette, distinct enough even in black and white. */
export const CHART_COLORS = ["#17457a", "#0f6e4f", "#b45309", "#8250a8", "#b42318", "#0e7490"];

function readSeries(props: BaseChartProps): readonly Series[] {
  return typeof props.series === "function" ? props.series() : props.series;
}

function readLabels(props: BaseChartProps, count: number): readonly string[] {
  const given = typeof props.labels === "function" ? props.labels() : props.labels;
  if (given) return given;
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

function colorOf(series: Series, index: number): string {
  return series.color ?? CHART_COLORS[index % CHART_COLORS.length]!;
}

interface Frame {
  width: number;
  height: number;
  margin: ChartMargin;
  innerWidth: number;
  innerHeight: number;
}

function frameOf(props: BaseChartProps): Frame {
  const width = props.width ?? 480;
  const height = props.height ?? 240;
  const margin = { ...DEFAULT_MARGIN, ...props.margin };
  return {
    width,
    height,
    margin,
    innerWidth: Math.max(1, width - margin.left - margin.right),
    innerHeight: Math.max(1, height - margin.top - margin.bottom),
  };
}

/** The common wrapper: `<svg>`, accessible description, axes and legend. */
function chartShell(
  props: BaseChartProps,
  frame: Frame,
  xAxis: El,
  yAxis: El,
  plot: Child,
): El {
  const series = readSeries(props);
  return R.figure(
    { class: props.class ? "rui-chart " + props.class : "rui-chart" },
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(frame.width),
        height: String(frame.height),
        viewBox: `0 0 ${frame.width} ${frame.height}`,
        // The chart is an image; the alternative text is in `figcaption`.
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      yAxis,
      xAxis,
      R.g({ class: "rui-chart-plot" }, plot),
    ),
    props.legend !== false && series.length > 1
      ? Legend({ items: series.map((s, i) => ({ label: s.label, color: colorOf(s, i) })) })
      : null,
    props.summary !== undefined ? R.figcaption({ class: "rui-sr-only" }, props.summary) : null,
  );
}

/* ----------------------------------------------------- Line / Area chart */

export interface LineChartProps extends BaseChartProps {
  /** Fill the area below the line. */
  area?: boolean;
  /** Dots on each value. */
  dots?: boolean;
  thickness?: number;
}

export function LineChart(props: LineChartProps): El {
  const frame = frameOf(props);
  const thickness = props.thickness ?? 2;

  const model = derived(() => {
    const series = readSeries(props);
    const count = Math.max(...series.map((s) => s.values.length), 0);
    const labels = readLabels(props, count);
    const all = series.flatMap((s) => [...s.values]);
    const [lo, hi] = extent(all, props.zeroBased !== false);

    const x = scaleLinear([0, Math.max(1, count - 1)], [
      frame.margin.left,
      frame.margin.left + frame.innerWidth,
    ]);
    const y = scaleLinear([lo, hi], [
      frame.margin.top + frame.innerHeight,
      frame.margin.top,
    ]);
    return { series, labels, count, x, y };
  });

  const pathOf = (values: readonly number[]): string => {
    const { x, y } = model();
    let d = "";
    for (let i = 0; i < values.length; i++) {
      d += (i === 0 ? "M" : "L") + x(i).toFixed(2) + " " + y(values[i]!).toFixed(2);
    }
    return d;
  };

  const areaOf = (values: readonly number[]): string => {
    if (values.length === 0) return "";
    const { x, y } = model();
    const base = (frame.margin.top + frame.innerHeight).toFixed(2);
    return (
      pathOf(values) +
      `L${x(values.length - 1).toFixed(2)} ${base}L${x(0).toFixed(2)} ${base}Z`
    );
  };

  const yAxis = Axis({
    scale: model().y,
    orientation: "left",
    at: frame.margin.left,
    gridLength: props.grid === false ? 0 : frame.innerWidth,
    format: props.formatValue,
  });
  const xAxis = Axis({
    scale: scaleBand(model().count, [frame.margin.left, frame.margin.left + frame.innerWidth], 0),
    orientation: "bottom",
    at: frame.margin.top + frame.innerHeight,
    labels: model().labels,
  });

  /** The series at an index, or an empty one if the list has shrunk. */
  const seriesAt = (i: number): Series => model().series[i] ?? { label: "", values: [] };

  return chartShell(props, frame, xAxis, yAxis,
    // `For` keyed on indices: the numbers are stable keys, so existing paths
    // are reused and only their `d` attribute is rewritten.
    For({
      each: () => model().series.map((_, i) => i),
      children: (i: number) =>
        R.g(
          { class: "rui-series" },
          props.area
            ? R.path({
                class: "rui-area",
                fill: () => colorOf(seriesAt(i), i),
                "fill-opacity": "0.15",
                stroke: "none",
                d: () => areaOf(seriesAt(i).values),
              })
            : null,
          R.path({
            class: "rui-line",
            fill: "none",
            stroke: () => colorOf(seriesAt(i), i),
            "stroke-width": String(thickness),
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
            d: () => pathOf(seriesAt(i).values),
          }),
          props.dots
            ? For({
                each: () => seriesAt(i).values.map((_, index) => index),
                children: (index: number) =>
                  R.circle({
                    class: "rui-dot",
                    r: String(thickness + 1),
                    fill: () => colorOf(seriesAt(i), i),
                    cx: () => model().x(index).toFixed(2),
                    cy: () => model().y(seriesAt(i).values[index] ?? 0).toFixed(2),
                  }),
              })
            : null,
        ),
    }),
  );
}

export function AreaChart(props: BaseChartProps): El {
  return LineChart({ ...props, area: true });
}

/* ------------------------------------------------------------- BarChart -- */

export interface BarChartProps extends BaseChartProps {
  /** Stacked bars instead of grouped. */
  stacked?: boolean;
  /** Horizontal bars. */
  horizontal?: boolean;
}

export function BarChart(props: BarChartProps): El {
  const frame = frameOf(props);

  const model = derived(() => {
    const series = readSeries(props);
    const count = Math.max(...series.map((s) => s.values.length), 0);
    const labels = readLabels(props, count);

    // Stacked: the domain goes up to the per-category sum, not to the maximum
    // of a single series - otherwise the bars run off the chart.
    const totals: number[] = [];
    for (let i = 0; i < count; i++) {
      totals.push(series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    }
    const values = props.stacked ? totals : series.flatMap((s) => [...s.values]);
    const [lo, hi] = extent(values, props.zeroBased !== false);

    const band = scaleBand(count, [frame.margin.left, frame.margin.left + frame.innerWidth]);
    const y = scaleLinear([lo, hi], [frame.margin.top + frame.innerHeight, frame.margin.top]);
    const groupWidth = props.stacked ? band.bandwidth : band.bandwidth / Math.max(1, series.length);
    return { series, labels, count, band, y, groupWidth };
  });

  const yAxis = Axis({
    scale: model().y,
    orientation: "left",
    at: frame.margin.left,
    gridLength: props.grid === false ? 0 : frame.innerWidth,
    format: props.formatValue,
  });
  const xAxis = Axis({
    scale: model().band,
    orientation: "bottom",
    at: frame.margin.top + frame.innerHeight,
    labels: model().labels,
  });

  /**
   * The geometry of a bar, recomputed on demand. For stacked bars you need to
   * know the height of the bars below, so we compute it from scratch each time
   * - it's O(series) per bar, negligible compared to a re-render.
   */
  const geometry = (categoryIndex: number, seriesIndex: number) => {
    const { series, band, y, groupWidth } = model();
    const zero = y(0);
    const value = series[seriesIndex]?.values[categoryIndex] ?? 0;
    const height = Math.abs(zero - y(value));

    if (!props.stacked) {
      return {
        x: band(categoryIndex) + seriesIndex * groupWidth,
        y: Math.min(zero, y(value)),
        width: Math.max(0, groupWidth - 1),
        height,
      };
    }

    let top = zero;
    for (let s = 0; s < seriesIndex; s++) {
      top -= Math.abs(zero - y(series[s]?.values[categoryIndex] ?? 0));
    }
    return { x: band(categoryIndex), y: top - height, width: Math.max(0, groupWidth - 1), height };
  };

  /** A stable key per bar: `category * 1000 + series`. */
  const barKeys = (): number[] => {
    const { series, count } = model();
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let s = 0; s < series.length; s++) out.push(i * 1000 + s);
    }
    return out;
  };

  return chartShell(props, frame, xAxis, yAxis,
    For({
      each: barKeys,
      children: (key: number) => {
        const categoryIndex = Math.floor(key / 1000);
        const seriesIndex = key % 1000;
        return R.rect({
          class: "rui-bar",
          fill: () => colorOf(model().series[seriesIndex] ?? { label: "", values: [] }, seriesIndex),
          x: () => geometry(categoryIndex, seriesIndex).x.toFixed(2),
          width: () => geometry(categoryIndex, seriesIndex).width.toFixed(2),
          y: () => geometry(categoryIndex, seriesIndex).y.toFixed(2),
          height: () => Math.max(0, geometry(categoryIndex, seriesIndex).height).toFixed(2),
        });
      },
    }),
  );
}
