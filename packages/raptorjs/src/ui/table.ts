/**
 * Table - a sortable table on top of a keyed `For`.
 *
 * Why fine-grained is interesting here: sorting doesn't recreate the rows.
 * `For` is keyed on the row object's identity, and sorting returns a new array
 * with the *same* references, so the existing nodes are only moved
 * (`insertBefore`), not rebuilt. A cell given an accessor updates only its own
 * text node when the data changes.
 */
import { state, derived, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface Column<T> {
  /** Identifies the column (used for the sort state). */
  key: string;
  header: Child;
  /** The cell content. Return an accessor if you want a reactive cell. */
  cell: (row: T, index: number) => Child;
  /**
   * Ascending comparator. Its absence makes the column unsortable - there's no
   * "default" string sort, so you don't misorder numbers or dates.
   */
  sort?: (a: T, b: T) => number;
  width?: string;
  align?: "left" | "center" | "right";
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

export interface TableProps<T> {
  rows: Accessor<readonly T[]>;
  columns: readonly Column<T>[];
  /** The initial sort. Omitted => the order from `rows`. */
  sort?: SortState;
  /** Content shown when there are no rows. */
  empty?: Child;
  /** Selection: give it a signal that you own. Omitted => no selection. */
  selected?: State<ReadonlySet<T>>;
  /** Multiple selection (default `true` when `selected` is present). */
  multiple?: boolean;
  onRowClick?: (row: T, index: number) => void;
  class?: string;
}

const ARROW: Record<"asc" | "desc", string> = { asc: "↑", desc: "↓" };

export function Table<T>(props: TableProps<T>): El {
  const sort = state<SortState | null>(props.sort ?? null);
  const columns = props.columns;
  const selected = props.selected;
  const multiple = props.multiple ?? true;

  const byKey = new Map<string, Column<T>>();
  for (const c of columns) byKey.set(c.key, c);

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

  const toggleSort = (col: Column<T>): void => {
    if (!col.sort) return;
    sort.update((prev) =>
      prev && prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: "asc" },
    );
  };

  const isSelected = (row: T): boolean => (selected ? selected().has(row) : false);

  const toggleSelect = (row: T): void => {
    if (!selected) return;
    selected.update((prev) => {
      if (!multiple) return prev.has(row) ? new Set<T>() : new Set<T>([row]);
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  };

  function headCell(col: Column<T>): El {
    const sortable = typeof col.sort === "function";
    const dirOf = (): "asc" | "desc" | null => {
      const s = sort();
      return s && s.key === col.key ? s.dir : null;
    };
    return R.th(
      {
        class: sortable ? "rui-th rui-sortable" : "rui-th",
        style: cellStyle(col),
        scope: "col",
        // `aria-sort` is reactive: a single attribute rewritten on sort.
        "aria-sort": () => {
          const d = dirOf();
          return d === null ? "none" : d === "asc" ? "ascending" : "descending";
        },
        ...(sortable ? { tabindex: "0", "on:click": () => toggleSort(col) } : {}),
        ...(sortable
          ? {
              "on:keydown": (e: any) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault?.();
                  toggleSort(col);
                }
              },
            }
          : {}),
      },
      col.header,
      sortable
        ? R.span({ class: "rui-sort-arrow", "aria-hidden": "true" }, () => {
            const d = dirOf();
            return d === null ? "" : ARROW[d];
          })
        : null,
    );
  }

  function bodyRow(row: T, index: number): El {
    return R.tr(
      {
        class: () => (isSelected(row) ? "rui-tr rui-selected" : "rui-tr"),
        ...(selected ? { "aria-selected": () => String(isSelected(row)) } : {}),
        ...(selected || props.onRowClick
          ? {
              "on:click": () => {
                toggleSelect(row);
                props.onRowClick?.(row, index);
              },
            }
          : {}),
      },
      columns.map((col) =>
        R.td({ class: "rui-td", style: cellStyle(col) }, col.cell(row, index)),
      ),
    );
  }

  return R.table(
    { class: props.class ? "rui-table " + props.class : "rui-table" },
    R.thead(R.tr({ class: "rui-tr" }, columns.map(headCell))),
    R.tbody(
      For({ each: () => view(), children: bodyRow }),
      // The "empty" row lives alongside the list, not in its place: when rows
      // appear, it disappears on its own without touching the rest of the table.
      Show({
        when: () => view().length === 0,
        children: R.tr(
          { class: "rui-empty" },
          R.td({ colspan: String(columns.length) }, props.empty ?? "No rows"),
        ),
      }),
    ),
  );
}

function cellStyle<T>(col: Column<T>): string | undefined {
  const parts: string[] = [];
  if (col.width) parts.push("width:" + col.width);
  if (col.align) parts.push("text-align:" + col.align);
  return parts.length > 0 ? parts.join(";") : undefined;
}
