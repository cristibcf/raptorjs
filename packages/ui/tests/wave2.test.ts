import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "@raptor/dom/testing";
import { render, R, SVG_NS, isSvgTag } from "@raptor/dom";
import { state, createRoot } from "@raptor/core";
import { Progress, CircularProgress } from "../src/progress.ts";
import { Slider, RangeSlider } from "../src/slider.ts";
import { Sparkline } from "../src/sparkline.ts";
import { splitPane } from "../src/split-pane.ts";
import { combobox } from "../src/combobox.ts";
import { dataGrid, type GridColumn } from "../src/data-grid.ts";
import { positioner } from "../src/primitives/positioner.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}

/** Trage manerul: pointerdown, N mișcări, pointerup. */
function drag(el: MiniElement, from: number, moves: number[], vertical = false): void {
  const pt = (v: number) => (vertical ? { clientX: 0, clientY: v } : { clientX: v, clientY: 0 });
  el.dispatch("pointerdown", { ...pt(from), button: 0 });
  for (const m of moves) el.dispatch("pointermove", pt(m));
  el.dispatch("pointerup", pt(moves[moves.length - 1] ?? from));
}

/* ------------------------------------------------------------ SVG runtime -- */

test("createElement folosește namespace-ul SVG pentru tagurile SVG", () => {
  assert.equal(isSvgTag("svg"), true);
  assert.equal(isSvgTag("path"), true);
  assert.equal(isSvgTag("div"), false);
  // `a` e ambiguu (HTML și SVG) — intenționat NU e tratat ca SVG.
  assert.equal(isSvgTag("a"), false);

  const el = R.svg({ width: "10" }, R.path({ d: "M0 0" })) as any;
  assert.equal(el.namespaceURI, SVG_NS);
  assert.equal(el.childNodes[0].namespaceURI, SVG_NS);
  assert.equal((R.div() as any).namespaceURI, undefined);
});

/* ------------------------------------------------------------- 149 Progress */

test("Progress expune ARIA corect și se umple proporțional", () => {
  const root = div();
  const value = state(25);
  render(() => Progress({ value: () => value(), label: "Încărcare" }), root);

  const bar = root.querySelector("div")!;
  assert.equal(bar.getAttribute("role"), "progressbar");
  assert.equal(bar.getAttribute("aria-valuemin"), "0");
  assert.equal(bar.getAttribute("aria-valuemax"), "100");
  assert.equal(bar.getAttribute("aria-valuenow"), "25");
  assert.equal(bar.getAttribute("aria-label"), "Încărcare");

  const fill = root.querySelectorAll("div").find((d) => d.getAttribute("class") === "rui-progress-fill")!;
  assert.equal(fill.getAttribute("style"), "width:25.00%");

  value.set(80);
  assert.equal(fill.getAttribute("style"), "width:80.00%");
  assert.equal(bar.getAttribute("aria-valuenow"), "80");
});

test("Progress plafonează în afara intervalului și respectă min/max custom", () => {
  const root = div();
  const value = state(-50);
  render(() => Progress({ value: () => value(), min: 0, max: 200 }), root);
  const fill = root.querySelectorAll("div").find((d) => d.getAttribute("class") === "rui-progress-fill")!;

  assert.equal(fill.getAttribute("style"), "width:0.00%");
  value.set(100);
  assert.equal(fill.getAttribute("style"), "width:50.00%");
  value.set(9999);
  assert.equal(fill.getAttribute("style"), "width:100.00%");
});

test("Progress nedeterminat nu expune aria-valuenow", () => {
  const root = div();
  render(() => Progress({ indeterminate: true }), root);
  const bar = root.querySelector("div")!;
  assert.equal(bar.getAttribute("aria-valuenow"), null);
  assert.equal(bar.getAttribute("data-indeterminate"), "true");
});

test("TEZĂ: 100 de pași de progres = 0 noduri create", () => {
  const root = div();
  const value = state(0);
  render(() => Progress({ value: () => value() }), root);

  resetStats();
  for (let i = 1; i <= 100; i++) value.set(i);

  assert.equal(stats.createElement, 0, "zero elemente");
  assert.equal(stats.createText, 0, "zero text-noduri");
  // Două atribute per pas: lățimea umpluturii + aria-valuenow.
  assert.equal(stats.setAttribute, 200);
});

test("CircularProgress mișcă doar stroke-dashoffset", () => {
  const root = div();
  const value = state(0);
  render(() => CircularProgress({ value: () => value(), size: 40, thickness: 4 }), root);

  const svg = root.querySelector("svg")!;
  assert.equal((svg as any).namespaceURI, SVG_NS);

  const fill = root.querySelectorAll("circle").find((c) => c.getAttribute("class") === "rui-circular-fill")!;
  const circumference = 2 * Math.PI * 18;
  assert.equal(fill.getAttribute("stroke-dashoffset"), circumference.toFixed(2));

  resetStats();
  value.set(50);
  assert.equal(Number(fill.getAttribute("stroke-dashoffset")), Number((circumference / 2).toFixed(2)));
  assert.equal(stats.createElement, 0);
});

/* --------------------------------------------------------------- 65 Slider */

function mountSlider(props: any): { root: MiniElement; thumb: MiniElement; el: any } {
  const root = div();
  let el: any = null;
  render(() => {
    el = Slider(props);
    el.setTrack(0, 200); // pistă de 200px începând la x=0
    return el;
  }, root);
  const thumb = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "slider")!;
  return { root, thumb, el };
}

test("Slider expune ARIA de slider și poziționează mânerul", () => {
  const value = state(25);
  const { thumb } = mountSlider({ value, min: 0, max: 100, label: "Volum" });

  assert.equal(thumb.getAttribute("role"), "slider");
  assert.equal(thumb.getAttribute("aria-valuemin"), "0");
  assert.equal(thumb.getAttribute("aria-valuemax"), "100");
  assert.equal(thumb.getAttribute("aria-valuenow"), "25");
  assert.equal(thumb.getAttribute("aria-orientation"), "horizontal");
  assert.equal(thumb.getAttribute("aria-label"), "Volum");
  assert.equal(thumb.getAttribute("style"), "left:25.000%");

  value.set(60);
  assert.equal(thumb.getAttribute("style"), "left:60.000%");
});

test("Slider: tragerea mapează poziția pe valoare, cu cuantizare și plafonare", () => {
  const value = state(0);
  const { thumb } = mountSlider({ value, min: 0, max: 100, step: 10 });

  drag(thumb, 0, [50]); // 50/200 = 25% -> 25 -> cuantizat la 30
  assert.equal(value(), 30);

  drag(thumb, 0, [104]); // 52% -> 50
  assert.equal(value(), 50);

  drag(thumb, 0, [9999]);
  assert.equal(value(), 100, "plafonat la max");

  drag(thumb, 0, [-9999]);
  assert.equal(value(), 0, "plafonat la min");
});

test("Slider: tastatura respectă step, PageUp/Down, Home/End", () => {
  const value = state(50);
  const { thumb } = mountSlider({ value, min: 0, max: 100, step: 5 });

  thumb.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(value(), 55);
  thumb.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(value(), 50);
  thumb.dispatch("keydown", { key: "PageUp" });
  assert.equal(value(), 60);
  thumb.dispatch("keydown", { key: "PageDown" });
  assert.equal(value(), 50);
  thumb.dispatch("keydown", { key: "End" });
  assert.equal(value(), 100);
  thumb.dispatch("keydown", { key: "Home" });
  assert.equal(value(), 0);
});

test("Slider dezactivat nu răspunde", () => {
  const value = state(40);
  const { thumb } = mountSlider({ value, disabled: () => true });

  drag(thumb, 0, [100]);
  assert.equal(value(), 40);
  thumb.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(value(), 40);
  assert.equal(thumb.getAttribute("tabindex"), "-1");
  assert.equal(thumb.getAttribute("aria-disabled"), "true");
});

test("TEZĂ: un drag de 60 de frame-uri pe Slider = 0 noduri create", () => {
  const value = state(0);
  const { thumb } = mountSlider({ value, min: 0, max: 200, step: 0 });

  resetStats();
  thumb.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  for (let i = 1; i <= 60; i++) thumb.dispatch("pointermove", { clientX: i, clientY: 0 });
  thumb.dispatch("pointerup", { clientX: 60, clientY: 0 });

  assert.equal(value(), 60);
  assert.equal(stats.createElement, 0, "zero elemente în 60 de frame-uri");
  assert.equal(stats.createText, 0, "zero text-noduri");
});

test("RangeSlider: mânerele nu se depășesc", () => {
  const root = div();
  const value = state<readonly [number, number]>([20, 80]);
  let el: any = null;
  render(() => {
    el = RangeSlider({ value, min: 0, max: 100, step: 1 });
    el.setTrack(0, 100);
    return el;
  }, root);

  const thumbs = root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "slider");
  assert.equal(thumbs.length, 2);
  assert.equal(thumbs[0]!.getAttribute("aria-valuenow"), "20");
  assert.equal(thumbs[1]!.getAttribute("aria-valuenow"), "80");

  // Mânerul de jos împins peste cel de sus se oprește la el.
  drag(thumbs[0]!, 0, [95]);
  assert.deepEqual(value(), [80, 80]);

  // Mânerul de sus împins sub cel de jos se oprește la el.
  drag(thumbs[1]!, 0, [10]);
  assert.deepEqual(value(), [80, 80]);
});

/* ------------------------------------------------------------ 162 Sparkline */

test("Sparkline desenează un path scalat la date", () => {
  const root = div();
  const data = state<readonly number[]>([0, 5, 10]);
  render(() => Sparkline({ data: () => data(), width: 100, height: 20, thickness: 2 }), root);

  const path = root.querySelector("path")!;
  assert.equal((path as any).namespaceURI, SVG_NS);
  const d = path.getAttribute("d")!;
  assert.ok(d.startsWith("M2.00 18.00"), "primul punct = minim = jos: " + d);
  assert.ok(d.endsWith("L98.00 2.00"), "ultimul punct = maxim = sus: " + d);
});

test("Sparkline: serie constantă nu împarte la zero", () => {
  const root = div();
  render(() => Sparkline({ data: () => [7, 7, 7], width: 100, height: 20 }), root);
  const d = root.querySelector("path")!.getAttribute("d")!;
  assert.ok(!d.includes("NaN"), "fără NaN: " + d);
});

test("Sparkline goală nu aruncă", () => {
  const root = div();
  render(() => Sparkline({ data: () => [] }), root);
  // `d=""` e SVG valid si nu randeaza nimic; stringul gol e o valoare, nu o stergere.
  assert.equal(root.querySelector("path")!.getAttribute("d"), "");
});

test("TEZĂ: 200 de tick-uri de date live = 0 noduri, doar `d` rescris", () => {
  const root = div();
  const data = state<readonly number[]>([1, 2, 3]);
  render(() => Sparkline({ data: () => data(), width: 100, height: 20 }), root);

  resetStats();
  for (let i = 0; i < 200; i++) {
    data.update((prev) => [...prev.slice(-19), i]);
  }

  assert.equal(stats.createElement, 0, "zero elemente în 200 de tick-uri");
  assert.equal(stats.createText, 0);
  assert.equal(stats.setAttribute, 200, "exact o rescriere de `d` per tick");
});

/* ------------------------------------------------------------ 12 SplitPane */

test("SplitPane leagă mărimea de stilul primului panou", () => {
  const root = div();
  const sp = createRoot(() => splitPane({ first: "stânga", second: "dreapta", initial: 240, min: 100, max: 600 }));
  render(() => sp.el, root);

  const first = root.querySelectorAll("div").find((d) => d.getAttribute("class") === "rui-split-first")!;
  assert.equal(first.getAttribute("style"), "width:240px");

  const handle = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "separator")!;
  drag(handle, 0, [60]);
  assert.equal(sp.size(), 300);
  assert.equal(first.getAttribute("style"), "width:300px");
});

test("SplitPane colapsează sub minim și revine la toggle", () => {
  const sp = createRoot(() => splitPane({ first: "a", second: "b", initial: 240, min: 120, collapsible: true }));

  sp.setSize(200);
  assert.equal(sp.collapsed(), false);

  sp.setSize(50); // sub min -> colaps
  assert.equal(sp.size(), 0);
  assert.equal(sp.collapsed(), true);

  sp.toggle();
  assert.equal(sp.collapsed(), false);
  assert.equal(sp.size(), 200, "revine la ultima mărime validă");
});

test("TEZĂ: un drag de 60 de frame-uri pe SplitPane = 0 noduri create", () => {
  const root = div();
  const sp = createRoot(() => splitPane({ first: R.span("stânga"), second: R.span("dreapta"), initial: 200, min: 0, max: 800 }));
  render(() => sp.el, root);
  const handle = root.querySelectorAll("div").find((d) => d.getAttribute("role") === "separator")!;

  resetStats();
  handle.dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0 });
  for (let i = 1; i <= 60; i++) handle.dispatch("pointermove", { clientX: i * 2, clientY: 0 });
  handle.dispatch("pointerup", { clientX: 120, clientY: 0 });

  assert.equal(sp.size(), 320);
  assert.equal(stats.createElement, 0);
  assert.equal(stats.createText, 0);
});

/* ------------------------------------------------------------ 123 Positioner */

const VIEW = { x: 0, y: 0, width: 1000, height: 600 };

test("positioner: plasament de bază bottom-start", () => {
  const p = createRoot(() => positioner({ placement: "bottom-start", offset: 4 }));
  p.update({
    reference: { x: 100, y: 100, width: 80, height: 30 },
    floating: { x: 0, y: 0, width: 200, height: 150 },
    viewport: VIEW,
  });
  assert.equal(p.x(), 100);
  assert.equal(p.y(), 134);
  assert.equal(p.placement(), "bottom-start");
  assert.equal(p.style(), "position:fixed;left:100px;top:134px");
});

test("positioner: flip când nu încape jos", () => {
  const p = createRoot(() => positioner({ placement: "bottom-start", offset: 4 }));
  // Referință lângă marginea de jos: sub ea nu mai încap 150px.
  p.update({
    reference: { x: 100, y: 520, width: 80, height: 30 },
    floating: { x: 0, y: 0, width: 200, height: 150 },
    viewport: VIEW,
  });
  assert.equal(p.placement(), "top-start");
  assert.equal(p.y(), 520 - 150 - 4);
});

test("positioner: shift pe axa secundară ca să rămână în ecran", () => {
  const p = createRoot(() => positioner({ placement: "bottom-start", offset: 4, padding: 8 }));
  // Referință lângă marginea din dreapta: lista de 200px ar ieși.
  p.update({
    reference: { x: 950, y: 100, width: 40, height: 30 },
    floating: { x: 0, y: 0, width: 200, height: 100 },
    viewport: VIEW,
  });
  assert.equal(p.x(), 1000 - 200 - 8, "glisat înăuntru, nu tăiat");
});

test("positioner: fără flip păstrează plasamentul cerut", () => {
  const p = createRoot(() => positioner({ placement: "bottom-start", flip: false, shift: false, offset: 4 }));
  p.update({
    reference: { x: 100, y: 520, width: 80, height: 30 },
    floating: { x: 0, y: 0, width: 200, height: 150 },
    viewport: VIEW,
  });
  assert.equal(p.placement(), "bottom-start");
  assert.equal(p.y(), 554);
});

/* ------------------------------------------------------------- 58 Combobox */

interface Fruit { id: number; name: string }
const FRUITS: Fruit[] = [
  { id: 1, name: "Măr" },
  { id: 2, name: "Pară" },
  { id: 3, name: "Prună" },
  { id: 4, name: "Piersică" },
];

function mountCombo(extra: Record<string, unknown> = {}) {
  const root = div();
  const value = state<Fruit | null>(null);
  const cb = createRoot(() =>
    combobox<Fruit>({
      options: () => FRUITS,
      value,
      label: (f) => f.name,
      ...extra,
    }),
  );
  render(() => cb.el, root);
  const input = () => root.querySelector("input")!;
  const options = () => root.querySelectorAll("li").filter((li) => li.getAttribute("role") === "option");
  return { root, value, cb, input, options };
}

test("Combobox: ARIA de combobox și listbox", () => {
  const { input, cb, options } = mountCombo({ ariaLabel: "Fruct" });

  assert.equal(input().getAttribute("role"), "combobox");
  assert.equal(input().getAttribute("aria-expanded"), "false");
  assert.equal(input().getAttribute("aria-autocomplete"), "list");
  assert.equal(input().getAttribute("aria-label"), "Fruct");

  input().dispatch("focus");
  assert.equal(cb.open(), true);
  assert.equal(input().getAttribute("aria-expanded"), "true");
  assert.equal(options().length, 4);
  // Focusul rămâne în input; opțiunea activă e semnalată prin id.
  assert.equal(input().getAttribute("aria-activedescendant"), options()[0]!.getAttribute("id"));
});

test("Combobox filtrează la tastare", () => {
  const { input, options } = mountCombo();
  input().dispatch("focus");

  input().dispatch("input", { target: { value: "pr" } });
  assert.deepEqual(options().map((o) => o.textContent), ["Prună"]);

  input().dispatch("input", { target: { value: "p" } });
  assert.deepEqual(options().map((o) => o.textContent), ["Pară", "Prună", "Piersică"]);

  input().dispatch("input", { target: { value: "zzz" } });
  assert.equal(options().length, 0);
  assert.ok(input().parentNode!.textContent.includes("Niciun rezultat"));
});

test("TEZĂ: filtrarea păstrează nodurile opțiunilor rămase", () => {
  const { input, options } = mountCombo();
  input().dispatch("focus");
  input().dispatch("input", { target: { value: "p" } });

  const before = options().map((o) => o.id);
  assert.equal(before.length, 3);

  resetStats();
  input().dispatch("input", { target: { value: "pr" } });

  const after = options().map((o) => o.id);
  assert.deepEqual(after, [before[1]], "`Prună` și-a păstrat exact nodul");
  assert.equal(stats.createElement, 0, "zero elemente create la filtrare");
});

test("Combobox: săgeți + Enter selectează, Escape închide", () => {
  const { input, value, cb } = mountCombo();
  input().dispatch("focus");

  input().dispatch("keydown", { key: "ArrowDown" });
  input().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Pară");
  assert.equal(cb.open(), false);
  assert.equal(cb.query(), "Pară");

  input().dispatch("focus");
  input().dispatch("keydown", { key: "Escape" });
  assert.equal(cb.open(), false);
  assert.equal(cb.query(), "Pară", "textul revine la selecție");
});

test("Combobox: opțiunile dezactivate sunt sărite de săgeți", () => {
  const { input, value } = mountCombo({ disabled: (f: Fruit) => f.name === "Pară" });
  input().dispatch("focus");

  input().dispatch("keydown", { key: "ArrowDown" }); // sare peste Pară -> Prună
  input().dispatch("keydown", { key: "Enter" });
  assert.equal(value()!.name, "Prună");
});

test("Combobox: click pe opțiune selectează", () => {
  const { input, options, value } = mountCombo();
  input().dispatch("focus");
  options()[3]!.click();
  assert.equal(value()!.name, "Piersică");
});

/* ------------------------------------------------------------ 127 DataGrid */

interface Row { id: number; name: string; qty: number }

function makeRows(n: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < n; i++) out.push({ id: i, name: "rând " + i, qty: (i * 7) % 100 });
  return out;
}

const GRID_COLS: GridColumn<Row>[] = [
  { key: "name", header: "Nume", cell: (r) => r.name, sort: (a, b) => a.name.localeCompare(b.name), width: 200 },
  { key: "qty", header: "Cant.", cell: (r) => String(r.qty), sort: (a, b) => a.qty - b.qty, align: "right", width: 100 },
];

function mountGrid(n: number, extra: Record<string, unknown> = {}) {
  const root = div();
  const rows = state<readonly Row[]>(makeRows(n));
  const g = createRoot(() =>
    dataGrid<Row>({ rows: () => rows(), columns: GRID_COLS, rowHeight: 20, height: 200, overscan: 2, ...extra }),
  );
  render(() => g.el, root);
  const bodyRows = () => root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "row" && d.getAttribute("aria-rowindex") != null);
  return { root, rows, g, bodyRows };
}

test("DataGrid randează doar fereastra vizibilă din 50.000 de rânduri", () => {
  const { g, bodyRows, root } = mountGrid(50000);

  // 200px / 20px = 10 vizibile + 2*2 overscan = 14.
  assert.equal(g.visibleCount(), 14);
  assert.equal(bodyRows().length, 14, "14 rânduri în DOM din 50.000");
  assert.equal(root.querySelector("div")!.getAttribute("aria-rowcount"), "50001");
});

test("TEZĂ: derularea printr-un rând creează cel mult un rând nou", () => {
  const { g, bodyRows } = mountGrid(50000);
  assert.equal(bodyRows().length, 14);

  resetStats();
  g.setScroll(20); // exact un rând

  assert.equal(bodyRows().length, 14, "fereastra rămâne de aceeași mărime");
  // Un rând nou = 1 container + 2 celule = 3 elemente. Nu 14 rânduri.
  assert.ok(stats.createElement <= 3, "cel mult un rând nou (3 elemente), au fost: " + stats.createElement);
});

test("DataGrid sortează la click pe header", () => {
  const { root, bodyRows } = mountGrid(20);
  const headers = root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "columnheader");
  assert.equal(headers.length, 2);

  const qtyHeader = headers[1]!;
  assert.equal(qtyHeader.getAttribute("aria-sort"), "none");

  qtyHeader.click();
  assert.equal(qtyHeader.getAttribute("aria-sort"), "ascending");
  const cellText = (row: MiniElement, i: number): string =>
    (row.childNodes[i] as MiniElement).textContent;
  const firstQty = cellText(bodyRows()[0]!, 1);
  assert.equal(firstQty, "0");

  qtyHeader.click();
  assert.equal(qtyHeader.getAttribute("aria-sort"), "descending");
  assert.equal(cellText(bodyRows()[0]!, 1), "98");
});

test("DataGrid: coloanele redimensionabile rescriu grid-template", () => {
  const { root } = mountGrid(10);
  const head = root.querySelectorAll("div").find((d) => d.getAttribute("class") === "rui-grid-head")!;
  assert.equal(head.getAttribute("style"), "display:grid;grid-template-columns:200px 100px");

  const handle = root.querySelectorAll("span").find((s) => s.getAttribute("class") === "rui-grid-col-resize")!;
  drag(handle, 0, [50]);
  assert.equal(head.getAttribute("style"), "display:grid;grid-template-columns:250px 100px");
});

test("DataGrid: stare goală", () => {
  const { root } = mountGrid(0, { empty: "Nimic de arătat" });
  assert.ok(root.textContent.includes("Nimic de arătat"));
});

test("DataGrid: selecția marchează rândul", () => {
  const selected = state<ReadonlySet<Row>>(new Set());
  const { bodyRows } = mountGrid(10, { selected });

  bodyRows()[0]!.click();
  assert.equal(selected().size, 1);
  assert.ok(bodyRows()[0]!.getAttribute("class")!.includes("rui-selected"));

  bodyRows()[0]!.click();
  assert.equal(selected().size, 0);
});
