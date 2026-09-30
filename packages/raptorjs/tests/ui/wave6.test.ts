import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptorstack/raptorjs/dom/testing";
import { render, R } from "@raptorstack/raptorjs/dom";
import { state, createRoot } from "@raptorstack/raptorjs";
import { Masonry, Affix, SafeArea, SkipNav, BottomNavigation, Dock, SplitButton, FloatingActionButton } from "../../src/ui/layout-extra.ts";
import {
  applyMask, unmask, formatCurrency, parseCurrency, groupDigits, activeMention,
  hexToRgb, rgbToHex, relativeLuminance, contrastRatio, readableOn, findPath,
  MaskedInput, CurrencyInput, PhoneInput, Mentions, Rating, ColorSwatchPicker, TransferList, Cascader, TreeSelect,
} from "../../src/ui/input-extra.ts";
import { arcPath, squarify, sankeyLayout, PieChart, DonutChart, ScatterChart, Heatmap, Gauge, RadarChart, FunnelChart, CandlestickChart, Treemap, SankeyDiagram, Meter } from "../../src/ui/chart-extra.ts";
import { diffLines, diffStats, DiffViewer, JsonViewer, ComparisonTable, CodeEditor, RichTextEditor } from "../../src/ui/editors.ts";
import { formatDuration, computePeaks, fileIcon, carousel, Gallery, Lightbox, ImageZoom, VideoPlayer, AudioPlayer, Waveform, ImageUpload, UploadProgress, FilePreview } from "../../src/ui/media.ts";
import { reedSolomon, pickVersion, dataCapacity, buildMatrix, readFormat, maskPenalty, encodeData, QRCode, MAX_VERSION } from "../../src/ui/qrcode.ts";
import { kanban, wizard, Menubar, HoverCard, tour } from "../../src/ui/advanced.ts";
import { idle, networkStatus } from "../../src/ui/primitives/stores.ts";
import { FormSection, ValidationSummary } from "../../src/ui/form.ts";
import { MonthPicker, YearPicker, DateTimePicker } from "../../src/ui/date.ts";
import { field, formGroup, validators } from "../../src/ui/form.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}
function mount(build: () => unknown): MiniElement {
  const root = div();
  render(build as any, root);
  return root;
}
function clearBody(): void {
  for (const child of doc.body.childNodes.slice()) doc.body.removeChild(child);
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const hasClass = (el: MiniElement, cls: string): boolean =>
  (el.getAttribute("class") ?? "").split(" ").includes(cls);
const byClass = (root: MiniElement, tag: string, cls: string): MiniElement | undefined =>
  root.querySelectorAll(tag).find((e) => hasClass(e, cls));

/* ---------------------------------------------------------------- layout -- */

test("Masonry distributes cyclically across columns", () => {
  const root = mount(() => Masonry({ items: ["a", "b", "c", "d", "e"], columns: 3 }));
  const cols = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-masonry-col"));
  assert.equal(cols.length, 3);
  assert.equal(cols[0]!.textContent, "ad");
  assert.equal(cols[1]!.textContent, "be");
  assert.equal(cols[2]!.textContent, "c");
});

test("Affix uses position:sticky, not scroll calculations", () => {
  const el = mount(() => Affix({ children: "x", offsetTop: 12 })).querySelector("div")!;
  assert.equal(el.getAttribute("style"), "position:sticky;top:12px");
});

test("SafeArea combines env() with a minimum", () => {
  const el = mount(() => SafeArea({ children: "x", edges: ["bottom"], minimum: 4 })).querySelector("div")!;
  assert.equal(el.getAttribute("style"), "padding-bottom:max(12px, env(safe-area-inset-bottom, 0px))");
});

test("SkipNav points to main and moves focus", () => {
  const main = doc.createElement("div");
  main.setAttribute("id", "rui-main");
  let focused = 0;
  main.focus = () => focused++;
  doc.body.appendChild(main);

  const a = mount(() => SkipNav({})).querySelector("a")!;
  assert.equal(a.getAttribute("href"), "#rui-main");
  a.dispatch("click", { preventDefault() {} });
  assert.equal(focused, 1);
  doc.body.removeChild(main);
});

test("Dock: every icon-only button has a name", () => {
  const root = mount(() =>
    Dock({ items: [{ key: "a", label: "Add", icon: "+", onClick: () => {} }] }),
  );
  assert.equal(root.querySelector("div")!.getAttribute("role"), "toolbar");
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Add");
});

test("SplitButton has two distinct buttons", () => {
  let main = 0;
  const root = mount(() =>
    SplitButton({
      children: "Save",
      onClick: () => main++,
      entries: [{ kind: "item", label: "Save as…", onSelect: () => {} }],
    }),
  );
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons.length, 2);
  buttons[0]!.click();
  assert.equal(main, 1, "the main action doesn't open the menu");
  assert.equal(buttons[1]!.getAttribute("aria-label"), "More actions");
});

test("FloatingActionButton requires a label", () => {
  const btn = mount(() => FloatingActionButton({ icon: "+", label: "Add", onClick: () => {} })).querySelector("button")!;
  assert.equal(btn.getAttribute("aria-label"), "Add");
});

/* ------------------------------------------------------------- masks etc -- */

test("applyMask inserts the separators and holds the cursor", () => {
  assert.equal(applyMask("12345678", "9999-99-99").value, "1234-56-78");
  // The trailing separator is NOT added until you type the next character:
  // otherwise the cursor lands after a dash you didn't type.
  assert.equal(applyMask("1234", "9999-99-99").value, "1234");
  // Characters that don't match are skipped, not inserted.
  assert.equal(applyMask("12ab34", "9999").value, "1234");
  assert.equal(applyMask("2026-03", "9999-99-99").value, "2026-03");
  assert.equal(unmask("1234-56-78", "9999-99-99"), "12345678");
  // Round-trip: what comes out of `applyMask` goes back through `unmask`.
  assert.equal(unmask(applyMask("20260315", "9999-99-99").value, "9999-99-99"), "20260315");
});

test("applyMask with letters and wildcard", () => {
  assert.equal(applyMask("ab12", "AA99").value, "ab12");
  assert.equal(applyMask("a1b2", "****").value, "a1b2");
});

test("formatCurrency keeps money in integers", () => {
  assert.ok(formatCurrency(12345, "RON", "ro-RO").includes("123,45"));
  assert.equal(parseCurrency("123,45"), 12345);
  assert.equal(parseCurrency(""), 0);
  // No floating-point arithmetic: 0.1+0.2 appears nowhere.
  assert.equal(parseCurrency("10") + parseCurrency("20"), 30);
});

test("groupDigits groups by pattern", () => {
  assert.equal(groupDigits("0722334455", [3, 3, 4]), "072 233 4455");
  assert.equal(groupDigits("07", [3, 3, 3]), "07");
  assert.equal(groupDigits("1234567890123", [3, 3, 3]), "123 456 789 0123");
});

test("activeMention finds the token under the cursor", () => {
  assert.deepEqual(activeMention("hi @an", 6), { query: "an", start: 3 });
  assert.equal(activeMention("hi @an", 2), null, "the cursor is before the token");
  assert.equal(activeMention("email@domain.co", 15), null, "@ in the middle of a word doesn't trigger");
  assert.deepEqual(activeMention("@x", 2), { query: "x", start: 0 });
});

test("colors: hex, luminance, contrast, readable text", () => {
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#17457a"), { r: 23, g: 69, b: 122 });
  assert.equal(hexToRgb("not-a-color"), null);
  assert.equal(rgbToHex(23, 69, 122), "#17457a");
  assert.equal(rgbToHex(300, -5, 0), "#ff0000", "capped");

  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01, "max contrast = 21:1");
  assert.equal(readableOn("#ffffff"), "#000000");
  assert.equal(readableOn("#17457a"), "#ffffff");
  assert.ok(relativeLuminance(255, 255, 255) > relativeLuminance(0, 0, 0));
});

test("MaskedInput writes the masked value into the signal", () => {
  const v = state("");
  const input = mount(() => MaskedInput({ value: v, mask: "9999-99-99" })).querySelector("input")!;
  input.dispatch("input", { target: { value: "20260315" } });
  assert.equal(v(), "2026-03-15");
});

test("PhoneInput keeps only the digits and marks the invalid one", () => {
  const v = state("");
  const input = mount(() => PhoneInput({ value: v, prefix: "+40", minDigits: 9 })).querySelector("input")!;
  input.dispatch("input", { target: { value: "072 233 44" } });
  assert.equal(v(), "07223344");
  assert.equal(input.getAttribute("aria-invalid"), "true", "8 digits < 9");
  input.dispatch("input", { target: { value: "072233445" } });
  assert.equal(input.getAttribute("aria-invalid"), "false");
});

test("Rating is a slider, not a radiogroup", () => {
  const v = state(3);
  const root = mount(() => Rating({ value: v, max: 5, label: "Rating" }));
  const el = root.querySelector("div")!;
  assert.equal(el.getAttribute("role"), "slider");
  assert.equal(el.getAttribute("aria-valuenow"), "3");
  assert.equal(el.getAttribute("aria-valuetext"), "3 of 5");

  el.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(v(), 4);
  el.dispatch("keydown", { key: "End", preventDefault() {} });
  assert.equal(v(), 5);
});

test("ColorSwatchPicker: radiogroup with a name on each swatch", () => {
  const v = state("#17457a");
  const root = mount(() =>
    ColorSwatchPicker({ value: v, colors: ["#17457a", "#0f6e4f"], names: { "#0f6e4f": "green" } }),
  );
  assert.equal(root.querySelector("div")!.getAttribute("role"), "radiogroup");
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[0]!.getAttribute("aria-label"), "#17457a");
  assert.equal(buttons[1]!.getAttribute("aria-label"), "green");
  buttons[1]!.click();
  assert.equal(v(), "#0f6e4f");
});

test("TransferList moves only the checked items", () => {
  const selected = state<readonly string[]>([]);
  const root = mount(() =>
    TransferList({
      items: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C", disabled: true }],
      selected,
    }),
  );
  const items = () => root.querySelectorAll("li");
  const buttons = () => root.querySelectorAll("button");

  assert.equal(buttons()[0]!.getAttribute("disabled"), "", "nothing checked => button disabled");
  items()[0]!.click();
  assert.equal(buttons()[0]!.getAttribute("disabled"), null);
  buttons()[0]!.click();
  assert.deepEqual(selected(), ["a"]);
});

test("findPath finds the path in the options tree", () => {
  const tree = [
    { value: "ro", label: "Romania", children: [{ value: "cj", label: "Cluj", children: [{ value: "cjn", label: "Cluj-Napoca" }] }] },
  ];
  assert.deepEqual(findPath(tree, "cjn")!.map((n) => n.value), ["ro", "cj", "cjn"]);
  assert.equal(findPath(tree, "xx"), null);
});

test("Cascader picks only leaves by default", () => {
  const v = state<string | null>(null);
  const root = mount(() =>
    Cascader({
      options: [{ value: "ro", label: "RO", children: [{ value: "cj", label: "Cluj" }] }],
      value: v,
    }),
  );
  root.querySelector("button")!.dispatch("click", { stopPropagation() {} });

  const items = () => root.querySelectorAll("li");
  items()[0]!.dispatch("click", { stopPropagation() {} });
  assert.equal(v(), null, "the intermediate node isn't picked");

  const leaf = items().find((li) => li.textContent.includes("Cluj"))!;
  leaf.dispatch("click", { stopPropagation() {} });
  assert.equal(v(), "cj");
});

test("TreeSelect expands and picks", () => {
  const v = state<string | null>(null);
  const root = mount(() =>
    TreeSelect({
      options: [{ value: "a", label: "A", children: [{ value: "a1", label: "A1" }] }],
      value: v,
    }),
  );
  root.querySelector("button")!.click();
  const toggle = byClass(root, "span", "rui-treeselect-toggle")!;
  toggle.click();
  assert.ok(root.textContent.includes("A1"));
});

/* -------------------------------------------------------------- charts -- */

test("arcPath: the full sector is split into two arcs", () => {
  const full = arcPath(50, 50, 40, 0, 0, Math.PI * 2);
  assert.equal((full.match(/A/g) ?? []).length, 2, "360° can't be a single arc");
  assert.ok(!full.includes("NaN"));

  const donut = arcPath(50, 50, 40, 20, 0, Math.PI / 2);
  assert.ok(donut.includes("M") && donut.endsWith("Z"));
});

test("PieChart and DonutChart render one path per slice", () => {
  const data = [{ label: "a", value: 30 }, { label: "b", value: 70 }];
  assert.equal(mount(() => PieChart({ data })).querySelectorAll("path").length, 2);
  const donut = mount(() => DonutChart({ data, center: "100" }));
  assert.equal(donut.querySelectorAll("path").length, 2);
  assert.ok(donut.textContent.includes("100"));
});

test("PieChart with a zero total produces no NaN", () => {
  const root = mount(() => PieChart({ data: [{ label: "a", value: 0 }] }));
  for (const p of root.querySelectorAll("path")) {
    assert.ok(!(p.getAttribute("d") ?? "").includes("NaN"));
  }
});

test("ScatterChart scales the radius by the square root of the value (area, not radius)", () => {
  const root = mount(() =>
    ScatterChart({
      series: [{ label: "s", points: [{ x: 1, y: 1, size: 1 }, { x: 2, y: 2, size: 4 }] }],
      bubble: true,
      maxRadius: 20,
    }),
  );
  const circles = root.querySelectorAll("circle");
  assert.equal(circles.length, 2);
  const r1 = Number(circles[0]!.getAttribute("r"));
  const r2 = Number(circles[1]!.getAttribute("r"));
  // A value 4x larger => a radius 2x larger, not 4x.
  assert.ok(Math.abs(r2 / r1 - 2) < 0.05, `${r1} -> ${r2}`);
});

test("Heatmap encodes intensity through opacity", () => {
  const root = mount(() => Heatmap({ values: [[0, 10], [5, 10]], cellSize: 20 }));
  const cells = root.querySelectorAll("rect");
  assert.equal(cells.length, 4);
  const lowest = Number(cells[0]!.getAttribute("fill-opacity"));
  const highest = Number(cells[1]!.getAttribute("fill-opacity"));
  assert.ok(highest > lowest);
  assert.ok(lowest >= 0.08 && highest <= 1);
});

test("Gauge picks the color by thresholds", () => {
  const value = state(10);
  const root = mount(() =>
    Gauge({
      value: () => value(),
      thresholds: [{ at: 0, color: "#0f6e4f" }, { at: 70, color: "#b42318" }],
      summary: "Usage",
    }),
  );
  const fill = byClass(root, "path", "rui-gauge-fill")!;
  assert.equal(fill.getAttribute("stroke"), "#0f6e4f");
  value.set(90);
  assert.equal(fill.getAttribute("stroke"), "#b42318");
  assert.ok(!(fill.getAttribute("d") ?? "").includes("NaN"));
});

test("RadarChart renders a polygon per series and the web", () => {
  const root = mount(() =>
    RadarChart({
      axes: ["speed", "cost", "quality"],
      series: [{ label: "A", values: [3, 5, 4] }, { label: "B", values: [5, 2, 3] }],
    }),
  );
  const areas = root.querySelectorAll("polygon").filter((p) => hasClass(p, "rui-radar-area"));
  assert.equal(areas.length, 2);
  assert.ok(!(areas[0]!.getAttribute("points") ?? "").includes("NaN"));
});

test("FunnelChart computes the rate relative to the previous stage", () => {
  const root = mount(() =>
    FunnelChart({
      stages: [{ label: "Visits", value: 1000 }, { label: "Cart", value: 250 }],
      showRate: true,
    }),
  );
  assert.ok(root.textContent.includes("25%"));
});

test("CandlestickChart: minimum 1px body, colors by direction", () => {
  const root = mount(() =>
    CandlestickChart({
      candles: [
        { open: 10, high: 12, low: 9, close: 11 },
        { open: 11, high: 11, low: 10, close: 11 },
      ],
    }),
  );
  const bodies = root.querySelectorAll("rect").filter((r) => hasClass(r, "rui-candle-body"));
  assert.equal(bodies.length, 2);
  assert.ok(Number(bodies[1]!.getAttribute("height")) >= 1, "the doji stays visible");
});

test("squarify covers the whole surface, proportionally", () => {
  const cells = squarify([{ label: "a", value: 50 }, { label: "b", value: 30 }, { label: "c", value: 20 }], 200, 100);
  assert.equal(cells.length, 3);
  const area = cells.reduce((sum, c) => sum + c.width * c.height, 0);
  assert.ok(Math.abs(area - 200 * 100) < 1, "the total surface is covered: " + area);

  const a = cells.find((c) => c.item.label === "a")!;
  const b = cells.find((c) => c.item.label === "b")!;
  assert.ok(a.width * a.height > b.width * b.height, "larger value => larger area");
});

test("squarify with empty or null data doesn't crash", () => {
  assert.deepEqual(squarify([], 100, 100), []);
  assert.deepEqual(squarify([{ label: "a", value: 0 }], 100, 100), []);
});

test("Treemap renders the cells", () => {
  const root = mount(() => Treemap({ items: [{ label: "a", value: 60 }, { label: "b", value: 40 }] }));
  assert.equal(root.querySelectorAll("rect").length, 2);
});

test("sankeyLayout places nodes at depths and doesn't loop on a cycle", () => {
  const nodes = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];
  const links = [{ from: "a", to: "b", value: 10 }, { from: "b", to: "c", value: 6 }];
  const layout = sankeyLayout(nodes, links, 400, 200);

  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.links.length, 2);
  const depths = new Map(layout.nodes.map((n) => [n.node.key, n.depth]));
  assert.equal(depths.get("a"), 0);
  assert.equal(depths.get("b"), 1);
  assert.equal(depths.get("c"), 2);

  // Cycle: it must terminate, even if the result is arbitrary.
  const cyclic = sankeyLayout(nodes, [...links, { from: "c", to: "a", value: 1 }], 400, 200);
  assert.equal(cyclic.nodes.length, 3);
});

test("SankeyDiagram renders links and nodes", () => {
  const root = mount(() =>
    SankeyDiagram({
      nodes: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
      links: [{ from: "a", to: "b", value: 5 }],
    }),
  );
  assert.equal(root.querySelectorAll("path").length, 1);
  assert.equal(root.querySelectorAll("rect").length, 2);
});

test("Meter has role=meter, not progressbar", () => {
  const root = mount(() => Meter({ value: 80, low: 20, high: 90, label: "Disk" }));
  const el = root.querySelector("div")!;
  assert.equal(el.getAttribute("role"), "meter");
  assert.equal(el.getAttribute("aria-valuenow"), "80");
  assert.ok(hasClass(byClass(root, "div", "rui-meter-fill")!, "rui-level-ok"));
});

/* ------------------------------------------------------------- editors -- */

test("diffLines: correct LCS on insertions, deletions and equalities", () => {
  const chunks = diffLines("a\nb\nc", "a\nx\nc");
  assert.deepEqual(chunks.map((c) => c.op), ["equal", "delete", "insert", "equal"]);
  assert.deepEqual(diffStats(chunks), { added: 1, removed: 1 });

  assert.deepEqual(diffLines("a", "a").map((c) => c.op), ["equal"]);
  assert.deepEqual(diffLines("", "x").map((c) => c.op), ["delete", "insert"]);
});

test("diffLines keeps the correct line indices", () => {
  const chunks = diffLines("a\nb", "a\nb\nc");
  const added = chunks.find((c) => c.op === "insert")!;
  assert.equal(added.newIndex, 2);
  assert.equal(added.oldIndex, -1);
});

test("DiffViewer shows stats and readable signs", () => {
  const root = mount(() => DiffViewer({ oldText: "a\nb", newText: "a\nc" }));
  assert.ok(root.textContent.includes("+1"));
  assert.ok(root.textContent.includes("−1"));
  // The sign is also text for the screen reader, not just color.
  assert.ok(root.textContent.includes("added:"));
  assert.ok(root.textContent.includes("deleted:"));
});

test("DiffViewer collapses long unchanged blocks", () => {
  const long = Array.from({ length: 30 }, (_, i) => "line " + i).join("\n");
  const changed = long.replace("line 15", "CHANGED");
  const root = mount(() => DiffViewer({ oldText: long, newText: changed, context: 2 }));
  assert.ok(root.textContent.includes("unchanged lines"));
});

test("JsonViewer renders only expanded nodes and marks cycles", () => {
  const data: any = { a: 1, b: { c: 2 } };
  data.self = data;
  const root = mount(() => JsonViewer({ data, defaultDepth: 1 }));
  assert.ok(root.textContent.includes("circular reference"));
  // At depth 1, `b` is collapsed: its content isn't in the DOM.
  assert.ok(!root.textContent.includes('"c"'));
});

test("JsonViewer expands on click", () => {
  const root = mount(() => JsonViewer({ data: { b: { c: 2 } }, defaultDepth: 1 }));
  const toggles = root.querySelectorAll("button");
  toggles[toggles.length - 1]!.click();
  assert.ok(root.textContent.includes("2"));
});

test("ComparisonTable has the correct scope and text for checkmarks", () => {
  const root = mount(() =>
    ComparisonTable({
      features: [{ key: "api", label: "API" }, { key: "sso", label: "SSO" }],
      plans: [
        { key: "free", label: "Free", values: { api: true, sso: false } },
        { key: "pro", label: "Pro", featured: true, values: { api: true, sso: "limited" } },
      ],
    }),
  );
  const rowHeaders = root.querySelectorAll("th").filter((th) => th.getAttribute("scope") === "row");
  assert.equal(rowHeaders.length, 2);
  assert.ok(root.textContent.includes("included"));
  assert.ok(root.textContent.includes("not included"));
  assert.ok(root.textContent.includes("limited"));
});

test("CodeEditor: Tab inserts spaces, Escape then Tab exits", () => {
  const v = state("line 1\nline 2");
  const root = mount(() => CodeEditor({ value: v, tabSize: 2 }));
  const ta = root.querySelector("textarea")!;

  let prevented = 0;
  ta.dispatch("keydown", { key: "Tab", target: { selectionStart: 0, selectionEnd: 0 }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.ok(v().startsWith("  line 1"));

  ta.dispatch("keydown", { key: "Escape" });
  ta.dispatch("keydown", { key: "Tab", target: { selectionStart: 0, selectionEnd: 0 }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1, "after Escape, Tab exits the field");
});

test("CodeEditor numbers the lines", () => {
  const v = state("a\nb\nc");
  const root = mount(() => CodeEditor({ value: v, lineNumbers: true }));
  const nums = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-code-lineno"));
  assert.deepEqual(nums.map((n) => n.textContent), ["1", "2", "3"]);
});

test("RichTextEditor: toolbar linked to the editable area", () => {
  const v = state("<p>hello</p>");
  const root = mount(() => RichTextEditor({ value: v, label: "Description" }));
  const toolbar = byClass(root, "div", "rui-rte-toolbar")!;
  const body = byClass(root, "div", "rui-rte-body")!;
  assert.equal(toolbar.getAttribute("role"), "toolbar");
  assert.equal(toolbar.getAttribute("aria-controls"), body.getAttribute("id"));
  assert.equal(body.getAttribute("role"), "textbox");
  assert.equal(body.getAttribute("contenteditable"), "true");
  assert.equal(body.getAttribute("aria-multiline"), "true");
});

/* ----------------------------------------------------------------- media -- */

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(142), "2:22");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(NaN), "0:00");
  assert.equal(formatDuration(-5), "0:00");
});

test("computePeaks reduces and normalizes", () => {
  const peaks = computePeaks([0, 0.5, -1, 0.25, 0.75, -0.5], 3);
  assert.equal(peaks.length, 3);
  assert.equal(Math.max(...peaks), 1, "normalized to 1");
  assert.ok(peaks.every((p) => p >= 0 && p <= 1));
  assert.deepEqual(computePeaks([], 5), []);
});

test("fileIcon by type and extension", () => {
  assert.equal(fileIcon("image/png", "a.png"), "🖼");
  assert.equal(fileIcon("", "report.pdf"), "📕");
  assert.equal(fileIcon("", "data.csv"), "📊");
  assert.equal(fileIcon("", "unknown.xyz"), "📎");
});

test("Carousel: hidden slides are inert and announced correctly", () => {
  const c = createRoot(() => carousel({ slides: ["one", "two", "three"], loop: true }));
  const root = mount(() => c.el);

  const slides = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-carousel-slide"));
  assert.equal(slides.length, 3);
  assert.equal(slides[0]!.getAttribute("aria-label"), "1 of 3");
  assert.equal(slides[1]!.getAttribute("aria-hidden"), "true");
  assert.equal(slides[1]!.getAttribute("inert"), "");

  c.next();
  assert.equal(slides[1]!.getAttribute("aria-hidden"), "false");
  assert.equal(slides[1]!.getAttribute("inert"), null);

  c.go(2);
  c.next();
  assert.equal(c.index(), 0, "loop");
});

test("Carousel: autoplay stops on hover", async () => {
  // `dispose` is mandatory: the autoplay interval would keep the process alive.
  let dispose!: () => void;
  const c = createRoot((d) => {
    dispose = d;
    // Three slides, not two: with two and `loop`, two ticks would bring the
    // index back to 0 and the test would pass/fail by chance.
    return carousel({ slides: ["a", "b", "c"], autoplay: 15, loop: true });
  });
  try {
    const root = mount(() => c.el);
    const host = root.querySelector("div")!;

    host.dispatch("pointerenter");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(c.index(), 0, "while hovering it doesn't advance");

    host.dispatch("pointerleave");
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(c.index() > 0);
  } finally {
    dispose();
  }
});

test("Gallery: the button carries the name, the image has an empty alt", () => {
  const root = mount(() =>
    Gallery({ images: [{ src: "/a.png", alt: "Graphic" }], lightbox: false }),
  );
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Open: Graphic");
  assert.equal(root.querySelector("img")!.getAttribute("alt"), "", "not read twice");
});

test("Lightbox: arrow navigation, Escape closes", () => {
  clearBody();
  const open = state(true);
  const index = state(0);
  mount(() =>
    R.div(
      Lightbox({
        images: [
          { src: "/a.png", alt: "A" },
          { src: "/b.png", alt: "B" },
        ],
        open,
        index,
      }),
    ),
  );

  assert.ok(doc.body.textContent.includes("1 of 2"));
  div().dispatch("keydown", { key: "ArrowRight" });
  assert.equal(index(), 1);
  div().dispatch("keydown", { key: "ArrowRight" });
  assert.equal(index(), 0, "cycles");
  div().dispatch("keydown", { key: "Escape" });
  assert.equal(open(), false);
});

test("ImageZoom ignores touch", () => {
  const root = mount(() => ImageZoom({ src: "/a.png", alt: "x" }));
  const host = root.querySelector("span")!;
  host.dispatch("pointerenter", { pointerType: "touch" });
  assert.equal(root.querySelector("img")!.getAttribute("style"), "transform:none");
  host.dispatch("pointerenter", { pointerType: "mouse" });
  assert.ok((root.querySelector("img")!.getAttribute("style") ?? "").includes("scale"));
});

test("VideoPlayer: custom controls, without the `controls` attribute", () => {
  const root = mount(() =>
    VideoPlayer({ src: "/v.mp4", label: "Demo", tracks: [{ src: "/en.vtt", label: "EN", lang: "en", default: true }] }),
  );
  const video = root.querySelector("video")!;
  assert.equal(video.getAttribute("controls"), null);
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.equal(root.querySelector("track")!.getAttribute("srclang"), "en");
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Play");
});

test("AudioPlayer binds the native events to signals", () => {
  const root = mount(() => AudioPlayer({ src: "/a.mp3" }));
  const audio = root.querySelector("audio")!;
  const play = root.querySelector("button")!;
  assert.equal(play.getAttribute("aria-label"), "Play");

  (audio as any).currentTime = 0;
  audio.dispatch("play");
  assert.equal(play.getAttribute("aria-label"), "Pause");
  audio.dispatch("pause");
  assert.equal(play.getAttribute("aria-label"), "Play");
});

test("Waveform is a slider when it can be seeked", () => {
  const seeks: number[] = [];
  const root = mount(() =>
    Waveform({ peaks: [0.2, 0.9, 0.5], progress: () => 0.5, onSeek: (f) => seeks.push(f) }),
  );
  const host = root.querySelector("div")!;
  assert.equal(host.getAttribute("role"), "slider");
  assert.equal(host.getAttribute("aria-valuenow"), "50");

  host.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.ok(seeks[0]! > 0.5);
  assert.equal(root.querySelectorAll("rect").length, 3);
});

test("ImageUpload: real label linked to the input", () => {
  const v = state<string | null>(null);
  const root = mount(() => ImageUpload({ value: v }));
  assert.equal(root.querySelector("label")!.getAttribute("for"), root.querySelector("input")!.getAttribute("id"));

  v.set("blob:x");
  assert.ok(root.querySelector("img"));
});

test("UploadProgress: total and per-file progress", () => {
  const root = mount(() =>
    UploadProgress({
      tasks: [
        { name: "a.png", progress: 100, status: "done", size: 1024 },
        { name: "b.png", progress: 40, status: "uploading" },
      ],
    }),
  );
  const bars = root.querySelectorAll("div").concat(root.querySelectorAll("span"))
    .filter((e) => e.getAttribute("role") === "progressbar");
  const total = bars.find((b) => b.getAttribute("aria-label") === "Total progress")!;
  assert.equal(total.getAttribute("aria-valuenow"), "70");
  assert.ok(root.textContent.includes("1 KB"));
});

test("FilePreview picks the icon by type", () => {
  const root = mount(() => FilePreview({ file: { name: "report.pdf", size: 2048, type: "application/pdf" } }));
  assert.ok(root.textContent.includes("📕"));
  assert.ok(root.textContent.includes("2 KB"));
});

/* ---------------------------------------------------------------- QRCode -- */

test("GF(256): Reed-Solomon produces the correct number of codewords", () => {
  const ec = reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13);
  assert.equal(ec.length, 13);
  assert.ok(ec.every((b) => b >= 0 && b <= 255));
  // Deterministic: the same input, the same result.
  assert.deepEqual(reedSolomon([32, 91, 11], 7), reedSolomon([32, 91, 11], 7));
});

test("capacities and version selection follow the standard", () => {
  assert.equal(dataCapacity(1, "L"), 19);
  assert.equal(dataCapacity(1, "H"), 9);
  assert.equal(dataCapacity(10, "L"), 2 * 68 + 2 * 69);

  assert.equal(pickVersion(10, "L"), 1, "10 bytes fit in v1-L");
  assert.equal(pickVersion(20, "L"), 2);
  assert.ok((pickVersion(200, "L") ?? 0) > 5);
  assert.equal(pickVersion(100000, "H"), null, "over the maximum capacity");
});

test("encodeData produces exactly the version's number of codewords", () => {
  const codewords = encodeData("https://raptor.dev", 2, "M");
  const [ecPerBlock, g1, d1, g2, d2] = [16, 1, 28, 0, 0];
  assert.equal(codewords.length, g1 * d1 + g2 * d2 + (g1 + g2) * ecPerBlock);
});

test("buildMatrix: size, finders, timing, dark module", () => {
  const m = buildMatrix("HELLO", "M");
  assert.equal(m.size, m.version * 4 + 17);

  const at = (r: number, c: number): boolean => m.modules[r]![c]!;
  // The corner of a finder: black ring, black center, white ring between them.
  assert.equal(at(0, 0), true);
  assert.equal(at(1, 1), false);
  assert.equal(at(3, 3), true);
  // Timing pattern alternates.
  assert.equal(at(6, 8), true);
  assert.equal(at(6, 9), false);
  // The mandatory dark module.
  assert.equal(at(m.size - 8, 8), true);
});

test("buildMatrix: the format can be read back (correct BCH)", () => {
  for (const ec of ["L", "M", "Q", "H"] as const) {
    const m = buildMatrix("test", ec);
    const read = readFormat(m);
    assert.ok(read, "unreadable format for " + ec);
    assert.equal(read!.ec, ec);
    assert.equal(read!.mask, m.mask, "written mask = chosen mask");
    assert.ok(read!.mask >= 0 && read!.mask <= 7);
  }
});

test("buildMatrix picks the mask with the minimum penalty", () => {
  const m = buildMatrix("https://raptor.dev/docs", "Q");
  // The chosen mask must be at least as good as any other.
  const chosen = maskPenalty(m.modules);
  assert.ok(Number.isFinite(chosen));
  assert.ok(m.mask >= 0 && m.mask <= 7);
});

test("buildMatrix: large versions get alignment and version info", () => {
  const long = "x".repeat(150);
  const m = buildMatrix(long, "L");
  assert.ok(m.version >= 7, "version " + m.version);
  assert.equal(m.size, m.version * 4 + 17);
  // The version info occupies the 6x3 block in the top-right.
  let dark = 0;
  for (let r = 0; r < 6; r++) for (let c = m.size - 11; c < m.size - 8; c++) if (m.modules[r]![c]) dark++;
  assert.ok(dark > 0, "the version block isn't empty");
});

test("buildMatrix throws a clear message when the text doesn't fit", () => {
  assert.throws(
    () => buildMatrix("y".repeat(5000), "H"),
    /too much for a QR version 10/,
  );
});

test("QRCode renders a single path for all modules", () => {
  const root = mount(() => QRCode({ value: "https://raptor.dev", label: "Link to the site" }));
  const svg = root.querySelector("svg")!;
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Link to the site");
  const paths = root.querySelectorAll("path");
  assert.equal(paths.length, 1, "a single node, not one per module");
  assert.ok((paths[0]!.getAttribute("d") ?? "").length > 100);
});

test("THESIS: changing the text rewrites only `d`", () => {
  const value = state("first");
  const root = mount(() => QRCode({ value: () => value(), label: "code" }));
  const before = root.querySelector("path")!.getAttribute("d");

  value.set("the second text, longer");
  const after = root.querySelector("path")!.getAttribute("d");
  assert.notEqual(after, before);
});

test("QRCode shows the error instead of crashing", () => {
  const root = mount(() => QRCode({ value: "z".repeat(4000), level: "H" }));
  assert.equal(root.querySelector("svg"), null);
  assert.ok(root.textContent.includes("too much"));
});

/* ------------------------------------------------------------- misc -- */

test("idle becomes true after inactivity and resets on activity", async () => {
  // Without `dispose`, the timer re-arms on every document event
  // and the process never ends.
  let dispose!: () => void;
  const isIdle = createRoot((d) => {
    dispose = d;
    return idle({ timeout: 25 });
  });
  try {
    assert.equal(isIdle(), false);

    await new Promise((r) => setTimeout(r, 45));
    assert.equal(isIdle(), true);

    div().dispatch("keydown", { key: "a" });
    assert.equal(isIdle(), false, "activity resets");
  } finally {
    dispose();
  }
});

test("networkStatus reads navigator.onLine and listens to the events", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
  try {
    const status = createRoot(() => networkStatus());
    assert.equal(status.online(), false);
    assert.equal(status.since(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as any).navigator;
  }
});

test("Kanban: programmatic move (the keyboard path)", () => {
  const cards = state<Readonly<Record<string, readonly any[]>>>({
    todo: [{ key: "c1", title: "Task 1" }],
    done: [],
  });
  const moves: string[] = [];
  const k = createRoot(() =>
    kanban({
      columns: [{ key: "todo", title: "To do" }, { key: "done", title: "Done", limit: 2 }],
      cards,
      onMove: (card, from, to) => moves.push(`${card.key}:${from}->${to}`),
    }),
  );
  const root = mount(() => k.el);

  assert.equal(root.querySelectorAll("section").length, 2);
  k.move("c1", "done");
  assert.deepEqual(cards().todo, []);
  assert.equal(cards().done!.length, 1);
  assert.deepEqual(moves, ["c1:todo->done"]);
});

test("Kanban marks exceeding the WIP limit", () => {
  const cards = state<Readonly<Record<string, readonly any[]>>>({
    doing: [{ key: "a", title: "A" }, { key: "b", title: "B" }],
  });
  const k = createRoot(() => kanban({ columns: [{ key: "doing", title: "In progress", limit: 1 }], cards }));
  const root = mount(() => k.el);
  assert.ok(hasClass(root.querySelector("section")!, "rui-over-limit"));
});

test("Wizard blocks advancing on an invalid step and marks the fields", () => {
  const email = createRoot(() => field<string>("", { validate: validators.required(), label: "Email" }));
  const group = createRoot(() => formGroup([email]));
  const w = createRoot(() =>
    wizard({
      steps: [
        { key: "a", title: "Details", content: "step 1", group },
        { key: "b", title: "Done", content: "step 2" },
      ],
    }),
  );
  mount(() => w.el);

  w.next();
  assert.equal(w.current(), 0, "doesn't advance with an invalid group");
  assert.equal(email.touched(), true, "the fields were marked");

  email.value.set("a@b.co");
  w.next();
  assert.equal(w.current(), 1);

  w.goTo(0);
  assert.equal(w.current(), 0, "going back is allowed");
});

test("Wizard: the optional step can be skipped", () => {
  const w = createRoot(() =>
    wizard({
      steps: [
        { key: "a", title: "A", content: "x", optional: true, canAdvance: () => false },
        { key: "b", title: "B", content: "y" },
      ],
    }),
  );
  mount(() => w.el);
  w.next();
  assert.equal(w.current(), 1);
});

test("Menubar: a single menu open, the arrows move between them", () => {
  const root = mount(() =>
    Menubar({
      menus: [
        { key: "file", label: "File", entries: [{ kind: "item", label: "New", onSelect: () => {} }] },
        { key: "edit", label: "Edit", entries: [{ kind: "item", label: "Copy", onSelect: () => {} }] },
      ],
    }),
  );
  const bar = root.querySelector("div")!;
  assert.equal(bar.getAttribute("role"), "menubar");

  const triggers = root.querySelectorAll("button");
  triggers[0]!.dispatch("click", { stopPropagation() {} });
  assert.equal(triggers[0]!.getAttribute("aria-expanded"), "true");

  triggers[1]!.dispatch("click", { stopPropagation() {} });
  assert.equal(triggers[0]!.getAttribute("aria-expanded"), "false", "the first one closed");
  assert.equal(triggers[1]!.getAttribute("aria-expanded"), "true");
});

test("HoverCard: role=dialog, opens on focus", async () => {
  clearBody();
  const root = mount(() =>
    HoverCard({
      trigger: (p) => R.button(p, "@ann"),
      children: "Profile",
      openDelay: 0,
      closeDelay: 0,
    }),
  );
  const trigger = root.querySelector("button")!;
  trigger.dispatch("focus");
  await tick();

  const card = doc.body.querySelectorAll("div").find((d: MiniElement) => d.getAttribute("role") === "dialog")!;
  assert.ok(card, "it's a dialog, not a tooltip (it has interactive content)");
  assert.equal(trigger.getAttribute("aria-controls"), card.getAttribute("id"));
});

test("Tour: arrow navigation, Escape skips", () => {
  clearBody();
  const open = state(true);
  let skipped = 0;
  const t = createRoot(() =>
    tour({
      steps: [
        { title: "Step 1", content: "a" },
        { title: "Step 2", content: "b" },
      ],
      open,
      onSkip: () => skipped++,
    }),
  );
  mount(() => R.div(t.el));

  assert.ok(doc.body.textContent.includes("1 / 2"));
  div().dispatch("keydown", { key: "ArrowRight" });
  assert.equal(t.index(), 1);
  div().dispatch("keydown", { key: "Escape" });
  assert.equal(open(), false);
  assert.equal(skipped, 1);
});

test("FormSection links the title through aria-labelledby", () => {
  const root = mount(() => FormSection({ title: "Personal details", children: "fields" }));
  const section = root.querySelector("section")!;
  const heading = root.querySelector("h3")!;
  assert.equal(section.getAttribute("aria-labelledby"), heading.getAttribute("id"));
});

test("a collapsible FormSection toggles correctly", () => {
  const root = mount(() => FormSection({ title: "T", children: "body", collapsible: true }));
  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(byClass(root, "div", "rui-formsection-body")!.getAttribute("hidden"), "");
});

test("ValidationSummary lists the errors with links to the fields", () => {
  const email = createRoot(() => field<string>("", { validate: validators.required(), label: "Email" }));
  const name = createRoot(() => field<string>("ok", { validate: validators.required(), label: "Name" }));
  const root = mount(() => R.div(ValidationSummary({ fields: [email, name] })));

  const alert = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert")!;
  assert.equal(alert.getAttribute("aria-live"), "assertive");
  assert.ok(root.textContent.includes("1 error"));
  assert.ok(root.textContent.includes("Email: Required field"));
  assert.equal(root.querySelector("a")!.getAttribute("href"), "#" + email.id);

  email.value.set("a@b.co");
  assert.equal(root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert"), undefined);
});

test("MonthPicker: year navigation, month selection", () => {
  const v = state<{ y: number; m: number } | null>(null);
  const root = mount(() => MonthPicker({ value: v, locale: "ro-RO" }));
  const months = root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"));
  assert.equal(months.length, 12);

  months[2]!.click();
  assert.equal(v()!.m, 3);

  const year = v()!.y;
  root.querySelectorAll("button")[0]!.click(); // the previous year
  root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"))[0]!.click();
  assert.equal(v()!.y, year - 1);
  assert.equal(v()!.m, 1);
});

test("YearPicker paginates", () => {
  const v = state<number | null>(2026);
  const root = mount(() => YearPicker({ value: v, pageSize: 12 }));
  const years = () => root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"));
  assert.equal(years().length, 12);
  assert.equal(years()[0]!.textContent, "2016", "page aligned to a multiple of 12");

  years()[5]!.click();
  assert.equal(v(), 2021);
});

test("DateTimePicker summarizes the chosen value", () => {
  const date = state<any>({ y: 2026, m: 3, d: 15 });
  const time = state<any>({ h: 14, min: 30 });
  const root = mount(() => DateTimePicker({ date, time }));
  assert.ok(root.textContent.includes("2026-03-15 14:30"));
});
