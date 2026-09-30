/**
 * Additional chart types: Pie, Donut, Scatter, Bubble, Heatmap, Gauge,
 * Radar, Funnel, Candlestick, Treemap, Sankey. Plus `Meter`.
 *
 * They all build on the primitives in `chart.ts` (scale, extent, colors) and
 * follow the same rule: `For` keyed by index, reactive attributes - data that
 * changes rewrites attributes, it does not recreate nodes.
 *
 * Each chart is `role="img"` with an `aria-label` from `summary`; the geometry
 * is `aria-hidden`, because a screen reader that reads 200 coordinates does not
 * help anyone.
 */
import { derived, type Accessor } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { CHART_COLORS, scaleLinear, extent, niceTicks, type Series } from "./chart.ts";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

function colorAt(index: number, explicit?: string): string {
  return explicit ?? CHART_COLORS[index % CHART_COLORS.length]!;
}

function shell(props: { summary?: string; class?: string; legend?: Child }, svg: El, base: string): El {
  return R.figure(
    { class: props.class ? base + " rui-chart " + props.class : base + " rui-chart" },
    svg,
    props.legend ?? null,
    props.summary !== undefined ? R.figcaption({ class: "rui-sr-only" }, props.summary) : null,
  );
}

/* --------------------------------------------------------- Pie and Donut -- */

export interface Slice {
  label: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  data: Accessor<readonly Slice[]> | readonly Slice[];
  size?: number;
  /** Hole radius, 0..1 of the total radius. `0` = pie, `0.6` = donut. */
  innerRadius?: number;
  /** Text in the center of the ring (donut only). */
  center?: Child;
  legend?: boolean;
  summary?: string;
  class?: string;
}

/** Describes a circle sector as an SVG `path`. */
export function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startAngle: number,
  endAngle: number,
): string {
  // A sector of exactly 360° cannot be drawn with a single arc (the start
  // point coincides with the end point): we split it into two halves.
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 1e-9) {
    const half = startAngle + Math.PI;
    return (
      arcPath(cx, cy, outer, inner, startAngle, half) +
      arcPath(cx, cy, outer, inner, half, startAngle + Math.PI * 2)
    );
  }

  const p = (angle: number, radius: number): string =>
    (cx + radius * Math.cos(angle)).toFixed(2) + " " + (cy + radius * Math.sin(angle)).toFixed(2);
  const large = sweep > Math.PI ? 1 : 0;

  if (inner <= 0) {
    return `M${cx.toFixed(2)} ${cy.toFixed(2)}L${p(startAngle, outer)}A${outer} ${outer} 0 ${large} 1 ${p(endAngle, outer)}Z`;
  }
  return (
    `M${p(startAngle, outer)}A${outer} ${outer} 0 ${large} 1 ${p(endAngle, outer)}` +
    `L${p(endAngle, inner)}A${inner} ${inner} 0 ${large} 0 ${p(startAngle, inner)}Z`
  );
}

export function PieChart(props: PieChartProps): El {
  const size = props.size ?? 200;
  const radius = size / 2 - 2;
  const inner = radius * (props.innerRadius ?? 0);
  const read = (): readonly Slice[] => (typeof props.data === "function" ? props.data() : props.data);

  const model = derived(() => {
    const slices = read();
    const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    let angle = -Math.PI / 2; // start from the top, not from 3 o'clock
    return slices.map((slice, i) => {
      const share = total > 0 ? Math.max(0, slice.value) / total : 0;
      const start = angle;
      angle += share * Math.PI * 2;
      return { slice, index: i, start, end: angle, share };
    });
  });

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(size),
        height: String(size),
        viewBox: `0 0 ${size} ${size}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      For({
        each: () => model().map((_, i) => i),
        children: (i: number) =>
          R.path({
            class: "rui-slice",
            fill: () => colorAt(i, model()[i]?.slice.color),
            d: () => {
              const part = model()[i];
              if (!part) return "";
              return arcPath(size / 2, size / 2, radius, inner, part.start, part.end);
            },
          }),
      }),
      props.center !== undefined && inner > 0
        ? R.text(
            {
              class: "rui-pie-center",
              x: String(size / 2),
              y: String(size / 2 + 5),
              "text-anchor": "middle",
            },
            props.center,
          )
        : null,
    ),
    "rui-pie",
  );
}

export function DonutChart(props: PieChartProps): El {
  return PieChart({ ...props, innerRadius: props.innerRadius ?? 0.62 });
}

/* ---------------------------------------------------- Scatter and Bubble -- */

export interface Point {
  x: number;
  y: number;
  /** Size (bubble only). */
  size?: number;
  label?: string;
}

export interface ScatterChartProps {
  series: Accessor<readonly { label: string; points: readonly Point[]; color?: string }[]> |
    readonly { label: string; points: readonly Point[]; color?: string }[];
  width?: number;
  height?: number;
  /** Radius of the points. Default 4. */
  radius?: number;
  /** Scale the radius by `point.size` (bubble). */
  bubble?: boolean;
  maxRadius?: number;
  grid?: boolean;
  summary?: string;
  class?: string;
}

export function ScatterChart(props: ScatterChartProps): El {
  const width = props.width ?? 420;
  const height = props.height ?? 260;
  const margin = { top: 12, right: 14, bottom: 28, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const read = () => (typeof props.series === "function" ? props.series() : props.series);

  const model = derived(() => {
    const series = read();
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y));
    const sizes = series.flatMap((s) => s.points.map((p) => p.size ?? 1));
    const x = scaleLinear(extent(xs, false), [margin.left, margin.left + innerW]);
    const y = scaleLinear(extent(ys, false), [margin.top + innerH, margin.top]);
    const maxSize = Math.max(1, ...sizes);
    // Radius by the SQUARE ROOT of the value: the area must be proportional,
    // not the radius - otherwise a doubled value looks four times larger.
    const r = (value: number): number =>
      props.bubble
        ? Math.max(2, Math.sqrt(value / maxSize) * (props.maxRadius ?? 22))
        : (props.radius ?? 4);
    return { series, x, y, r };
  });

  /** (series, point) pairs with stable keys. */
  const keys = derived<number[]>(() => {
    const out: number[] = [];
    model().series.forEach((s, si) => s.points.forEach((_, pi) => out.push(si * 10000 + pi)));
    return out;
  });

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      props.grid !== false
        ? R.g(
            { class: "rui-axis", "aria-hidden": "true" },
            () =>
              niceTicks(model().y.domain[0], model().y.domain[1], 4).map((value) =>
                R.g(
                  {},
                  R.line({
                    class: "rui-grid-line",
                    x1: String(margin.left),
                    x2: String(margin.left + innerW),
                    y1: model().y(value).toFixed(2),
                    y2: model().y(value).toFixed(2),
                  }),
                  R.text(
                    {
                      class: "rui-tick-label",
                      x: String(margin.left - 8),
                      y: (model().y(value) + 4).toFixed(2),
                      "text-anchor": "end",
                    },
                    String(value),
                  ),
                ),
              ),
          )
        : null,
      For({
        each: () => keys(),
        children: (key: number) => {
          const si = Math.floor(key / 10000);
          const pi = key % 10000;
          const point = (): Point => model().series[si]?.points[pi] ?? { x: 0, y: 0 };
          return R.circle({
            class: "rui-point",
            fill: () => colorAt(si, model().series[si]?.color),
            "fill-opacity": props.bubble ? "0.55" : "0.9",
            cx: () => model().x(point().x).toFixed(2),
            cy: () => model().y(point().y).toFixed(2),
            r: () => model().r(point().size ?? 1).toFixed(2),
          });
        },
      }),
    ),
    "rui-scatter",
  );
}

export function BubbleChart(props: Omit<ScatterChartProps, "bubble">): El {
  return ScatterChart({ ...props, bubble: true });
}

/* --------------------------------------------------------------- Heatmap -- */

export interface HeatmapProps {
  /** A `rows x cols` matrix of values. */
  values: Accessor<readonly (readonly number[])[]> | readonly (readonly number[])[];
  rowLabels?: readonly string[];
  colLabels?: readonly string[];
  cellSize?: number;
  /** The color at maximum intensity. */
  color?: string;
  summary?: string;
  class?: string;
}

/** Interpolates a color's opacity by value. */
export function Heatmap(props: HeatmapProps): El {
  const cell = props.cellSize ?? 28;
  const read = () => (typeof props.values === "function" ? props.values() : props.values);
  const labelW = props.rowLabels ? 70 : 0;
  const labelH = props.colLabels ? 22 : 0;

  const model = derived(() => {
    const rows = read();
    const flat = rows.flatMap((r) => [...r]);
    const [lo, hi] = extent(flat, false);
    const span = hi - lo || 1;
    return { rows, lo, span, cols: Math.max(0, ...rows.map((r) => r.length)) };
  });

  const keys = derived<number[]>(() => {
    const out: number[] = [];
    model().rows.forEach((row, ri) => row.forEach((_, ci) => out.push(ri * 1000 + ci)));
    return out;
  });

  const width = () => labelW + model().cols * cell;
  const height = () => labelH + model().rows.length * cell;

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: () => String(width()),
        height: () => String(height()),
        viewBox: () => `0 0 ${width()} ${height()}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      props.colLabels
        ? R.g({ "aria-hidden": "true" }, props.colLabels.map((label, ci) =>
            R.text(
              {
                class: "rui-tick-label",
                x: String(labelW + ci * cell + cell / 2),
                y: String(labelH - 7),
                "text-anchor": "middle",
              },
              label,
            ),
          ))
        : null,
      props.rowLabels
        ? R.g({ "aria-hidden": "true" }, props.rowLabels.map((label, ri) =>
            R.text(
              {
                class: "rui-tick-label",
                x: String(labelW - 8),
                y: String(labelH + ri * cell + cell / 2 + 4),
                "text-anchor": "end",
              },
              label,
            ),
          ))
        : null,
      For({
        each: () => keys(),
        children: (key: number) => {
          const ri = Math.floor(key / 1000);
          const ci = key % 1000;
          const value = (): number => model().rows[ri]?.[ci] ?? 0;
          return R.rect({
            class: "rui-heat-cell",
            x: String(labelW + ci * cell + 1),
            y: String(labelH + ri * cell + 1),
            width: String(cell - 2),
            height: String(cell - 2),
            rx: "3",
            fill: props.color ?? CHART_COLORS[0]!,
            // Intensity via opacity: a single attribute write.
            "fill-opacity": () => (0.08 + ((value() - model().lo) / model().span) * 0.92).toFixed(3),
          });
        },
      }),
    ),
    "rui-heatmap",
  );
}

/* ----------------------------------------------------------------- Gauge -- */

export interface GaugeProps {
  value: Accessor<number> | number;
  min?: number;
  max?: number;
  size?: number;
  thickness?: number;
  /** Color thresholds: `[{ at, color }]`, applied in ascending order. */
  thresholds?: readonly { at: number; color: string }[];
  label?: Child;
  format?: (value: number) => string;
  summary?: string;
  class?: string;
}

/** Speedometer: a 240° arc, open at the bottom. */
export function Gauge(props: GaugeProps): El {
  const size = props.size ?? 160;
  const thickness = props.thickness ?? 14;
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const radius = size / 2 - thickness / 2 - 2;
  const START = Math.PI * 0.75;
  const SWEEP = Math.PI * 1.5;

  const read = (): number => (typeof props.value === "function" ? props.value() : props.value);
  const fraction = derived(() => Math.min(1, Math.max(0, (read() - min) / (max - min || 1))));

  const color = derived(() => {
    const list = props.thresholds;
    if (!list || list.length === 0) return CHART_COLORS[0]!;
    let picked = list[0]!.color;
    for (const t of list) if (read() >= t.at) picked = t.color;
    return picked;
  });

  const arc = (from: number, to: number): string => {
    const cx = size / 2;
    const cy = size / 2;
    const p = (angle: number): string =>
      (cx + radius * Math.cos(angle)).toFixed(2) + " " + (cy + radius * Math.sin(angle)).toFixed(2);
    const large = to - from > Math.PI ? 1 : 0;
    return `M${p(from)}A${radius} ${radius} 0 ${large} 1 ${p(to)}`;
  };

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(size),
        height: String(size),
        viewBox: `0 0 ${size} ${size}`,
        role: "img",
        "aria-label": props.summary,
        // A gauge is a value within a range: `meter`, not `progressbar`.
        ...(props.summary ? {} : { "aria-hidden": "true" }),
      },
      R.path({
        class: "rui-gauge-track",
        fill: "none",
        "stroke-width": String(thickness),
        "stroke-linecap": "round",
        d: arc(START, START + SWEEP),
      }),
      R.path({
        class: "rui-gauge-fill",
        fill: "none",
        "stroke-width": String(thickness),
        "stroke-linecap": "round",
        stroke: () => color(),
        d: () => arc(START, START + SWEEP * Math.max(0.0001, fraction())),
      }),
      R.text(
        { class: "rui-gauge-value", x: String(size / 2), y: String(size / 2 + 6), "text-anchor": "middle" },
        () => (props.format ? props.format(read()) : String(Math.round(read()))),
      ),
      props.label !== undefined
        ? R.text(
            { class: "rui-gauge-label", x: String(size / 2), y: String(size / 2 + 26), "text-anchor": "middle" },
            props.label,
          )
        : null,
    ),
    "rui-gauge",
  );
}

/* ------------------------------------------------------------ RadarChart -- */

export interface RadarChartProps {
  /** The chart axes. */
  axes: readonly string[];
  series: Accessor<readonly Series[]> | readonly Series[];
  size?: number;
  max?: number;
  summary?: string;
  class?: string;
}

export function RadarChart(props: RadarChartProps): El {
  const size = props.size ?? 260;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 34;
  const axes = props.axes;
  const read = () => (typeof props.series === "function" ? props.series() : props.series);

  const model = derived(() => {
    const series = read();
    const all = series.flatMap((s) => [...s.values]);
    const max = props.max ?? Math.max(1, ...all);
    return { series, max };
  });

  const angleOf = (index: number): number => -Math.PI / 2 + (index / axes.length) * Math.PI * 2;

  const polygon = (values: readonly number[]): string => {
    const { max } = model();
    return (
      axes
        .map((_, i) => {
          const r = (Math.min(max, Math.max(0, values[i] ?? 0)) / max) * radius;
          return (cx + r * Math.cos(angleOf(i))).toFixed(2) + "," + (cy + r * Math.sin(angleOf(i))).toFixed(2);
        })
        .join(" ")
    );
  };

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(size),
        height: String(size),
        viewBox: `0 0 ${size} ${size}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      // The web: concentric circles + spokes.
      R.g({ class: "rui-radar-web", "aria-hidden": "true" },
        [0.25, 0.5, 0.75, 1].map((step) =>
          R.polygon({
            class: "rui-grid-line",
            fill: "none",
            points: axes
              .map((_, i) =>
                (cx + radius * step * Math.cos(angleOf(i))).toFixed(2) +
                "," +
                (cy + radius * step * Math.sin(angleOf(i))).toFixed(2),
              )
              .join(" "),
          }),
        ),
      ),
      R.g({ class: "rui-radar-labels", "aria-hidden": "true" },
        axes.map((label, i) =>
          R.text(
            {
              class: "rui-tick-label",
              x: (cx + (radius + 16) * Math.cos(angleOf(i))).toFixed(2),
              y: (cy + (radius + 16) * Math.sin(angleOf(i))).toFixed(2),
              "text-anchor": "middle",
            },
            label,
          ),
        ),
      ),
      For({
        each: () => model().series.map((_, i) => i),
        children: (i: number) =>
          R.polygon({
            class: "rui-radar-area",
            fill: () => colorAt(i, model().series[i]?.color),
            "fill-opacity": "0.22",
            stroke: () => colorAt(i, model().series[i]?.color),
            "stroke-width": "2",
            points: () => polygon(model().series[i]?.values ?? []),
          }),
      }),
    ),
    "rui-radar",
  );
}

/* ----------------------------------------------------------- FunnelChart -- */

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: Accessor<readonly FunnelStage[]> | readonly FunnelStage[];
  width?: number;
  /** The height of a stage. */
  stageHeight?: number;
  /** Show the percentage relative to the previous stage. */
  showRate?: boolean;
  summary?: string;
  class?: string;
}

export function FunnelChart(props: FunnelChartProps): El {
  const width = props.width ?? 380;
  const stageH = props.stageHeight ?? 46;
  const read = () => (typeof props.stages === "function" ? props.stages() : props.stages);

  const model = derived(() => {
    const stages = read();
    const top = Math.max(1, ...stages.map((s) => s.value));
    return { stages, top };
  });

  const height = () => model().stages.length * stageH + 8;

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(width),
        height: () => String(height()),
        viewBox: () => `0 0 ${width} ${height()}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      For({
        each: () => model().stages.map((_, i) => i),
        children: (i: number) => {
          const stage = (): FunnelStage => model().stages[i] ?? { label: "", value: 0 };
          const barW = (): number => (stage().value / model().top) * (width - 120);
          const rate = (): string => {
            const prev = model().stages[i - 1];
            if (!prev || prev.value === 0) return "";
            return Math.round((stage().value / prev.value) * 100) + "%";
          };
          return R.g(
            { class: "rui-funnel-stage" },
            R.text(
              { class: "rui-tick-label", x: "0", y: String(i * stageH + stageH / 2 + 4) },
              () => stage().label,
            ),
            R.rect({
              class: "rui-funnel-bar",
              x: "110",
              y: String(i * stageH + 6),
              height: String(stageH - 14),
              rx: "4",
              fill: () => colorAt(i, stage().color),
              width: () => Math.max(1, barW()).toFixed(2),
            }),
            props.showRate
              ? R.text(
                  {
                    class: "rui-tick-label rui-funnel-rate",
                    y: String(i * stageH + stageH / 2 + 4),
                    x: () => (118 + barW()).toFixed(2),
                  },
                  () => rate(),
                )
              : null,
          );
        },
      }),
    ),
    "rui-funnel",
  );
}

/* ------------------------------------------------------ CandlestickChart -- */

export interface Candle {
  label?: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlestickChartProps {
  candles: Accessor<readonly Candle[]> | readonly Candle[];
  width?: number;
  height?: number;
  upColor?: string;
  downColor?: string;
  summary?: string;
  class?: string;
}

export function CandlestickChart(props: CandlestickChartProps): El {
  const width = props.width ?? 480;
  const height = props.height ?? 260;
  const margin = { top: 10, right: 10, bottom: 22, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const up = props.upColor ?? "#0f6e4f";
  const down = props.downColor ?? "#b42318";
  const read = () => (typeof props.candles === "function" ? props.candles() : props.candles);

  const model = derived(() => {
    const candles = read();
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    // The domain does NOT include zero: a stock price at 150 is not read on an
    // axis that starts from 0.
    const y = scaleLinear(extent([...lows, ...highs], false), [margin.top + innerH, margin.top]);
    const step = candles.length > 0 ? innerW / candles.length : innerW;
    return { candles, y, step, bodyW: Math.max(1, step * 0.62) };
  });

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      R.g({ class: "rui-axis", "aria-hidden": "true" }, () =>
        niceTicks(model().y.domain[0], model().y.domain[1], 4).map((value) =>
          R.g(
            {},
            R.line({
              class: "rui-grid-line",
              x1: String(margin.left),
              x2: String(margin.left + innerW),
              y1: model().y(value).toFixed(2),
              y2: model().y(value).toFixed(2),
            }),
            R.text(
              {
                class: "rui-tick-label",
                x: String(margin.left - 8),
                y: (model().y(value) + 4).toFixed(2),
                "text-anchor": "end",
              },
              String(value),
            ),
          ),
        ),
      ),
      For({
        each: () => model().candles.map((_, i) => i),
        children: (i: number) => {
          const candle = (): Candle => model().candles[i] ?? { open: 0, high: 0, low: 0, close: 0 };
          const cx = (): number => margin.left + i * model().step + model().step / 2;
          const bull = (): boolean => candle().close >= candle().open;
          return R.g(
            { class: "rui-candle" },
            R.line({
              class: "rui-candle-wick",
              stroke: () => (bull() ? up : down),
              "stroke-width": "1",
              x1: () => cx().toFixed(2),
              x2: () => cx().toFixed(2),
              y1: () => model().y(candle().high).toFixed(2),
              y2: () => model().y(candle().low).toFixed(2),
            }),
            R.rect({
              class: "rui-candle-body",
              fill: () => (bull() ? up : down),
              x: () => (cx() - model().bodyW / 2).toFixed(2),
              width: () => model().bodyW.toFixed(2),
              y: () => Math.min(model().y(candle().open), model().y(candle().close)).toFixed(2),
              // Minimum height 1px: a doji candle would be invisible.
              height: () =>
                Math.max(1, Math.abs(model().y(candle().open) - model().y(candle().close))).toFixed(2),
            }),
          );
        },
      }),
    ),
    "rui-candles",
  );
}

/* --------------------------------------------------------------- Treemap -- */

export interface TreemapItem {
  label: string;
  value: number;
  color?: string;
}

export interface TreemapRect {
  item: TreemapItem;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * "Squarified" layout: tries to produce rectangles as close to squares as
 * possible, because extreme aspect ratios are impossible to compare visually.
 * The algorithm is the one from Bruls, Huizing & van Wijk (2000), simplified.
 */
export function squarify(
  items: readonly TreemapItem[],
  width: number,
  height: number,
): TreemapRect[] {
  const total = items.reduce((sum, i) => sum + Math.max(0, i.value), 0);
  if (total <= 0 || items.length === 0) return [];

  const scaled = items.map((item, index) => ({
    item,
    index,
    area: (Math.max(0, item.value) / total) * width * height,
  }));
  // Descending: large items get the good space first.
  scaled.sort((a, b) => b.area - a.area);

  const out: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: typeof scaled = [];

  const worst = (candidate: typeof scaled, side: number): number => {
    const sum = candidate.reduce((s, c) => s + c.area, 0);
    if (sum === 0) return Number.POSITIVE_INFINITY;
    const max = Math.max(...candidate.map((c) => c.area));
    const min = Math.min(...candidate.map((c) => c.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const flush = (): void => {
    const sum = row.reduce((s, c) => s + c.area, 0);
    if (sum === 0) {
      row = [];
      return;
    }
    const horizontal = w >= h;
    const thickness = sum / (horizontal ? h : w);
    let offset = 0;
    for (const cell of row) {
      const length = cell.area / thickness;
      out.push(
        horizontal
          ? { item: cell.item, index: cell.index, x, y: y + offset, width: thickness, height: length }
          : { item: cell.item, index: cell.index, x: x + offset, y, width: length, height: thickness },
      );
      offset += length;
    }
    if (horizontal) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    row = [];
  };

  for (const cell of scaled) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, cell], side) <= worst(row, side)) {
      row.push(cell);
    } else {
      flush();
      row.push(cell);
    }
  }
  flush();
  return out;
}

export interface TreemapProps {
  items: Accessor<readonly TreemapItem[]> | readonly TreemapItem[];
  width?: number;
  height?: number;
  summary?: string;
  class?: string;
}

export function Treemap(props: TreemapProps): El {
  const width = props.width ?? 420;
  const height = props.height ?? 260;
  const read = () => (typeof props.items === "function" ? props.items() : props.items);
  const cells = derived(() => squarify(read(), width, height));

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      For({
        each: () => cells().map((c) => c.index),
        children: (index: number) => {
          const cell = (): TreemapRect | undefined => cells().find((c) => c.index === index);
          return R.g(
            { class: "rui-treemap-cell" },
            R.rect({
              fill: () => colorAt(index, cell()?.item.color),
              x: () => (cell()?.x ?? 0).toFixed(2),
              y: () => (cell()?.y ?? 0).toFixed(2),
              width: () => Math.max(0, (cell()?.width ?? 0) - 2).toFixed(2),
              height: () => Math.max(0, (cell()?.height ?? 0) - 2).toFixed(2),
              rx: "3",
            }),
            R.text(
              {
                class: "rui-treemap-label",
                x: () => ((cell()?.x ?? 0) + 6).toFixed(2),
                y: () => ((cell()?.y ?? 0) + 18).toFixed(2),
                // The label disappears when the cell is too small for it.
                opacity: () => ((cell()?.width ?? 0) > 54 && (cell()?.height ?? 0) > 26 ? "1" : "0"),
              },
              () => cell()?.item.label ?? "",
            ),
          );
        },
      }),
    ),
    "rui-treemap",
  );
}

/* --------------------------------------------------------- SankeyDiagram -- */

export interface SankeyNode {
  key: string;
  label: string;
  color?: string;
}

export interface SankeyLink {
  from: string;
  to: string;
  value: number;
}

export interface SankeyLayout {
  nodes: Array<{ node: SankeyNode; depth: number; x: number; y: number; height: number; value: number }>;
  links: Array<{ link: SankeyLink; path: string; width: number; color: string }>;
}

/**
 * Simplified Sankey layout.
 *
 * The depth of a node = the longest path to it. **The graph must be acyclic**;
 * a cycle would make the computation never terminate, so we cap it at a maximum
 * depth and carry on - a wrong result is better than an infinite loop that
 * freezes the page.
 */
export function sankeyLayout(
  nodes: readonly SankeyNode[],
  links: readonly SankeyLink[],
  width: number,
  height: number,
  nodeWidth = 14,
  gap = 8,
): SankeyLayout {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const depth = new Map<string, number>();
  for (const n of nodes) depth.set(n.key, 0);

  const MAX_DEPTH = nodes.length + 1;
  let changed = true;
  let guard = 0;
  while (changed && guard++ <= MAX_DEPTH) {
    changed = false;
    for (const link of links) {
      const from = depth.get(link.from) ?? 0;
      const to = depth.get(link.to) ?? 0;
      if (to < from + 1) {
        depth.set(link.to, Math.min(MAX_DEPTH, from + 1));
        changed = true;
      }
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.key) ?? 0;
    const bucket = columns.get(d);
    if (bucket) bucket.push(n.key);
    else columns.set(d, [n.key]);
  }

  /** The flow of a node: the maximum of what comes in and what goes out. */
  const flow = new Map<string, number>();
  for (const n of nodes) {
    const incoming = links.filter((l) => l.to === n.key).reduce((s, l) => s + l.value, 0);
    const outgoing = links.filter((l) => l.from === n.key).reduce((s, l) => s + l.value, 0);
    flow.set(n.key, Math.max(incoming, outgoing));
  }

  const columnTotal = (keys: readonly string[]): number =>
    keys.reduce((s, k) => s + (flow.get(k) ?? 0), 0);
  const maxTotal = Math.max(1, ...[...columns.values()].map(columnTotal));
  const usable = height - gap * Math.max(0, Math.max(...[...columns.values()].map((c) => c.length)) - 1);
  const scale = usable / maxTotal;

  const positions = new Map<string, { x: number; y: number; height: number }>();
  const layoutNodes: SankeyLayout["nodes"] = [];
  const stepX = maxDepth > 0 ? (width - nodeWidth) / maxDepth : 0;

  for (const [d, keys] of columns) {
    let y = 0;
    for (const key of keys) {
      const value = flow.get(key) ?? 0;
      const h = Math.max(2, value * scale);
      const x = d * stepX;
      positions.set(key, { x, y, height: h });
      const node = byKey.get(key);
      if (node) layoutNodes.push({ node, depth: d, x, y, height: h, value });
      y += h + gap;
    }
  }

  // Accumulated offsets, so the links do not overlap on the same node.
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const layoutLinks: SankeyLayout["links"] = [];

  for (const link of links) {
    const a = positions.get(link.from);
    const b = positions.get(link.to);
    if (!a || !b) continue;
    const thickness = Math.max(1, link.value * scale);
    const y0 = a.y + (outOffset.get(link.from) ?? 0) + thickness / 2;
    const y1 = b.y + (inOffset.get(link.to) ?? 0) + thickness / 2;
    outOffset.set(link.from, (outOffset.get(link.from) ?? 0) + thickness);
    inOffset.set(link.to, (inOffset.get(link.to) ?? 0) + thickness);

    const x0 = a.x + nodeWidth;
    const x1 = b.x;
    const mid = (x0 + x1) / 2;
    layoutLinks.push({
      link,
      width: thickness,
      color: byKey.get(link.from)?.color ?? CHART_COLORS[0]!,
      path: `M${x0.toFixed(2)} ${y0.toFixed(2)}C${mid.toFixed(2)} ${y0.toFixed(2)} ${mid.toFixed(2)} ${y1.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    });
  }

  return { nodes: layoutNodes, links: layoutLinks };
}

export interface SankeyDiagramProps {
  nodes: readonly SankeyNode[];
  links: Accessor<readonly SankeyLink[]> | readonly SankeyLink[];
  width?: number;
  height?: number;
  nodeWidth?: number;
  summary?: string;
  class?: string;
}

export function SankeyDiagram(props: SankeyDiagramProps): El {
  const width = props.width ?? 520;
  const height = props.height ?? 300;
  const nodeWidth = props.nodeWidth ?? 14;
  const labelPad = 80;
  const read = () => (typeof props.links === "function" ? props.links() : props.links);

  const layout = derived(() =>
    sankeyLayout(props.nodes, read(), width - labelPad, height - 10, nodeWidth),
  );

  return shell(
    props,
    R.svg(
      {
        class: "rui-chart-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        ...(props.summary ? { "aria-label": props.summary } : { "aria-hidden": "true" }),
      },
      R.g({ class: "rui-sankey-links" },
        For({
          each: () => layout().links.map((_, i) => i),
          children: (i: number) =>
            R.path({
              class: "rui-sankey-link",
              fill: "none",
              stroke: () => layout().links[i]?.color ?? CHART_COLORS[0]!,
              "stroke-opacity": "0.35",
              "stroke-width": () => String(layout().links[i]?.width ?? 1),
              d: () => layout().links[i]?.path ?? "",
            }),
        }),
      ),
      R.g({ class: "rui-sankey-nodes" },
        For({
          each: () => layout().nodes.map((_, i) => i),
          children: (i: number) => {
            const node = () => layout().nodes[i];
            return R.g(
              {},
              R.rect({
                class: "rui-sankey-node",
                width: String(nodeWidth),
                rx: "2",
                fill: () => node()?.node.color ?? colorAt(i),
                x: () => (node()?.x ?? 0).toFixed(2),
                y: () => (node()?.y ?? 0).toFixed(2),
                height: () => (node()?.height ?? 0).toFixed(2),
              }),
              R.text(
                {
                  class: "rui-tick-label",
                  x: () => ((node()?.x ?? 0) + nodeWidth + 5).toFixed(2),
                  y: () => ((node()?.y ?? 0) + (node()?.height ?? 0) / 2 + 4).toFixed(2),
                },
                () => node()?.node.label ?? "",
              ),
            );
          },
        }),
      ),
    ),
    "rui-sankey",
  );
}

/* ----------------------------------------------------------------- Meter -- */

export interface MeterProps {
  value: Accessor<number> | number;
  min?: number;
  max?: number;
  /** Below this value, the bar is marked as "low". */
  low?: number;
  /** Above this value, as "high". */
  high?: number;
  /** The value considered optimal; decides which color is "good". */
  optimum?: number;
  label?: string;
  format?: (value: number) => string;
  class?: string;
}

/**
 * Meter - a value within a KNOWN range (disk space, battery).
 *
 * Different from `Progress`: that one measures a task's advance toward
 * completion, this one measures how full something is. ARIA has different roles
 * for them and screen readers announce them differently.
 */
export function Meter(props: MeterProps): El {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const read = (): number => (typeof props.value === "function" ? props.value() : props.value);
  const fraction = derived(() => Math.min(1, Math.max(0, (read() - min) / (max - min || 1))));

  const level = derived<"low" | "ok" | "high">(() => {
    const value = read();
    if (props.low !== undefined && value < props.low) return "low";
    if (props.high !== undefined && value > props.high) return "high";
    return "ok";
  });

  return R.div(
    {
      class: props.class ? "rui-meter " + props.class : "rui-meter",
      role: "meter",
      "aria-valuemin": String(min),
      "aria-valuemax": String(max),
      "aria-valuenow": () => String(read()),
      ...(props.format ? { "aria-valuetext": () => props.format!(read()) } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    R.div(
      { class: "rui-meter-track" },
      R.div({
        class: () => "rui-meter-fill rui-level-" + level(),
        style: () => "width:" + (fraction() * 100).toFixed(2) + "%",
      }),
    ),
    props.format
      ? R.span({ class: "rui-meter-value rui-tabular" }, () => props.format!(read()))
      : null,
  );
}
