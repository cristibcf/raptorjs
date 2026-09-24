/**
 * App RaptorJS pentru js-framework-benchmark in browser. Fine-grained: fiecare
 * rand are semnale proprii `label` si `selected`; update/select ating exact
 * text-node-ul / atributul afectat, fara diff de lista.
 */
import {
  render,
  createElement,
  template,
  applyProps,
  mountChild,
  For,
  state,
  batch,
  type State,
} from "../../../../packages/dom/src/index.ts";
import type { BenchApp } from "../contract.ts";
import { buildData, type Row } from "../data.ts";

interface Handle {
  id: number;
  label: State<string>;
  selected: State<boolean>;
}

// #3: schelet static de rand, clonat per instanta (fara createElement per nod).
const rowTemplate = template(() => {
  const tr = createElement("tr");
  const tdId = createElement("td");
  applyProps(tdId, { class: "col-id" });
  const tdLabel = createElement("td");
  applyProps(tdLabel, { class: "col-label" });
  mountChild(tr, tdId, null);
  mountChild(tr, tdLabel, null);
  return tr;
});

export function mountRaptor(container: HTMLElement): BenchApp {
  const list = state<Handle[]>([]);
  let selected: Handle | null = null;

  function toHandle(row: Row): Handle {
    return { id: row.id, label: state(row.label), selected: state(false) };
  }

  function rowView(h: Handle): any {
    const tr = rowTemplate(); // clona scheletului (class-urile td vin din prototip)
    const tdId = tr.childNodes[0];
    const tdLabel = tr.childNodes[1];
    applyProps(tr, { class: () => (h.selected() ? "danger" : "") });
    mountChild(tdId, h.id, null); // id static
    mountChild(tdLabel, () => h.label(), null); // label dinamic fine-grained
    return tr;
  }

  function App(): any {
    const table = createElement("table");
    applyProps(table, { class: "table" });
    const tbody = createElement("tbody");
    mountChild(tbody, For<Handle>({ each: () => list(), children: rowView }), null);
    mountChild(table, tbody, null);
    return table;
  }

  render(App, container);

  return {
    run(n: number): void {
      selected = null;
      list.set(buildData(n).map(toHandle));
    },
    append(n: number): void {
      list.update((cur) => cur.concat(buildData(n).map(toHandle)));
    },
    update(): void {
      batch(() => {
        const arr = list.peek();
        for (let i = 0; i < arr.length; i += 10) arr[i]!.label.update((l) => l + " !!!");
      });
    },
    select(index: number): void {
      const arr = list.peek();
      const target = arr[index];
      if (!target) return;
      batch(() => {
        if (selected) selected.selected.set(false);
        target.selected.set(true);
        selected = target;
      });
    },
    remove(index: number): void {
      list.update((cur) => {
        const next = cur.slice();
        next.splice(index, 1);
        return next;
      });
    },
    swap(): void {
      list.update((cur) => {
        if (cur.length < 999) return cur;
        const next = cur.slice();
        const a = 1;
        const b = next.length - 2;
        const tmp = next[a]!;
        next[a] = next[b]!;
        next[b] = tmp;
        return next;
      });
    },
    clear(): void {
      selected = null;
      list.set([]);
    },
    count(): number {
      return list.peek().length;
    },
  };
}
