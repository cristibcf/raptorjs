/**
 * App React 19 pentru DOM benchmark. Idiomatic: randuri keyed, componenta Row
 * memoizata (React.memo) ca randurile neschimbate sa nu se re-randeze. State la
 * radacina; update = setState cu un array nou, fortat sincron cu flushSync
 * pentru masuratori corecte.
 */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { BenchApp, RowData } from "../common.ts";

const h = React.createElement;

const Row = React.memo(function Row(props: { id: number; label: string }) {
  return h("tr", null, h("td", null, props.id), h("td", null, props.label));
});

export function mountReact(container: any): BenchApp {
  let setRows: ((rows: RowData[]) => void) | null = null;
  let current: RowData[] = [];

  function App(): React.ReactElement {
    const [rows, setter] = React.useState<RowData[]>([]);
    setRows = setter;
    current = rows;
    return h(
      "table",
      null,
      h(
        "tbody",
        { id: "tbody" },
        rows.map((r) => h(Row, { key: r.id, id: r.id, label: r.label })),
      ),
    );
  }

  const root: Root = createRoot(container);
  flushSync(() => root.render(h(App)));

  function apply(rows: RowData[]): void {
    flushSync(() => setRows!(rows));
  }

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
