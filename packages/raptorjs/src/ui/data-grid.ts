/**
 * DataGrid - a virtualized table with resizable columns.
 *
 * The heaviest thesis component and the most convincing: with 50,000 rows, ~20
 * exist in the DOM. Scrolling reuses the nodes of the rows that stay in the
 * window (`For` keyed on index, see `virtualizer`) and only creates for the ones
 * that entered. Dragging a column rewrites a single style attribute.
 *
 * It doesn't use `<table>`: a real table can't be virtualized correctly (the
 * absolute rows break the table layout). It uses a grid with table ARIA roles,
 * as all serious virtualized grids do.
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
  /** The initial width in px. Defaults to 160. */
  width?: number;
  minWidth?: number;
  /** Ascending comparator; its absence makes the column unsortable. */
  sort?: (a: T, b: T) => number;
  align?: "left" | "center" | "right";
  /** The column cannot be resized. */
  fixed?: boolean;
}

export interface DataGridProps<T> {
  rows: Accessor<readonly T[]>;
  columns: readonly GridColumn<T>[];
  /** The height of a row in px. Must be uniform. Defaults to 32. */
  rowHeight?: number;
  /** The height of the scrollable area in px. Defaults to 400. */
  height?: number;
  /** Extra rows rendered at each end. Defaults to 4. */
  overscan?: number;
  sort?: { key: string; dir: "asc" | "desc" };
  selected?: State<ReadonlySet<T>>;
  onRowClick?: (row: T, index: number) => void;
  empty?: Child;
  class?: string;
}

export interface DataGrid {
  el: El;
  /** Test bridge: push the scroll metrics without real layout. */
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

  /** One `resizable` per column; the width is a signal. */
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
    v.setScroll(0); // after re-sorting, back to the start
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

  /** The column template: a single style attribute for the whole row. */
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
            "aria-label": "Resize column",
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
        "aria-rowindex": String(index + 2), // +1 for the header, +1 for 1-based indexing
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
          // The cell re-evaluates when the row at this index changes
          // (sort, filter) - without recreating the node.
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

/** Component variant. */
export function DataGrid<T>(props: DataGridProps<T>): El {
  return dataGrid(props).el;
}
