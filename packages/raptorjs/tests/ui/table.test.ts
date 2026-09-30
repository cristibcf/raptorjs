import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "raptorjs/dom/testing";
import { render } from "raptorjs/dom";
import { state } from "raptorjs";
import { Table, type Column } from "../../src/ui/table.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: any }).document;

interface Row {
  id: number;
  name: string;
  qty: number;
}

const ROWS: Row[] = [
  { id: 1, name: "Charlie", qty: 3 },
  { id: 2, name: "alice", qty: 10 },
  { id: 3, name: "Bob", qty: 2 },
];

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: "qty", header: "Qty", cell: (r) => String(r.qty), sort: (a, b) => a.qty - b.qty, align: "right" },
  { key: "note", header: "Note", cell: () => "-" },
];

function mount(props: Parameters<typeof Table<Row>>[0]) {
  const root = doc.createElement("div") as MiniElement;
  const dispose = render(() => Table(props), root);
  const names = () => root.querySelectorAll("td").filter((_, i) => i % 3 === 0).map((td) => td.textContent);
  return { root, dispose, names };
}

test("renders the table head and the rows in the given order", () => {
  const rows = state<readonly Row[]>(ROWS);
  const { root, names } = mount({ rows: () => rows(), columns: COLUMNS });

  assert.deepEqual(root.querySelectorAll("th").map((th) => th.textContent.replace(/[↑↓]/g, "")), ["Name", "Qty", "Note"]);
  assert.deepEqual(names(), ["Charlie", "alice", "Bob"]);
});

test("clicking the header sorts, the second click reverses", () => {
  const rows = state<readonly Row[]>(ROWS);
  const { root, names } = mount({ rows: () => rows(), columns: COLUMNS });
  const nameTh = root.querySelectorAll("th")[0]!;

  nameTh.click();
  assert.deepEqual(names(), ["alice", "Bob", "Charlie"]);
  assert.equal(nameTh.getAttribute("aria-sort"), "ascending");

  nameTh.click();
  assert.deepEqual(names(), ["Charlie", "Bob", "alice"]);
  assert.equal(nameTh.getAttribute("aria-sort"), "descending");
});

test("sorting MOVES the rows, doesn't recreate them (fine-grained thesis)", () => {
  const rows = state<readonly Row[]>(ROWS);
  const { root } = mount({ rows: () => rows(), columns: COLUMNS });

  resetStats();
  root.querySelectorAll("th")[0]!.click();

  // Zero new elements and zero new text-nodes: only reordering via insert.
  assert.equal(stats.createElement, 0);
  assert.equal(stats.createText, 0);
  assert.ok(stats.insert > 0, "the rows must have been moved");
});

test("a column without a comparator is not sortable", () => {
  const rows = state<readonly Row[]>(ROWS);
  const { root, names } = mount({ rows: () => rows(), columns: COLUMNS });
  const noteTh = root.querySelectorAll("th")[2]!;

  assert.equal(noteTh.getAttribute("aria-sort"), "none");
  noteTh.click();
  assert.deepEqual(names(), ["Charlie", "alice", "Bob"]);
  assert.equal(noteTh.getAttribute("aria-sort"), "none");
});

test("a reactive cell updates only its own text-node", () => {
  const qty = state(5);
  const row: Row = { id: 1, name: "x", qty: 0 };
  const rows = state<readonly Row[]>([row]);
  const { root } = mount({
    rows: () => rows(),
    columns: [{ key: "qty", header: "Qty", cell: () => () => String(qty()) }],
  });

  assert.equal(root.querySelector("td")!.textContent, "5");
  resetStats();
  qty.set(6);
  assert.equal(root.querySelector("td")!.textContent, "6");
  assert.equal(stats.createElement, 0);
  assert.equal(stats.textUpdate, 1);
});

test("the empty state appears and disappears without touching the rest of the table", () => {
  const rows = state<readonly Row[]>([]);
  const { root } = mount({ rows: () => rows(), columns: COLUMNS, empty: "Nothing here" });

  assert.equal(root.querySelector("tbody")!.textContent, "Nothing here");
  rows.set(ROWS);
  assert.equal(root.querySelectorAll("td").length, 9);
  assert.ok(!root.querySelector("tbody")!.textContent.includes("Nothing here"));
});

test("selection toggles and is reflected in aria-selected", () => {
  const rows = state<readonly Row[]>(ROWS);
  const selected = state<ReadonlySet<Row>>(new Set());
  const { root } = mount({ rows: () => rows(), columns: COLUMNS, selected });

  const bodyRows = () => root.querySelectorAll("tr").slice(1);
  bodyRows()[0]!.click();
  assert.equal(bodyRows()[0]!.getAttribute("aria-selected"), "true");
  assert.equal(selected().size, 1);

  bodyRows()[1]!.click();
  assert.equal(selected().size, 2);

  bodyRows()[0]!.click();
  assert.equal(bodyRows()[0]!.getAttribute("aria-selected"), "false");
  assert.equal(selected().size, 1);
});

test("multiple:false keeps a single row selected", () => {
  const rows = state<readonly Row[]>(ROWS);
  const selected = state<ReadonlySet<Row>>(new Set());
  const { root } = mount({ rows: () => rows(), columns: COLUMNS, selected, multiple: false });

  const bodyRows = () => root.querySelectorAll("tr").slice(1);
  bodyRows()[0]!.click();
  bodyRows()[1]!.click();
  assert.equal(selected().size, 1);
  assert.equal([...selected()][0]!.name, "alice");
});
