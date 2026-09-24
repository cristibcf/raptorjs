/**
 * App Solid 1.9 IDIOMATIC, compilat cu babel-preset-solid (JSX -> template-uri
 * DOM fine-grained la compile-time). Aceasta e calea reala de performanta a
 * Solid — spre deosebire de hyperscript. `createStore` + `produce` dau
 * update-uri chirurgicale exact ca in benchmark-ul oficial Solid.
 */
import { For, createSignal, batch, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import type { BenchApp } from "../contract.ts";
import { buildData, type Row } from "../data.ts";

export function mountSolid(container: HTMLElement): BenchApp {
  const [rows, setRows] = createStore<Row[]>([]);
  const [selected, setSelected] = createSignal(-1);

  const App = (): JSX.Element => (
    <table class="table">
      <tbody>
        <For each={rows}>
          {(row) => (
            <tr class={selected() === row.id ? "danger" : ""}>
              <td class="col-id">{row.id}</td>
              <td class="col-label">{row.label}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );

  render(() => <App />, container);

  return {
    run(n: number): void {
      batch(() => {
        setSelected(-1);
        setRows(buildData(n));
      });
    },
    append(n: number): void {
      const extra = buildData(n);
      setRows(produce((d) => d.push(...extra)));
    },
    update(): void {
      setRows(
        produce((d) => {
          for (let i = 0; i < d.length; i += 10) d[i]!.label += " !!!";
        }),
      );
    },
    select(index: number): void {
      const target = rows[index];
      if (target) setSelected(target.id);
    },
    remove(index: number): void {
      setRows(produce((d) => d.splice(index, 1)));
    },
    swap(): void {
      if (rows.length < 999) return;
      const b = rows.length - 2;
      setRows(
        produce((d) => {
          const tmp = d[1]!;
          d[1] = d[b]!;
          d[b] = tmp;
        }),
      );
    },
    clear(): void {
      batch(() => {
        setSelected(-1);
        setRows([]);
      });
    },
    count(): number {
      return rows.length;
    },
  };
}
