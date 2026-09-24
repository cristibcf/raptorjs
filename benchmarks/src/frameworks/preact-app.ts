/**
 * App Preact 10 pentru DOM benchmark. VDOM ca React, dar minuscul. Randuri
 * keyed. Conducem update-urile re-apeland `render()` la nivel de top: diff-ul
 * top-level al Preact e sincron, deci masuratoarea e curata (fara flushSync).
 */
import { h, render, type VNode } from "preact";
import type { BenchApp, RowData } from "../common.ts";

function Row(props: { id: number; label: string }): VNode {
  return h("tr", null, h("td", null, props.id), h("td", null, props.label));
}

function Table(props: { rows: RowData[] }): VNode {
  return h(
    "table",
    null,
    h(
      "tbody",
      { id: "tbody" },
      props.rows.map((r) => h(Row, { key: r.id, id: r.id, label: r.label })),
    ),
  );
}

export function mountPreact(container: any): BenchApp {
  let current: RowData[] = [];

  function apply(rows: RowData[]): void {
    current = rows;
    render(h(Table, { rows }), container);
  }

  // Montare initiala (goala).
  apply([]);

  return {
    create: apply,
    updateAll: apply,
    updatePartial: apply,
    clear(): void {
      apply([]);
    },
    count(): number {
      return current.length;
    },
    firstLabel(): string {
      return current[0]?.label ?? "";
    },
  };
}
