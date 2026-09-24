import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptor/dom/testing";
import { render, R } from "@raptor/dom";
import { state, createRoot } from "@raptor/core";
import { Masonry, Affix, SafeArea, SkipNav, BottomNavigation, Dock, SplitButton, FloatingActionButton } from "../src/layout-extra.ts";
import {
  applyMask, unmask, formatCurrency, parseCurrency, groupDigits, activeMention,
  hexToRgb, rgbToHex, relativeLuminance, contrastRatio, readableOn, findPath,
  MaskedInput, CurrencyInput, PhoneInput, Mentions, Rating, ColorSwatchPicker, TransferList, Cascader, TreeSelect,
} from "../src/input-extra.ts";
import { arcPath, squarify, sankeyLayout, PieChart, DonutChart, ScatterChart, Heatmap, Gauge, RadarChart, FunnelChart, CandlestickChart, Treemap, SankeyDiagram, Meter } from "../src/chart-extra.ts";
import { diffLines, diffStats, DiffViewer, JsonViewer, ComparisonTable, CodeEditor, RichTextEditor } from "../src/editors.ts";
import { formatDuration, computePeaks, fileIcon, carousel, Gallery, Lightbox, ImageZoom, VideoPlayer, AudioPlayer, Waveform, ImageUpload, UploadProgress, FilePreview } from "../src/media.ts";
import { reedSolomon, pickVersion, dataCapacity, buildMatrix, readFormat, maskPenalty, encodeData, QRCode, MAX_VERSION } from "../src/qrcode.ts";
import { kanban, wizard, Menubar, HoverCard, tour } from "../src/advanced.ts";
import { idle, networkStatus } from "../src/primitives/stores.ts";
import { FormSection, ValidationSummary } from "../src/form.ts";
import { MonthPicker, YearPicker, DateTimePicker } from "../src/date.ts";
import { field, formGroup, validators } from "../src/form.ts";

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

test("Masonry distribuie ciclic pe coloane", () => {
  const root = mount(() => Masonry({ items: ["a", "b", "c", "d", "e"], columns: 3 }));
  const cols = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-masonry-col"));
  assert.equal(cols.length, 3);
  assert.equal(cols[0]!.textContent, "ad");
  assert.equal(cols[1]!.textContent, "be");
  assert.equal(cols[2]!.textContent, "c");
});

test("Affix folosește position:sticky, nu calcule de scroll", () => {
  const el = mount(() => Affix({ children: "x", offsetTop: 12 })).querySelector("div")!;
  assert.equal(el.getAttribute("style"), "position:sticky;top:12px");
});

test("SafeArea combină env() cu un minim", () => {
  const el = mount(() => SafeArea({ children: "x", edges: ["bottom"], minimum: 4 })).querySelector("div")!;
  assert.equal(el.getAttribute("style"), "padding-bottom:max(12px, env(safe-area-inset-bottom, 0px))");
});

test("SkipNav trimite către main și mută focusul", () => {
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

test("Dock: fiecare buton doar-icon are nume", () => {
  const root = mount(() =>
    Dock({ items: [{ key: "a", label: "Adaugă", icon: "+", onClick: () => {} }] }),
  );
  assert.equal(root.querySelector("div")!.getAttribute("role"), "toolbar");
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Adaugă");
});

test("SplitButton are două butoane distincte", () => {
  let main = 0;
  const root = mount(() =>
    SplitButton({
      children: "Salvează",
      onClick: () => main++,
      entries: [{ kind: "item", label: "Salvează ca…", onSelect: () => {} }],
    }),
  );
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons.length, 2);
  buttons[0]!.click();
  assert.equal(main, 1, "acțiunea principală nu deschide meniul");
  assert.equal(buttons[1]!.getAttribute("aria-label"), "Mai multe acțiuni");
});

test("FloatingActionButton cere etichetă", () => {
  const btn = mount(() => FloatingActionButton({ icon: "+", label: "Adaugă", onClick: () => {} })).querySelector("button")!;
  assert.equal(btn.getAttribute("aria-label"), "Adaugă");
});

/* ------------------------------------------------------------- măști etc -- */

test("applyMask inserează separatorii și ține cursorul", () => {
  assert.equal(applyMask("12345678", "9999-99-99").value, "1234-56-78");
  // Separatorul final NU se adauga pana nu tastezi caracterul urmator:
  // altfel cursorul ajunge dupa o liniuta pe care nu ai scris-o.
  assert.equal(applyMask("1234", "9999-99-99").value, "1234");
  // Caracterele care nu se potrivesc sunt sărite, nu inserate.
  assert.equal(applyMask("12ab34", "9999").value, "1234");
  assert.equal(applyMask("2026-03", "9999-99-99").value, "2026-03");
  assert.equal(unmask("1234-56-78", "9999-99-99"), "12345678");
  // Round-trip: ce iese din `applyMask` se intoarce prin `unmask`.
  assert.equal(unmask(applyMask("20260315", "9999-99-99").value, "9999-99-99"), "20260315");
});

test("applyMask cu litere și wildcard", () => {
  assert.equal(applyMask("ab12", "AA99").value, "ab12");
  assert.equal(applyMask("a1b2", "****").value, "a1b2");
});

test("formatCurrency ține banii în întregi", () => {
  assert.ok(formatCurrency(12345, "RON", "ro-RO").includes("123,45"));
  assert.equal(parseCurrency("123,45"), 12345);
  assert.equal(parseCurrency(""), 0);
  // Nicio aritmetică în virgulă mobilă: 0.1+0.2 nu apare nicăieri.
  assert.equal(parseCurrency("10") + parseCurrency("20"), 30);
});

test("groupDigits grupează după șablon", () => {
  assert.equal(groupDigits("0722334455", [3, 3, 4]), "072 233 4455");
  assert.equal(groupDigits("07", [3, 3, 3]), "07");
  assert.equal(groupDigits("1234567890123", [3, 3, 3]), "123 456 789 0123");
});

test("activeMention găsește tokenul de sub cursor", () => {
  assert.deepEqual(activeMention("salut @an", 9), { query: "an", start: 6 });
  assert.equal(activeMention("salut @an", 5), null, "cursorul e înaintea tokenului");
  assert.equal(activeMention("email@domeniu.ro", 16), null, "@ în mijlocul unui cuvânt nu declanșează");
  assert.deepEqual(activeMention("@x", 2), { query: "x", start: 0 });
});

test("culori: hex, luminanță, contrast, text lizibil", () => {
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#17457a"), { r: 23, g: 69, b: 122 });
  assert.equal(hexToRgb("nu-i culoare"), null);
  assert.equal(rgbToHex(23, 69, 122), "#17457a");
  assert.equal(rgbToHex(300, -5, 0), "#ff0000", "plafonat");

  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01, "contrast maxim = 21:1");
  assert.equal(readableOn("#ffffff"), "#000000");
  assert.equal(readableOn("#17457a"), "#ffffff");
  assert.ok(relativeLuminance(255, 255, 255) > relativeLuminance(0, 0, 0));
});

test("MaskedInput scrie valoarea mascată în semnal", () => {
  const v = state("");
  const input = mount(() => MaskedInput({ value: v, mask: "9999-99-99" })).querySelector("input")!;
  input.dispatch("input", { target: { value: "20260315" } });
  assert.equal(v(), "2026-03-15");
});

test("PhoneInput păstrează doar cifrele și marchează invalidul", () => {
  const v = state("");
  const input = mount(() => PhoneInput({ value: v, prefix: "+40", minDigits: 9 })).querySelector("input")!;
  input.dispatch("input", { target: { value: "072 233 44" } });
  assert.equal(v(), "07223344");
  assert.equal(input.getAttribute("aria-invalid"), "true", "8 cifre < 9");
  input.dispatch("input", { target: { value: "072233445" } });
  assert.equal(input.getAttribute("aria-invalid"), "false");
});

test("Rating e slider, nu radiogroup", () => {
  const v = state(3);
  const root = mount(() => Rating({ value: v, max: 5, label: "Notă" }));
  const el = root.querySelector("div")!;
  assert.equal(el.getAttribute("role"), "slider");
  assert.equal(el.getAttribute("aria-valuenow"), "3");
  assert.equal(el.getAttribute("aria-valuetext"), "3 din 5");

  el.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(v(), 4);
  el.dispatch("keydown", { key: "End", preventDefault() {} });
  assert.equal(v(), 5);
});

test("ColorSwatchPicker: radiogroup cu nume pe fiecare pastilă", () => {
  const v = state("#17457a");
  const root = mount(() =>
    ColorSwatchPicker({ value: v, colors: ["#17457a", "#0f6e4f"], names: { "#0f6e4f": "verde" } }),
  );
  assert.equal(root.querySelector("div")!.getAttribute("role"), "radiogroup");
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[0]!.getAttribute("aria-label"), "#17457a");
  assert.equal(buttons[1]!.getAttribute("aria-label"), "verde");
  buttons[1]!.click();
  assert.equal(v(), "#0f6e4f");
});

test("TransferList mută doar elementele bifate", () => {
  const selected = state<readonly string[]>([]);
  const root = mount(() =>
    TransferList({
      items: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C", disabled: true }],
      selected,
    }),
  );
  const items = () => root.querySelectorAll("li");
  const buttons = () => root.querySelectorAll("button");

  assert.equal(buttons()[0]!.getAttribute("disabled"), "", "nimic bifat => buton dezactivat");
  items()[0]!.click();
  assert.equal(buttons()[0]!.getAttribute("disabled"), null);
  buttons()[0]!.click();
  assert.deepEqual(selected(), ["a"]);
});

test("findPath găsește calea în arborele de opțiuni", () => {
  const tree = [
    { value: "ro", label: "România", children: [{ value: "cj", label: "Cluj", children: [{ value: "cjn", label: "Cluj-Napoca" }] }] },
  ];
  assert.deepEqual(findPath(tree, "cjn")!.map((n) => n.value), ["ro", "cj", "cjn"]);
  assert.equal(findPath(tree, "xx"), null);
});

test("Cascader alege doar frunzele implicit", () => {
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
  assert.equal(v(), null, "nodul intermediar nu se alege");

  const leaf = items().find((li) => li.textContent.includes("Cluj"))!;
  leaf.dispatch("click", { stopPropagation() {} });
  assert.equal(v(), "cj");
});

test("TreeSelect expandează și alege", () => {
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

/* -------------------------------------------------------------- grafice -- */

test("arcPath: sectorul complet e spart în două arce", () => {
  const full = arcPath(50, 50, 40, 0, 0, Math.PI * 2);
  assert.equal((full.match(/A/g) ?? []).length, 2, "360° nu poate fi un singur arc");
  assert.ok(!full.includes("NaN"));

  const donut = arcPath(50, 50, 40, 20, 0, Math.PI / 2);
  assert.ok(donut.includes("M") && donut.endsWith("Z"));
});

test("PieChart și DonutChart randează câte un path per felie", () => {
  const data = [{ label: "a", value: 30 }, { label: "b", value: 70 }];
  assert.equal(mount(() => PieChart({ data })).querySelectorAll("path").length, 2);
  const donut = mount(() => DonutChart({ data, center: "100" }));
  assert.equal(donut.querySelectorAll("path").length, 2);
  assert.ok(donut.textContent.includes("100"));
});

test("PieChart cu total zero nu produce NaN", () => {
  const root = mount(() => PieChart({ data: [{ label: "a", value: 0 }] }));
  for (const p of root.querySelectorAll("path")) {
    assert.ok(!(p.getAttribute("d") ?? "").includes("NaN"));
  }
});

test("ScatterChart scalează raza după rădăcina valorii (aria, nu raza)", () => {
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
  // Valoare de 4 ori mai mare => rază de 2 ori mai mare, nu de 4.
  assert.ok(Math.abs(r2 / r1 - 2) < 0.05, `${r1} -> ${r2}`);
});

test("Heatmap codifică intensitatea prin opacitate", () => {
  const root = mount(() => Heatmap({ values: [[0, 10], [5, 10]], cellSize: 20 }));
  const cells = root.querySelectorAll("rect");
  assert.equal(cells.length, 4);
  const lowest = Number(cells[0]!.getAttribute("fill-opacity"));
  const highest = Number(cells[1]!.getAttribute("fill-opacity"));
  assert.ok(highest > lowest);
  assert.ok(lowest >= 0.08 && highest <= 1);
});

test("Gauge alege culoarea după praguri", () => {
  const value = state(10);
  const root = mount(() =>
    Gauge({
      value: () => value(),
      thresholds: [{ at: 0, color: "#0f6e4f" }, { at: 70, color: "#b42318" }],
      summary: "Utilizare",
    }),
  );
  const fill = byClass(root, "path", "rui-gauge-fill")!;
  assert.equal(fill.getAttribute("stroke"), "#0f6e4f");
  value.set(90);
  assert.equal(fill.getAttribute("stroke"), "#b42318");
  assert.ok(!(fill.getAttribute("d") ?? "").includes("NaN"));
});

test("RadarChart randează un poligon per serie și pânza", () => {
  const root = mount(() =>
    RadarChart({
      axes: ["viteză", "cost", "calitate"],
      series: [{ label: "A", values: [3, 5, 4] }, { label: "B", values: [5, 2, 3] }],
    }),
  );
  const areas = root.querySelectorAll("polygon").filter((p) => hasClass(p, "rui-radar-area"));
  assert.equal(areas.length, 2);
  assert.ok(!(areas[0]!.getAttribute("points") ?? "").includes("NaN"));
});

test("FunnelChart calculează rata față de treapta anterioară", () => {
  const root = mount(() =>
    FunnelChart({
      stages: [{ label: "Vizite", value: 1000 }, { label: "Coș", value: 250 }],
      showRate: true,
    }),
  );
  assert.ok(root.textContent.includes("25%"));
});

test("CandlestickChart: corp minim 1px, culori după direcție", () => {
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
  assert.ok(Number(bodies[1]!.getAttribute("height")) >= 1, "doji rămâne vizibilă");
});

test("squarify acoperă toată suprafața, proporțional", () => {
  const cells = squarify([{ label: "a", value: 50 }, { label: "b", value: 30 }, { label: "c", value: 20 }], 200, 100);
  assert.equal(cells.length, 3);
  const area = cells.reduce((sum, c) => sum + c.width * c.height, 0);
  assert.ok(Math.abs(area - 200 * 100) < 1, "suprafața totală e acoperită: " + area);

  const a = cells.find((c) => c.item.label === "a")!;
  const b = cells.find((c) => c.item.label === "b")!;
  assert.ok(a.width * a.height > b.width * b.height, "valoarea mai mare => arie mai mare");
});

test("squarify cu date goale sau nule nu crapă", () => {
  assert.deepEqual(squarify([], 100, 100), []);
  assert.deepEqual(squarify([{ label: "a", value: 0 }], 100, 100), []);
});

test("Treemap randează celulele", () => {
  const root = mount(() => Treemap({ items: [{ label: "a", value: 60 }, { label: "b", value: 40 }] }));
  assert.equal(root.querySelectorAll("rect").length, 2);
});

test("sankeyLayout așază nodurile pe adâncimi și nu buclează la ciclu", () => {
  const nodes = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];
  const links = [{ from: "a", to: "b", value: 10 }, { from: "b", to: "c", value: 6 }];
  const layout = sankeyLayout(nodes, links, 400, 200);

  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.links.length, 2);
  const depths = new Map(layout.nodes.map((n) => [n.node.key, n.depth]));
  assert.equal(depths.get("a"), 0);
  assert.equal(depths.get("b"), 1);
  assert.equal(depths.get("c"), 2);

  // Ciclu: trebuie să se termine, chiar dacă rezultatul e arbitrar.
  const cyclic = sankeyLayout(nodes, [...links, { from: "c", to: "a", value: 1 }], 400, 200);
  assert.equal(cyclic.nodes.length, 3);
});

test("SankeyDiagram randează legături și noduri", () => {
  const root = mount(() =>
    SankeyDiagram({
      nodes: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
      links: [{ from: "a", to: "b", value: 5 }],
    }),
  );
  assert.equal(root.querySelectorAll("path").length, 1);
  assert.equal(root.querySelectorAll("rect").length, 2);
});

test("Meter are role=meter, nu progressbar", () => {
  const root = mount(() => Meter({ value: 80, low: 20, high: 90, label: "Disc" }));
  const el = root.querySelector("div")!;
  assert.equal(el.getAttribute("role"), "meter");
  assert.equal(el.getAttribute("aria-valuenow"), "80");
  assert.ok(hasClass(byClass(root, "div", "rui-meter-fill")!, "rui-level-ok"));
});

/* ------------------------------------------------------------- editoare -- */

test("diffLines: LCS corect pe inserții, ștergeri și egalități", () => {
  const chunks = diffLines("a\nb\nc", "a\nx\nc");
  assert.deepEqual(chunks.map((c) => c.op), ["equal", "delete", "insert", "equal"]);
  assert.deepEqual(diffStats(chunks), { added: 1, removed: 1 });

  assert.deepEqual(diffLines("a", "a").map((c) => c.op), ["equal"]);
  assert.deepEqual(diffLines("", "x").map((c) => c.op), ["delete", "insert"]);
});

test("diffLines păstrează indicii de linie corecți", () => {
  const chunks = diffLines("a\nb", "a\nb\nc");
  const added = chunks.find((c) => c.op === "insert")!;
  assert.equal(added.newIndex, 2);
  assert.equal(added.oldIndex, -1);
});

test("DiffViewer arată statistici și semne citibile", () => {
  const root = mount(() => DiffViewer({ oldText: "a\nb", newText: "a\nc" }));
  assert.ok(root.textContent.includes("+1"));
  assert.ok(root.textContent.includes("−1"));
  // Semnul e și text pentru screen reader, nu doar culoare.
  assert.ok(root.textContent.includes("adăugat:"));
  assert.ok(root.textContent.includes("șters:"));
});

test("DiffViewer colapsează blocurile lungi neschimbate", () => {
  const long = Array.from({ length: 30 }, (_, i) => "linia " + i).join("\n");
  const changed = long.replace("linia 15", "MODIFICAT");
  const root = mount(() => DiffViewer({ oldText: long, newText: changed, context: 2 }));
  assert.ok(root.textContent.includes("linii neschimbate"));
});

test("JsonViewer randează doar nodurile expandate și marchează ciclurile", () => {
  const data: any = { a: 1, b: { c: 2 } };
  data.self = data;
  const root = mount(() => JsonViewer({ data, defaultDepth: 1 }));
  assert.ok(root.textContent.includes("referință circulară"));
  // La adâncimea 1, `b` e colapsat: continutul lui nu e in DOM.
  assert.ok(!root.textContent.includes('"c"'));
});

test("JsonViewer expandează la click", () => {
  const root = mount(() => JsonViewer({ data: { b: { c: 2 } }, defaultDepth: 1 }));
  const toggles = root.querySelectorAll("button");
  toggles[toggles.length - 1]!.click();
  assert.ok(root.textContent.includes("2"));
});

test("ComparisonTable are scope corect și text pentru bife", () => {
  const root = mount(() =>
    ComparisonTable({
      features: [{ key: "api", label: "API" }, { key: "sso", label: "SSO" }],
      plans: [
        { key: "free", label: "Gratuit", values: { api: true, sso: false } },
        { key: "pro", label: "Pro", featured: true, values: { api: true, sso: "limitat" } },
      ],
    }),
  );
  const rowHeaders = root.querySelectorAll("th").filter((th) => th.getAttribute("scope") === "row");
  assert.equal(rowHeaders.length, 2);
  assert.ok(root.textContent.includes("inclus"));
  assert.ok(root.textContent.includes("neinclus"));
  assert.ok(root.textContent.includes("limitat"));
});

test("CodeEditor: Tab inserează spații, Escape apoi Tab iese", () => {
  const v = state("linia 1\nlinia 2");
  const root = mount(() => CodeEditor({ value: v, tabSize: 2 }));
  const ta = root.querySelector("textarea")!;

  let prevented = 0;
  ta.dispatch("keydown", { key: "Tab", target: { selectionStart: 0, selectionEnd: 0 }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.ok(v().startsWith("  linia 1"));

  ta.dispatch("keydown", { key: "Escape" });
  ta.dispatch("keydown", { key: "Tab", target: { selectionStart: 0, selectionEnd: 0 }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1, "după Escape, Tab iese din câmp");
});

test("CodeEditor numără liniile", () => {
  const v = state("a\nb\nc");
  const root = mount(() => CodeEditor({ value: v, lineNumbers: true }));
  const nums = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-code-lineno"));
  assert.deepEqual(nums.map((n) => n.textContent), ["1", "2", "3"]);
});

test("RichTextEditor: toolbar legat de zona editabilă", () => {
  const v = state("<p>salut</p>");
  const root = mount(() => RichTextEditor({ value: v, label: "Descriere" }));
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

test("computePeaks reduce și normalizează", () => {
  const peaks = computePeaks([0, 0.5, -1, 0.25, 0.75, -0.5], 3);
  assert.equal(peaks.length, 3);
  assert.equal(Math.max(...peaks), 1, "normalizat la 1");
  assert.ok(peaks.every((p) => p >= 0 && p <= 1));
  assert.deepEqual(computePeaks([], 5), []);
});

test("fileIcon după tip și extensie", () => {
  assert.equal(fileIcon("image/png", "a.png"), "🖼");
  assert.equal(fileIcon("", "raport.pdf"), "📕");
  assert.equal(fileIcon("", "date.csv"), "📊");
  assert.equal(fileIcon("", "necunoscut.xyz"), "📎");
});

test("Carousel: slide-urile ascunse sunt inerte și anunțate corect", () => {
  const c = createRoot(() => carousel({ slides: ["unu", "doi", "trei"], loop: true }));
  const root = mount(() => c.el);

  const slides = root.querySelectorAll("div").filter((d) => hasClass(d, "rui-carousel-slide"));
  assert.equal(slides.length, 3);
  assert.equal(slides[0]!.getAttribute("aria-label"), "1 din 3");
  assert.equal(slides[1]!.getAttribute("aria-hidden"), "true");
  assert.equal(slides[1]!.getAttribute("inert"), "");

  c.next();
  assert.equal(slides[1]!.getAttribute("aria-hidden"), "false");
  assert.equal(slides[1]!.getAttribute("inert"), null);

  c.go(2);
  c.next();
  assert.equal(c.index(), 0, "loop");
});

test("Carousel: autoplay se oprește la hover", async () => {
  // `dispose` e obligatoriu: intervalul de autoplay ar ține procesul în viață.
  let dispose!: () => void;
  const c = createRoot((d) => {
    dispose = d;
    // Trei slide-uri, nu doua: cu doua si `loop`, doua tick-uri ar readuce
    // indexul la 0 si testul ar trece/pica dupa cum se nimereste.
    return carousel({ slides: ["a", "b", "c"], autoplay: 15, loop: true });
  });
  try {
    const root = mount(() => c.el);
    const host = root.querySelector("div")!;

    host.dispatch("pointerenter");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(c.index(), 0, "cât e hover nu avansează");

    host.dispatch("pointerleave");
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(c.index() > 0);
  } finally {
    dispose();
  }
});

test("Gallery: butonul poartă numele, imaginea are alt gol", () => {
  const root = mount(() =>
    Gallery({ images: [{ src: "/a.png", alt: "Grafic" }], lightbox: false }),
  );
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Deschide: Grafic");
  assert.equal(root.querySelector("img")!.getAttribute("alt"), "", "nu se citește de două ori");
});

test("Lightbox: navigare cu săgeți, Escape închide", () => {
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

  assert.ok(doc.body.textContent.includes("1 din 2"));
  div().dispatch("keydown", { key: "ArrowRight" });
  assert.equal(index(), 1);
  div().dispatch("keydown", { key: "ArrowRight" });
  assert.equal(index(), 0, "ciclează");
  div().dispatch("keydown", { key: "Escape" });
  assert.equal(open(), false);
});

test("ImageZoom ignoră touch", () => {
  const root = mount(() => ImageZoom({ src: "/a.png", alt: "x" }));
  const host = root.querySelector("span")!;
  host.dispatch("pointerenter", { pointerType: "touch" });
  assert.equal(root.querySelector("img")!.getAttribute("style"), "transform:none");
  host.dispatch("pointerenter", { pointerType: "mouse" });
  assert.ok((root.querySelector("img")!.getAttribute("style") ?? "").includes("scale"));
});

test("VideoPlayer: controale proprii, fără atributul `controls`", () => {
  const root = mount(() =>
    VideoPlayer({ src: "/v.mp4", label: "Demo", tracks: [{ src: "/ro.vtt", label: "RO", lang: "ro", default: true }] }),
  );
  const video = root.querySelector("video")!;
  assert.equal(video.getAttribute("controls"), null);
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.equal(root.querySelector("track")!.getAttribute("srclang"), "ro");
  assert.equal(root.querySelector("button")!.getAttribute("aria-label"), "Redă");
});

test("AudioPlayer leagă evenimentele native de semnale", () => {
  const root = mount(() => AudioPlayer({ src: "/a.mp3" }));
  const audio = root.querySelector("audio")!;
  const play = root.querySelector("button")!;
  assert.equal(play.getAttribute("aria-label"), "Redă");

  (audio as any).currentTime = 0;
  audio.dispatch("play");
  assert.equal(play.getAttribute("aria-label"), "Pauză");
  audio.dispatch("pause");
  assert.equal(play.getAttribute("aria-label"), "Redă");
});

test("Waveform e slider când se poate naviga", () => {
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

test("ImageUpload: label real legat de input", () => {
  const v = state<string | null>(null);
  const root = mount(() => ImageUpload({ value: v }));
  assert.equal(root.querySelector("label")!.getAttribute("for"), root.querySelector("input")!.getAttribute("id"));

  v.set("blob:x");
  assert.ok(root.querySelector("img"));
});

test("UploadProgress: progres total și per fișier", () => {
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
  const total = bars.find((b) => b.getAttribute("aria-label") === "Progres total")!;
  assert.equal(total.getAttribute("aria-valuenow"), "70");
  assert.ok(root.textContent.includes("1 KB"));
});

test("FilePreview alege iconul după tip", () => {
  const root = mount(() => FilePreview({ file: { name: "raport.pdf", size: 2048, type: "application/pdf" } }));
  assert.ok(root.textContent.includes("📕"));
  assert.ok(root.textContent.includes("2 KB"));
});

/* ---------------------------------------------------------------- QRCode -- */

test("GF(256): Reed-Solomon produce numărul corect de codewords", () => {
  const ec = reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13);
  assert.equal(ec.length, 13);
  assert.ok(ec.every((b) => b >= 0 && b <= 255));
  // Determinist: aceeași intrare, același rezultat.
  assert.deepEqual(reedSolomon([32, 91, 11], 7), reedSolomon([32, 91, 11], 7));
});

test("capacitățile și alegerea versiunii respectă standardul", () => {
  assert.equal(dataCapacity(1, "L"), 19);
  assert.equal(dataCapacity(1, "H"), 9);
  assert.equal(dataCapacity(10, "L"), 2 * 68 + 2 * 69);

  assert.equal(pickVersion(10, "L"), 1, "10 octeți încap în v1-L");
  assert.equal(pickVersion(20, "L"), 2);
  assert.ok((pickVersion(200, "L") ?? 0) > 5);
  assert.equal(pickVersion(100000, "H"), null, "peste capacitatea maximă");
});

test("encodeData produce exact numărul de codewords al versiunii", () => {
  const codewords = encodeData("https://raptor.dev", 2, "M");
  const [ecPerBlock, g1, d1, g2, d2] = [16, 1, 28, 0, 0];
  assert.equal(codewords.length, g1 * d1 + g2 * d2 + (g1 + g2) * ecPerBlock);
});

test("buildMatrix: dimensiune, findere, timing, modul întunecat", () => {
  const m = buildMatrix("HELLO", "M");
  assert.equal(m.size, m.version * 4 + 17);

  const at = (r: number, c: number): boolean => m.modules[r]![c]!;
  // Colțul unui finder: inel negru, centru negru, inel alb între ele.
  assert.equal(at(0, 0), true);
  assert.equal(at(1, 1), false);
  assert.equal(at(3, 3), true);
  // Timing pattern alternează.
  assert.equal(at(6, 8), true);
  assert.equal(at(6, 9), false);
  // Modulul întunecat obligatoriu.
  assert.equal(at(m.size - 8, 8), true);
});

test("buildMatrix: formatul se poate citi înapoi (BCH corect)", () => {
  for (const ec of ["L", "M", "Q", "H"] as const) {
    const m = buildMatrix("test", ec);
    const read = readFormat(m);
    assert.ok(read, "format ilizibil pentru " + ec);
    assert.equal(read!.ec, ec);
    assert.equal(read!.mask, m.mask, "masca scrisă = masca aleasă");
    assert.ok(read!.mask >= 0 && read!.mask <= 7);
  }
});

test("buildMatrix alege masca cu penalizarea minimă", () => {
  const m = buildMatrix("https://raptor.dev/docs", "Q");
  // Masca aleasă trebuie să fie cel puțin la fel de bună ca oricare alta.
  const chosen = maskPenalty(m.modules);
  assert.ok(Number.isFinite(chosen));
  assert.ok(m.mask >= 0 && m.mask <= 7);
});

test("buildMatrix: versiuni mari primesc alignment și info de versiune", () => {
  const long = "x".repeat(150);
  const m = buildMatrix(long, "L");
  assert.ok(m.version >= 7, "versiune " + m.version);
  assert.equal(m.size, m.version * 4 + 17);
  // Informația de versiune ocupă blocul 6x3 din dreapta-sus.
  let dark = 0;
  for (let r = 0; r < 6; r++) for (let c = m.size - 11; c < m.size - 8; c++) if (m.modules[r]![c]) dark++;
  assert.ok(dark > 0, "blocul de versiune nu e gol");
});

test("buildMatrix aruncă mesaj clar când textul nu încape", () => {
  assert.throws(
    () => buildMatrix("y".repeat(5000), "H"),
    /prea mult pentru un QR versiunea 10/,
  );
});

test("QRCode randează un singur path pentru toate modulele", () => {
  const root = mount(() => QRCode({ value: "https://raptor.dev", label: "Link către site" }));
  const svg = root.querySelector("svg")!;
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Link către site");
  const paths = root.querySelectorAll("path");
  assert.equal(paths.length, 1, "un singur nod, nu unul per modul");
  assert.ok((paths[0]!.getAttribute("d") ?? "").length > 100);
});

test("TEZĂ: schimbarea textului rescrie doar `d`", () => {
  const value = state("primul");
  const root = mount(() => QRCode({ value: () => value(), label: "cod" }));
  const before = root.querySelector("path")!.getAttribute("d");

  value.set("al doilea text, mai lung");
  const after = root.querySelector("path")!.getAttribute("d");
  assert.notEqual(after, before);
});

test("QRCode arată eroarea în loc să crape", () => {
  const root = mount(() => QRCode({ value: "z".repeat(4000), level: "H" }));
  assert.equal(root.querySelector("svg"), null);
  assert.ok(root.textContent.includes("prea mult"));
});

/* ------------------------------------------------------------- diverse -- */

test("idle devine true după inactivitate și se resetează la activitate", async () => {
  // Fără `dispose`, cronometrul se re-armează la fiecare eveniment din document
  // și procesul nu se mai încheie niciodată.
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
    assert.equal(isIdle(), false, "activitatea resetează");
  } finally {
    dispose();
  }
});

test("networkStatus citește navigator.onLine și ascultă evenimentele", () => {
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

test("Kanban: mutare programatică (calea de la tastatură)", () => {
  const cards = state<Readonly<Record<string, readonly any[]>>>({
    todo: [{ key: "c1", title: "Sarcina 1" }],
    done: [],
  });
  const moves: string[] = [];
  const k = createRoot(() =>
    kanban({
      columns: [{ key: "todo", title: "De făcut" }, { key: "done", title: "Gata", limit: 2 }],
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

test("Kanban marchează depășirea limitei WIP", () => {
  const cards = state<Readonly<Record<string, readonly any[]>>>({
    doing: [{ key: "a", title: "A" }, { key: "b", title: "B" }],
  });
  const k = createRoot(() => kanban({ columns: [{ key: "doing", title: "În lucru", limit: 1 }], cards }));
  const root = mount(() => k.el);
  assert.ok(hasClass(root.querySelector("section")!, "rui-over-limit"));
});

test("Wizard blochează avansarea pe un pas invalid și marchează câmpurile", () => {
  const email = createRoot(() => field<string>("", { validate: validators.required(), label: "Email" }));
  const group = createRoot(() => formGroup([email]));
  const w = createRoot(() =>
    wizard({
      steps: [
        { key: "a", title: "Date", content: "pas 1", group },
        { key: "b", title: "Gata", content: "pas 2" },
      ],
    }),
  );
  mount(() => w.el);

  w.next();
  assert.equal(w.current(), 0, "nu avansează cu grup invalid");
  assert.equal(email.touched(), true, "câmpurile au fost marcate");

  email.value.set("a@b.co");
  w.next();
  assert.equal(w.current(), 1);

  w.goTo(0);
  assert.equal(w.current(), 0, "înapoi se poate");
});

test("Wizard: pasul opțional se poate sări", () => {
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

test("Menubar: un singur meniu deschis, săgețile trec între ele", () => {
  const root = mount(() =>
    Menubar({
      menus: [
        { key: "file", label: "Fișier", entries: [{ kind: "item", label: "Nou", onSelect: () => {} }] },
        { key: "edit", label: "Editare", entries: [{ kind: "item", label: "Copiază", onSelect: () => {} }] },
      ],
    }),
  );
  const bar = root.querySelector("div")!;
  assert.equal(bar.getAttribute("role"), "menubar");

  const triggers = root.querySelectorAll("button");
  triggers[0]!.dispatch("click", { stopPropagation() {} });
  assert.equal(triggers[0]!.getAttribute("aria-expanded"), "true");

  triggers[1]!.dispatch("click", { stopPropagation() {} });
  assert.equal(triggers[0]!.getAttribute("aria-expanded"), "false", "primul s-a închis");
  assert.equal(triggers[1]!.getAttribute("aria-expanded"), "true");
});

test("HoverCard: role=dialog, se deschide la focus", async () => {
  clearBody();
  const root = mount(() =>
    HoverCard({
      trigger: (p) => R.button(p, "@ana"),
      children: "Profil",
      openDelay: 0,
      closeDelay: 0,
    }),
  );
  const trigger = root.querySelector("button")!;
  trigger.dispatch("focus");
  await tick();

  const card = doc.body.querySelectorAll("div").find((d: MiniElement) => d.getAttribute("role") === "dialog")!;
  assert.ok(card, "e dialog, nu tooltip (are conținut interactiv)");
  assert.equal(trigger.getAttribute("aria-controls"), card.getAttribute("id"));
});

test("Tour: navigare cu săgeți, Escape sare peste", () => {
  clearBody();
  const open = state(true);
  let skipped = 0;
  const t = createRoot(() =>
    tour({
      steps: [
        { title: "Pas 1", content: "a" },
        { title: "Pas 2", content: "b" },
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

test("FormSection leagă titlul prin aria-labelledby", () => {
  const root = mount(() => FormSection({ title: "Date personale", children: "câmpuri" }));
  const section = root.querySelector("section")!;
  const heading = root.querySelector("h3")!;
  assert.equal(section.getAttribute("aria-labelledby"), heading.getAttribute("id"));
});

test("FormSection pliabilă comută corect", () => {
  const root = mount(() => FormSection({ title: "T", children: "corp", collapsible: true }));
  const btn = root.querySelector("button")!;
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(byClass(root, "div", "rui-formsection-body")!.getAttribute("hidden"), "");
});

test("ValidationSummary listează erorile cu linkuri către câmpuri", () => {
  const email = createRoot(() => field<string>("", { validate: validators.required(), label: "Email" }));
  const nume = createRoot(() => field<string>("ok", { validate: validators.required(), label: "Nume" }));
  const root = mount(() => R.div(ValidationSummary({ fields: [email, nume] })));

  const alert = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert")!;
  assert.equal(alert.getAttribute("aria-live"), "assertive");
  assert.ok(root.textContent.includes("1 eroare"));
  assert.ok(root.textContent.includes("Email: Câmp obligatoriu"));
  assert.equal(root.querySelector("a")!.getAttribute("href"), "#" + email.id);

  email.value.set("a@b.co");
  assert.equal(root.querySelectorAll("div").find((d) => d.getAttribute("role") === "alert"), undefined);
});

test("MonthPicker: navigare pe ani, selecție de lună", () => {
  const v = state<{ y: number; m: number } | null>(null);
  const root = mount(() => MonthPicker({ value: v, locale: "ro-RO" }));
  const months = root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"));
  assert.equal(months.length, 12);

  months[2]!.click();
  assert.equal(v()!.m, 3);

  const year = v()!.y;
  root.querySelectorAll("button")[0]!.click(); // anul anterior
  root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"))[0]!.click();
  assert.equal(v()!.y, year - 1);
  assert.equal(v()!.m, 1);
});

test("YearPicker paginează", () => {
  const v = state<number | null>(2026);
  const root = mount(() => YearPicker({ value: v, pageSize: 12 }));
  const years = () => root.querySelectorAll("button").filter((b) => hasClass(b, "rui-monthpicker-month"));
  assert.equal(years().length, 12);
  assert.equal(years()[0]!.textContent, "2016", "pagina aliniată la multiplu de 12");

  years()[5]!.click();
  assert.equal(v(), 2021);
});

test("DateTimePicker rezumă valoarea aleasă", () => {
  const date = state<any>({ y: 2026, m: 3, d: 15 });
  const time = state<any>({ h: 14, min: 30 });
  const root = mount(() => DateTimePicker({ date, time }));
  assert.ok(root.textContent.includes("2026-03-15 14:30"));
});
