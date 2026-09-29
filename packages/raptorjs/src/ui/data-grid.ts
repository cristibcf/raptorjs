/**
 * DataGrid - tabel virtualizat cu coloane redimensionabile.
 *
 * Cea mai grea componenta-teza si cea mai convingatoare: cu 50.000 de randuri,
 * in DOM exista ~20. Derularea reutilizeaza nodurile randurilor ramase in
 * fereastra (`For` keyed pe indice, vezi `virtualizer`) si creeaza doar pentru
 * cele intrate. Tragerea unei coloane rescrie un singur atribut de stil.
 *
 * Nu foloseste `<table>`: un tabel real nu poate fi virtualizat corect (randurile
 * absolute strica layout-ul de tabel). Foloseste grid cu roluri ARIA de tabel,
 * asa cum fac toate grid-urile virtualizate serioase.
 */
import { state, derived, type Accessor, type State } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";
import { virtualizer } from "./primitives/virtualizer.ts";
import { resizable, type Resizable } from "./primitives/resizable.ts";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GridColumn<T> {
  key: string;
  header: Child;
  cell: (row: T, index: number) => Child;
  /** Latimea initiala in px. Implicit 160. */
  width?: number;
  minWidth?: number;
  /** Comparator ascendent; absenta lui face coloana nesortabila. */
  sort?: (a: T, b: T) => number;
  align?: "left" | "center" | "right";
  /** Coloana nu poate fi redimensionata. */
  fixed?: boolean;
}

export interface DataGridProps<T> {
  rows: Accessor<readonly T[]>;
  columns: readonly GridColumn<T>[];
  /** Inaltimea unui rand in px. Trebuie uniforma. Implicit 32. */
  rowHeight?: number;
  /** Inaltimea zonei derulabile in px. Implicit 400. */
  height?: number;
  /** Randuri randate in plus la fiecare capat. Implicit 4. */
  overscan?: number;
  sort?: { key: string; dir: "asc" | "desc" };
  selected?: State<ReadonlySet<T>>;
  onRowClick?: (row: T, index: number) => void;
  empty?: Child;
  class?: string;
}

export interface DataGrid {
  el: El;
  /** Punte de test: impinge metricile de scroll fara layout real. */
  setScroll: (offset: number) => void;
  setViewport: (size: number) => void;
  scrollTo: (index: number) => void;
  visibleCount: Accessor<number>;
}

const ARROW = { asc: "↑", desc: "↓" } as const;

export function dataGrid<T>(props: DataGridProps<T>): DataGrid {
  const rowHeight = props.rowHeight ?? 32;
  const height = props.height ?? 400;
  const columns = props.columns;
  const selected = props.selected;

  const sort = state<{ key: string; dir: "asc" | "desc" } | null>(props.sort ?? null);

  const byKey = new Map<string, GridColumn<T>>();
  for (const c of columns) byKey.set(c.key, c);

  /** Cate un `resizable` per coloana; latimea e un semnal. */
  const widths = new Map<string, Resizable>();
  for (const c of columns) {
    widths.set(
      c.key,
      resizable({
        axis: "x",
        initial: c.width ?? 160,
        min: c.minWidth ?? 60,
      }),
    );
  }
  const widthOf = (key: string): number => widths.get(key)?.size() ?? 160;

  const view = derived<readonly T[]>(() => {
    const rows = props.rows();
    const s = sort();
    if (!s) return rows;
    const cmp = byKey.get(s.key)?.sort;
    if (!cmp) return rows;
    const copy = rows.slice();
    copy.sort(s.dir === "asc" ? cmp : (a, b) => cmp(b, a));
    return copy;
  });

  const v = virtualizer({
    count: () => view().length,
    itemSize: rowHeight,
    overscan: props.overscan ?? 4,
    viewportSize: height,
  });

  const toggleSort = (col: GridColumn<T>): void => {
    if (!col.sort) return;
    sort.update((prev) =>
      prev && prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: "asc" },
    );
    v.setScroll(0); // dupa re-sortare, inapoi la inceput
  };

  const isSelected = (row: T): boolean => (selected ? selected().has(row) : false);
  const toggleSelect = (row: T): void => {
    selected?.update((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  };

  /** Sablonul de coloane: un singur atribut de stil pentru tot randul. */
  const template = (): string =>
    "display:grid;grid-template-columns:" + columns.map((c) => widthOf(c.key) + "px").join(" ");

  function headerCell(col: GridColumn<T>): El {
    const sortable = typeof col.sort === "function";
    const dirOf = (): "asc" | "desc" | null => {
      const s = sort();
      return s && s.key === col.key ? s.dir : null;
    };
    return R.div(
      {
        class: sortable ? "rui-grid-th rui-sortable" : "rui-grid-th",
        role: "columnheader",
        style: col.align ? "text-align:" + col.align : undefined,
        "aria-sort": () => {
          const d = dirOf();
          return d === null ? "none" : d === "asc" ? "ascending" : "descending";
        },
        ...(sortable
          ? {
              tabindex: "0",
              "on:click": () => toggleSort(col),
              "on:keydown": (e: any) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault?.();
                  toggleSort(col);
                }
              },
            }
          : {}),
      },
      R.span({ class: "rui-grid-th-label" }, col.header),
      sortable
        ? R.span({ class: "rui-sort-arrow", "aria-hidden": "true" }, () => {
            const d = dirOf();
            return d === null ? "" : ARROW[d];
          })
        : null,
      col.fixed
        ? null
        : R.span({
            class: "rui-grid-col-resize",
            ref: widths.get(col.key)!.handle,
            "aria-label": "Redimensionează coloana",
          }),
    );
  }

  function row(index: number): El {
    const item = (): T | undefined => view()[index];
    return R.div(
      {
        class: () => {
          const r = item();
          return r !== undefined && isSelected(r) ? "rui-grid-row rui-selected" : "rui-grid-row";
        },
        role: "row",
        "aria-rowindex": String(index + 2), // +1 pentru header, +1 pentru baza 1
        style: () => v.itemStyle(index) + ";" + template(),
        ...(selected || props.onRowClick
          ? {
              "on:click": () => {
                const r = item();
                if (r === undefined) return;
                toggleSelect(r);
                props.onRowClick?.(r, index);
              },
            }
          : {}),
      },
      columns.map((col) =>
        R.div(
          {
            class: "rui-grid-td",
            role: "gridcell",
            style: col.align ? "text-align:" + col.align : undefined,
          },
          // Celula se re-evalueaza cand randul de la acest indice se schimba
          // (sortare, filtrare) - fara sa recreeze nodul.
          () => {
            const r = item();
            return r === undefined ? null : col.cell(r, index);
          },
        ),
      ),
    );
  }

  const el = R.div(
    {
      class: props.class ? "rui-grid " + props.class : "rui-grid",
      role: "grid",
      "aria-rowcount": () => String(view().length + 1),
      "aria-colcount": String(columns.length),
    },
    R.div({ class: "rui-grid-head", role: "row", style: () => template() }, columns.map(headerCell)),
    R.div(
      {
        class: "rui-grid-body",
        ref: v.ref,
        style: "overflow:auto;position:relative;height:" + height + "px",
      },
      R.div(
        { class: "rui-grid-canvas", style: () => v.spacerStyle() },
        For({ each: () => v.indices(), children: row }),
      ),
      Show({
        when: () => view().length === 0,
        children: R.div({ class: "rui-grid-empty" }, props.empty ?? "No rows"),
      }),
    ),
  );

  return {
    el,
    setScroll: v.setScroll,
    setViewport: v.setViewport,
    scrollTo: v.scrollTo,
    visibleCount: () => v.indices().length,
  };
}

/** Varianta componenta. */
export function DataGrid<T>(props: DataGridProps<T>): El {
  return dataGrid(props).el;
}
