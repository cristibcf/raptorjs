/**
 * App React 19 pentru js-framework-benchmark. Idiomatic: randuri keyed,
 * componenta Row memoizata, state la radacina, flushSync pentru randare sincrona
 * (masuratori corecte).
 */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { BenchApp } from "../contract.ts";
import { buildData, type Row } from "../data.ts";

const h = React.createElement;

const RowView = React.memo(function RowView(props: {
  row: Row;
  selected: boolean;
}) {
  return h(
    "tr",
    { className: props.selected ? "danger" : "" },
    h("td", { className: "col-id" }, props.row.id),
    h("td", { className: "col-label" }, props.row.label),
  );
});

export function mountReact(container: HTMLElement): BenchApp {
  let setRows: ((r: Row[]) => void) | null = null;
  let setSelected: ((id: number) => void) | null = null;
  let rows: Row[] = [];
  let selected = -1;

  function App(): React.ReactElement {
    const [r, sr] = React.useState<Row[]>([]);
    const [sel, ss] = React.useState<number>(-1);
    setRows = sr;
    setSelected = ss;
    rows = r;
    selected = sel;
    return h(
      "table",
      { className: "table" },
      h(
        "tbody",
        null,
        r.map((row) => h(RowView, { key: row.id, row, selected: row.id === sel })),
      ),
    );
  }

  const root: Root = createRoot(container);
  flushSync(() => root.render(h(App)));

  return {
    run(n: number): void {
      flushSync(() => {
        setSelected!(-1);
        setRows!(buildData(n));
      });
    },
    append(n: number): void {
      flushSync(() => setRows!(rows.concat(buildData(n))));
    },
    update(): void {
      const next = rows.slice();
      for (let i = 0; i < next.length; i += 10) {
        next[i] = { id: next[i]!.id, label: next[i]!.label + " !!!" };
      }
      flushSync(() => setRows!(next));
    },
    select(index: number): void {
      const target = rows[index];
      if (target) flushSync(() => setSelected!(target.id));
    },
    remove(index: number): void {
      const next = rows.slice();
      next.splice(index, 1);
      flushSync(() => setRows!(next));
    },
    swap(): void {
      if (rows.length < 999) return;
      const next = rows.slice();
      const a = 1;
      const b = next.length - 2;
      const tmp = next[a]!;
      next[a] = next[b]!;
      next[b] = tmp;
      flushSync(() => setRows!(next));
    },
    clear(): void {
      flushSync(() => {
        setSelected!(-1);
        setRows!([]);
      });
    },
    count(): number {
      return rows.length;
    },
  };
}
