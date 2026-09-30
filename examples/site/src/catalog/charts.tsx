/** Charts. */
import { state, onCleanup } from "@raptorstack/raptorjs/dom";
import { AreaChart, BarChart, CHART_COLORS, LineChart, niceTicks, scaleLinear } from "@raptorstack/raptorjs/ui/chart";
import {
  CandlestickChart,
  DonutChart,
  FunnelChart,
  Gauge,
  Heatmap,
  PieChart,
  RadarChart,
  SankeyDiagram,
  ScatterChart,
  Treemap,
} from "@raptorstack/raptorjs/ui/chart-extra";
import { Sparkline } from "@raptorstack/raptorjs/ui/sparkline";
import { Button } from "@raptorstack/raptorjs/ui/button";
import type { CatalogGroup } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const SERIES = [
  { label: "Raptor", values: [12, 19, 24, 31, 38, 47] },
  { label: "Baseline", values: [14, 16, 17, 19, 20, 22] },
];

/** A little random walk, so the live charts have something to say. */
function walk(initial: number[], ms = 900) {
  const data = state<readonly number[]>(initial);
  const timer = setInterval(
    () =>
      data.update((xs) => {
        const next = Math.max(4, Math.min(96, xs[xs.length - 1]! + Math.round(Math.random() * 24 - 12)));
        return [...xs.slice(1), next];
      }),
    ms,
  );
  onCleanup(() => clearInterval(timer));
  return data;
}

export const CHARTS: CatalogGroup = {
  slug: "charts",
  title: "Charts",
  blurb:
    "SVG, no plotting dependency, and a live series costs one `path` rewrite per update — the axes, grid and legend around it never move.",
  items: [
    {
      slug: "line-chart",
      name: "LineChart",
      tier: "T2",
      thesis:
        "New data rewrites the `d` attribute of one `path`. Everything else — axes, grid lines, legend, labels — is built once and left alone, so a chart updating every 100 ms costs one attribute write.",
      summary: "Lines with optional dots and an area fill, over shared scales, a grid and a legend.",
      code: `LineChart({
  series: () => [{ label: "Raptor", values: data() }],
  labels: MONTHS,
  dots: true,
  formatValue: (v) => v + "ms",
});`,
      props: [
        { name: "series", type: "Accessor<readonly Series[]> | Series[]", desc: "label, values, optional colour. An accessor makes it live." },
        { name: "labels", type: "readonly string[]", desc: "X-axis labels; their count is the number of points." },
        { name: "width / height / margin", type: "number / Partial<ChartMargin>", desc: "Drawing box." },
        { name: "grid / legend", type: "boolean", desc: "Both on by default." },
        { name: "summary", type: "string", desc: "The sentence a screen reader gets; the SVG itself is aria-hidden." },
      ],
      demo: () => {
        const live = walk([20, 34, 28, 45, 52, 40, 61, 55]);
        return (
          <div>
            {LineChart({
              series: () => [{ label: "Live", values: [...live()] }],
              labels: ["", "", "", "", "", "", "", ""],
              height: 200,
              dots: true,
              summary: "A live random walk over eight points.",
            })}
            <div class="cmp-row">
              <span class="chip">updating every 900 ms — only the path changes</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "area-chart",
      name: "AreaChart",
      tier: "T2",
      summary: "The same line with the area below it filled — for volumes, where the size under the curve is the point.",
      code: `AreaChart({ series: SERIES, labels: MONTHS });`,
      demo: () => AreaChart({ series: SERIES, labels: MONTHS, height: 200 }),
    },
    {
      slug: "bar-chart",
      name: "BarChart",
      tier: "T2",
      summary: "Bars, grouped or stacked, vertical or horizontal.",
      code: `BarChart({ series: SERIES, labels: MONTHS, stacked: true });`,
      demo: () => {
        const stacked = state(false);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Toggle stacked", size: "sm", onClick: () => stacked.update((v) => !v) })}
            </div>
            {() => BarChart({ series: SERIES, labels: MONTHS, height: 200, stacked: stacked() })}
          </div>
        );
      },
    },
    {
      slug: "sparkline",
      name: "Sparkline",
      tier: "T2",
      thesis:
        "A sparkline is one `polyline` and nothing else — no axes, no legend, no tooltip. Put a hundred of them in a table and each new value is still one attribute write.",
      summary: "A chart small enough to sit inside a sentence or a table cell, with an optional last-point marker.",
      code: `Sparkline({ data: () => series(), width: 120, height: 32, lastPoint: true });`,
      demo: () => {
        const a = walk([30, 42, 38, 55, 48, 62, 58, 71, 66, 74], 700);
        return (
          <div>
            <div class="cmp-row">
              {Sparkline({ data: () => [...a()], width: 140, height: 36, lastPoint: true, label: "Requests per minute" })}
              <span class="chip">
                now <b>{() => String(a()[a().length - 1])}</b>
              </span>
            </div>
            <div class="cmp-row">
              {Sparkline({ data: () => [12, 18, 9, 22, 30, 25, 33], width: 120, height: 30, area: true })}
              <span class="chip">with `area: true`</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "pie-chart",
      name: "PieChart",
      tier: "T3",
      summary: "Parts of a whole, with a legend and per-slice colours. Use it when there are few slices and they really do sum to something.",
      code: `PieChart({ data: [{ label: "core", value: 32 }, …] });`,
      demo: () =>
        PieChart({
          size: 220,
          data: [
            { label: "core", value: 32 },
            { label: "dom", value: 24 },
            { label: "wire", value: 28 },
            { label: "ui", value: 16 },
          ],
          summary: "Share of the bundle by package.",
        }),
    },
    {
      slug: "donut-chart",
      name: "DonutChart",
      tier: "T3",
      summary: "A pie with a hole and a total in the middle — the shape most dashboards actually want.",
      code: `DonutChart({ data, center: total });`,
      demo: () =>
        DonutChart({
          size: 220,
          center: "100%",
          data: [
            { label: "passed", value: 145 },
            { label: "skipped", value: 1 },
            { label: "failed", value: 0 },
          ],
          summary: "Test results.",
        }),
    },
    {
      slug: "scatter-chart",
      name: "ScatterChart",
      tier: "T3",
      summary: "Points in two dimensions — correlation, clusters, outliers.",
      code: `ScatterChart({ series: [{ label: "runs", points: [{ x: 1, y: 2 }, …] }] });`,
      demo: () =>
        ScatterChart({
          height: 220,
          series: [
            {
              label: "Raptor",
              points: Array.from({ length: 24 }, (_, i) => ({ x: i, y: 8 + Math.sin(i / 2) * 6 + Math.random() * 3 })),
            },
            {
              label: "Baseline",
              points: Array.from({ length: 24 }, (_, i) => ({ x: i, y: 14 + Math.cos(i / 3) * 4 + Math.random() * 3 })),
            },
          ],
          summary: "Latency against request index for two runtimes.",
        }),
    },
    {
      slug: "bubble-chart",
      name: "BubbleChart",
      tier: "T3",
      summary: "A scatter plot with a third dimension in the radius.",
      code: `BubbleChart({ series: [{ label: "packages", points: [{ x, y, size }] }] });`,
      demo: () =>
        ScatterChart({
          height: 220,
          bubble: true,
          maxRadius: 22,
          series: [
            {
              label: "Packages",
              points: [
                { x: 6.2, y: 31, size: 31, label: "core" },
                { x: 8.8, y: 24, size: 24, label: "dom" },
                { x: 11.4, y: 38, size: 38, label: "wire-core" },
                { x: 22.9, y: 46, size: 46, label: "ui" },
              ],
            },
          ],
          summary: "Size against test count; the radius repeats the test count.",
        }),
      notes: ["`BubbleChart` is `ScatterChart` with `bubble: true` — same component, one flag."],
    },
    {
      slug: "heatmap",
      name: "Heatmap",
      tier: "T3",
      summary: "A matrix where colour is the value — activity by day and hour, a confusion matrix, a correlation grid.",
      code: `Heatmap({ values, rowLabels: DAYS, colLabels: HOURS });`,
      demo: () =>
        Heatmap({
          cellSize: 26,
          rowLabels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
          colLabels: ["8", "10", "12", "14", "16", "18"],
          values: [
            [2, 8, 14, 9, 6, 1],
            [3, 11, 17, 12, 7, 2],
            [1, 6, 12, 15, 9, 3],
            [4, 13, 19, 14, 8, 2],
            [2, 7, 9, 6, 4, 1],
          ],
          summary: "Commits by weekday and hour.",
        }),
    },
    {
      slug: "gauge",
      name: "Gauge",
      tier: "T3",
      summary: "One number on a dial, with colour thresholds — a speedometer for a service-level indicator.",
      code: `Gauge({ value: () => uptime(), min: 90, max: 100, thresholds: [{ at: 99, color: "#0f6e4f" }] });`,
      demo: () => {
        const v = state(78);
        return (
          <div class="cmp-row">
            {Gauge({
              value: () => v(),
              size: 180,
              label: "CPU",
              format: (n: number) => n + "%",
              thresholds: [
                { at: 0, color: CHART_COLORS[1]! },
                { at: 70, color: "#b45309" },
                { at: 90, color: "#b42318" },
              ],
            })}
            {Button({ children: "−10", size: "sm", onClick: () => v.update((n) => Math.max(0, n - 10)) })}
            {Button({ children: "+10", size: "sm", onClick: () => v.update((n) => Math.min(100, n + 10)) })}
          </div>
        );
      },
    },
    {
      slug: "radar-chart",
      name: "RadarChart",
      tier: "T3",
      summary: "Several measurements on one shape — comparing profiles across the same axes.",
      code: `RadarChart({ axes: ["speed", "size", "memory"], series: [{ label: "Raptor", values: [9, 8, 7] }] });`,
      demo: () =>
        RadarChart({
          size: 260,
          axes: ["create", "update", "select", "swap", "remove", "memory"],
          series: [
            { label: "Raptor", values: [8, 10, 9, 9, 10, 8] },
            { label: "VDOM baseline", values: [8, 5, 6, 6, 5, 6] },
          ],
          summary: "Benchmark profile, higher is better.",
        }),
    },
    {
      slug: "funnel-chart",
      name: "FunnelChart",
      tier: "T3",
      summary: "Stages of a conversion, with the drop-off between them shown as a rate.",
      code: `FunnelChart({ stages, showRate: true });`,
      demo: () =>
        FunnelChart({
          showRate: true,
          stages: [
            { label: "Visited", value: 12400 },
            { label: "Started install", value: 5200 },
            { label: "Ran the demo", value: 2100 },
            { label: "Shipped something", value: 480 },
          ],
          summary: "Funnel from visit to shipped project.",
        }),
    },
    {
      slug: "candlestick-chart",
      name: "CandlestickChart",
      tier: "T3",
      summary: "Open, high, low, close per period — the financial chart, with up and down colours.",
      code: `CandlestickChart({ candles });`,
      demo: () =>
        CandlestickChart({
          height: 220,
          candles: [
            { label: "Mon", open: 18, high: 24, low: 16, close: 22 },
            { label: "Tue", open: 22, high: 26, low: 20, close: 21 },
            { label: "Wed", open: 21, high: 23, low: 15, close: 16 },
            { label: "Thu", open: 16, high: 21, low: 15, close: 20 },
            { label: "Fri", open: 20, high: 28, low: 19, close: 27 },
          ],
          summary: "A week of prices.",
        }),
    },
    {
      slug: "treemap",
      name: "Treemap",
      tier: "T3",
      summary: "Area as value, packed into a rectangle with the squarified layout — bundle contents, disk usage, budgets.",
      code: `Treemap({ items: [{ label: "ui", value: 22.9 }, …] });`,
      demo: () =>
        Treemap({
          width: 460,
          height: 240,
          items: [
            { label: "ui", value: 22.9 },
            { label: "wire-core", value: 11.4 },
            { label: "dom", value: 8.8 },
            { label: "core", value: 6.2 },
            { label: "server", value: 4.1 },
            { label: "bundle", value: 3.3 },
          ],
          summary: "Bundle size by package.",
        }),
    },
    {
      slug: "sankey-diagram",
      name: "SankeyDiagram",
      tier: "T3",
      summary: "Where the volume goes: nodes in columns, flows whose thickness is the value.",
      code: `SankeyDiagram({ nodes, links });`,
      demo: () =>
        SankeyDiagram({
          width: 460,
          height: 240,
          nodes: [
            { key: "visits", label: "Visits" },
            { key: "docs", label: "Docs" },
            { key: "play", label: "Playground" },
            { key: "install", label: "Installed" },
            { key: "left", label: "Left" },
          ],
          links: [
            { from: "visits", to: "docs", value: 60 },
            { from: "visits", to: "play", value: 40 },
            { from: "docs", to: "install", value: 25 },
            { from: "docs", to: "left", value: 35 },
            { from: "play", to: "install", value: 18 },
            { from: "play", to: "left", value: 22 },
          ],
          summary: "Flow from visit to install.",
        }),
    },
    {
      slug: "chart-primitives",
      name: "Chart primitives",
      tier: "T2",
      summary:
        "The pieces every chart above is built from — `scaleLinear`, `scaleBand`, `niceTicks`, `extent`, `Axis`, `Legend`, `CHART_COLORS`. They are exported, so a chart this library does not have is still yours to draw.",
      code: `const x = scaleLinear([0, 100], [0, 400]);
x(50);            // 200
x.ticks(5);       // [0, 25, 50, 75, 100]
x.invert(200);    // 50

niceTicks(0, 93); // [0, 20, 40, 60, 80, 100]`,
      props: [
        { name: "scaleLinear(domain, range)", type: "LinearScale", desc: "Callable scale with ticks() and invert()." },
        { name: "scaleBand(count, range, padding)", type: "BandScale", desc: "Categorical positions with a bandwidth." },
        { name: "niceTicks(min, max, count)", type: "number[]", desc: "Round numbers that cover the range." },
        { name: "Axis / Legend", type: "components", desc: "The rendered axis with grid lines, and the colour key." },
        { name: "CHART_COLORS", type: "string[]", desc: "The default categorical palette." },
      ],
      demo: () => {
        const x = scaleLinear([0, 100], [0, 400]);
        return (
          <div>
            <div class="cmp-row">
              <span class="chip">
                scaleLinear([0,100],[0,400])(50) = <b>{String(x(50))}</b>
              </span>
              <span class="chip">
                .invert(300) = <b>{String(x.invert(300))}</b>
              </span>
            </div>
            <div class="cmp-row">
              <span class="chip">
                niceTicks(0, 93) = <b>{niceTicks(0, 93).join(", ")}</b>
              </span>
            </div>
            <div class="cmp-row">
              {CHART_COLORS.map((c) => (
                <span
                  class="chip"
                  style={"border-color:" + c + ";color:" + c}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        );
      },
    },
  ],
};
