/**
 * App Preact 10 pentru js-framework-benchmark. VDOM keyed, condus prin re-render
 * top-level (diff sincron).
 */
import { h, render, type VNode } from "preact";
import type { BenchApp } from "../contract.ts";
import { buildData, type Row } from "../data.ts";

function RowView(props: { row: Row; selected: boolean }): VNode {
  return h(
    "tr",
    { class: props.selected ? "danger" : "" },
    h("td", { class: "col-id" }, props.row.id),
    h("td", { class: "col-label" }, props.row.label),
  );
}

export function mountPreact(container: HTMLElement): BenchApp {
  let rows: Row[] = [];
  let selected = -1;

  function draw(): void {
    render(
      h(
        "table",
        { class: "table" },
        h(
          "tbody",
          null,
          rows.map((row) => h(RowView, { key: row.id, row, selected: row.id === selected })),
        ),
      ),
      container,
    );
  }

  draw();

  return {
    run(n: number): void {
      selected = -1;
      rows = buildData(n);
      draw();
    },
    append(n: number): void {
      rows = rows.concat(buildData(n));
      draw();
    },
    update(): void {
      const next = rows.slice();
      for (let i = 0; i < next.length; i += 10) {
        next[i] = { id: next[i]!.id, label: next[i]!.label + " !!!" };
      }
      rows = next;
      draw();
    },
    select(index: number): void {
      const target = rows[index];
      if (!target) return;
      selected = target.id;
      draw();
    },
    remove(index: number): void {
      const next = rows.slice();
      next.splice(index, 1);
      rows = next;
      draw();
    },
    swap(): void {
      if (rows.length < 999) return;
      const next = rows.slice();
      const a = 1;
      const b = next.length - 2;
      const tmp = next[a]!;
      next[a] = next[b]!;
      next[b] = tmp;
      rows = next;
      draw();
    },
    clear(): void {
      selected = -1;
      rows = [];
      draw();
    },
    count(): number {
      return rows.length;
    },
  };
}
