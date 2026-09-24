/**
 * App RaptorJS pentru DOM benchmark. Idiomatic fine-grained: fiecare rand are
 * un semnal `label` propriu. Un update de eticheta atinge exact un text-node,
 * FARA re-run al listei si fara diff de VDOM.
 */
import {
  render,
  createElement,
  applyProps,
  mountChild,
  For,
  state,
  type State,
} from "../../../packages/dom/src/index.ts";
import type { BenchApp, RowData } from "../common.ts";

interface Handle {
  id: number;
  label: State<string>;
}

export function mountRaptor(container: any): BenchApp {
  const list = state<Handle[]>([]);
  const byId = new Map<number, Handle>();

  function rowView(h: Handle): any {
    const tr = createElement("tr");
    const tdId = createElement("td");
    mountChild(tdId, h.id, null);
    const tdLabel = createElement("td");
    // Binding reactiv fine-grained: doar acest text-node se schimba.
    mountChild(tdLabel, () => h.label(), null);
    mountChild(tr, tdId, null);
    mountChild(tr, tdLabel, null);
    return tr;
  }

  function App(): any {
    const table = createElement("table");
    const tbody = createElement("tbody");
    applyProps(tbody, { id: "tbody" });
    const forBlock = For<Handle>({ each: () => list(), children: (h) => rowView(h) });
    mountChild(tbody, forBlock, null);
    mountChild(table, tbody, null);
    return table;
  }

  const dispose = render(App, container);
  void dispose;

  function syncLabels(rows: RowData[]): void {
    for (const row of rows) {
      const h = byId.get(row.id);
      if (h) h.label.set(row.label);
    }
  }

  return {
    create(rows: RowData[]): void {
      byId.clear();
      const handles = rows.map((r) => {
        const h: Handle = { id: r.id, label: state(r.label) };
        byId.set(r.id, h);
        return h;
      });
      list.set(handles);
    },
    updateAll(rows: RowData[]): void {
      syncLabels(rows);
    },
    updatePartial(rows: RowData[]): void {
      syncLabels(rows);
    },
    clear(): void {
      byId.clear();
      list.set([]);
    },
    count(): number {
      return list().length;
    },
    firstLabel(): string {
      const first = list()[0];
      return first ? first.label.peek() : "";
    },
  };
}
