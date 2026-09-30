/**
 * TreeView / ListView / MultiSelect / Autocomplete / CommandPalette.
 *
 * Data components that use the existing primitives: `selectionState` for
 * Shift/Ctrl clicks, `positioner` for floating lists, `clickOutside` and
 * `focusTrap` for the command palette.
 */
import { state, derived, effect, onCleanup, untracked, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { focusTrap } from "./primitives/focus-trap.ts";
import { Portal } from "./primitives/portal.ts";
import { selectionState } from "./primitives/stores.ts";
import { onDoc, focus, type El } from "./primitives/env.ts";
import { Tag } from "./display.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* -------------------------------------------------------------- TreeView -- */

export interface TreeNode {
  key: string;
  label: Child;
  children?: readonly TreeNode[];
  /** Has children that load on demand. */
  hasChildren?: boolean;
  disabled?: boolean;
  icon?: Child;
}

export interface TreeViewProps {
  nodes: readonly TreeNode[] | Accessor<readonly TreeNode[]>;
  /** The expanded keys. */
  expanded?: State<ReadonlySet<string>>;
  selected?: State<string | null>;
  /** Lazy loading: called for a node with `hasChildren` and no `children`. */
  loadChildren?: (node: TreeNode) => Promise<readonly TreeNode[]>;
  onSelect?: (node: TreeNode) => void;
  label?: string;
  class?: string;
}

export interface TreeViewHandle {
  el: El;
  expanded: Accessor<ReadonlySet<string>>;
  toggle: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/**
 * TreeView - an expandable tree with lazy loading.
 *
 * Navigation follows the ARIA tree pattern: the right arrow expands or descends
 * to the first child, the left one collapses or moves up to the parent. Only
 * one node is tabbable (roving tabindex); Tab leaves the whole tree, it does not
 * step through all 400 nodes.
 */
export function treeView(props: TreeViewProps): TreeViewHandle {
  const id = "rui-tree-" + ++idSeq;
  const roots = typeof props.nodes === "function" ? props.nodes : () => props.nodes as readonly TreeNode[];
  const expanded = props.expanded ?? state<ReadonlySet<string>>(new Set());
  const focusedKey = state<string>("");
  const loaded = state<ReadonlyMap<string, readonly TreeNode[]>>(new Map());
  const loading = state<ReadonlySet<string>>(new Set());
  const elements = new Map<string, El>();

  const childrenOf = (node: TreeNode): readonly TreeNode[] =>
    node.children ?? loaded().get(node.key) ?? [];

  const isBranch = (node: TreeNode): boolean =>
    node.hasChildren === true || (node.children?.length ?? 0) > 0 || (loaded().get(node.key)?.length ?? 0) > 0;

  const isOpen = (key: string): boolean => expanded().has(key);

  const load = (node: TreeNode): void => {
    if (!props.loadChildren) return;
    if (loaded.peek().has(node.key) || loading.peek().has(node.key)) return;
    loading.update((prev) => new Set(prev).add(node.key));
    props.loadChildren(node).then(
      (kids) => {
        loaded.update((prev) => new Map(prev).set(node.key, kids));
        loading.update((prev) => {
          const next = new Set(prev);
          next.delete(node.key);
          return next;
        });
      },
      () => {
        loading.update((prev) => {
          const next = new Set(prev);
          next.delete(node.key);
          return next;
        });
      },
    );
  };

  const toggle = (key: string): void => {
    expanded.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const open = (node: TreeNode): void => {
    if (!isOpen(node.key)) {
      expanded.update((prev) => new Set(prev).add(node.key));
      if (node.children === undefined) load(node);
    }
  };

  const close = (key: string): void => {
    expanded.update((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  /** The visible nodes, in document order - the basis for up/down. */
  const flat = derived<Array<{ node: TreeNode; parent: string | null; depth: number }>>(() => {
    const out: Array<{ node: TreeNode; parent: string | null; depth: number }> = [];
    const walk = (list: readonly TreeNode[], parent: string | null, depth: number): void => {
      for (const node of list) {
        out.push({ node, parent, depth });
        if (isOpen(node.key)) walk(childrenOf(node), node.key, depth + 1);
      }
    };
    walk(roots(), null, 0);
    return out;
  });

  const focusNode = (key: string): void => {
    focusedKey.set(key);
    queueMicrotask(() => focus(elements.get(key)));
  };

  const select = (node: TreeNode): void => {
    if (node.disabled) return;
    props.selected?.set(node.key);
    props.onSelect?.(node);
  };

  const onKeydown = (e: any): void => {
    const list = flat();
    const at = list.findIndex((row) => row.node.key === focusedKey.peek());
    const row = at === -1 ? list[0] : list[at];
    if (!row) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault?.();
        const next = list[at + 1];
        if (next) focusNode(next.node.key);
        break;
      }
      case "ArrowUp": {
        e.preventDefault?.();
        const prev = list[at - 1];
        if (prev) focusNode(prev.node.key);
        break;
      }
      case "ArrowRight":
        e.preventDefault?.();
        if (isBranch(row.node) && !isOpen(row.node.key)) open(row.node);
        else {
          const first = list[at + 1];
          if (first && first.parent === row.node.key) focusNode(first.node.key);
        }
        break;
      case "ArrowLeft":
        e.preventDefault?.();
        if (isBranch(row.node) && isOpen(row.node.key)) close(row.node.key);
        else if (row.parent) focusNode(row.parent);
        break;
      case "Home":
        e.preventDefault?.();
        if (list[0]) focusNode(list[0].node.key);
        break;
      case "End":
        e.preventDefault?.();
        if (list[list.length - 1]) focusNode(list[list.length - 1]!.node.key);
        break;
      case "Enter":
      case " ":
        e.preventDefault?.();
        select(row.node);
        break;
      case "*":
        e.preventDefault?.();
        // Asterisk expands all siblings at the current level (ARIA pattern).
        expanded.update((prev) => {
          const next = new Set(prev);
          for (const other of list) {
            if (other.parent === row.parent && isBranch(other.node)) next.add(other.node.key);
          }
          return next;
        });
        break;
    }
  };

  function renderNode(node: TreeNode, depth: number): El {
    const branch = () => isBranch(node);
    return R.li(
      {
        class: "rui-tree-item",
        role: "treeitem",
        "aria-expanded": () => (branch() ? String(isOpen(node.key)) : undefined),
        "aria-selected": () => String(props.selected?.() === node.key),
        ...(node.disabled ? { "aria-disabled": "true" } : {}),
        "aria-level": String(depth + 1),
      },
      R.div(
        {
          class: () =>
            "rui-tree-row" +
            (props.selected?.() === node.key ? " rui-selected" : "") +
            (node.disabled ? " rui-disabled" : ""),
          style: "padding-left:" + (8 + depth * 16) + "px",
          // Roving tabindex: a single node in the whole tree is tabbable.
          tabindex: () => (focusedKey() === node.key ? "0" : "-1"),
          ref: (el: El) => {
            if (el) elements.set(node.key, el);
          },
          "on:click": () => {
            focusedKey.set(node.key);
            select(node);
          },
          "on:focus": () => focusedKey.set(node.key),
        },
        R.span(
          {
            class: "rui-tree-toggle",
            "aria-hidden": "true",
            "on:click": (e: any) => {
              e.stopPropagation?.();
              if (!branch()) return;
              if (isOpen(node.key)) close(node.key);
              else open(node);
            },
          },
          () => (branch() ? (isOpen(node.key) ? "▾" : "▸") : ""),
        ),
        node.icon !== undefined ? R.span({ class: "rui-tree-icon", "aria-hidden": "true" }, node.icon) : null,
        R.span({ class: "rui-tree-label" }, node.label),
        Show({
          when: () => loading().has(node.key),
          children: R.span({ class: "rui-tree-loading", "aria-hidden": "true" }, "…"),
        }),
      ),
      Show({
        when: () => branch() && isOpen(node.key),
        children: R.ul(
          { class: "rui-tree-group", role: "group" },
          () => childrenOf(node).map((child) => renderNode(child, depth + 1)),
        ),
      }),
    );
  }

  // The first node gets the logical focus, so Tab has somewhere to land.
  effect(() => {
    if (focusedKey() !== "") return;
    const first = untracked(() => roots()[0]);
    if (first) focusedKey.set(first.key);
  });

  const el = R.ul(
    {
      id,
      class: props.class ? "rui-tree " + props.class : "rui-tree",
      role: "tree",
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:keydown": onKeydown,
    },
    For({ each: roots, children: (node: TreeNode) => renderNode(node, 0) }),
  );

  const allBranchKeys = (): string[] => {
    const out: string[] = [];
    const walk = (list: readonly TreeNode[]): void => {
      for (const node of list) {
        if (isBranch(node)) out.push(node.key);
        walk(childrenOf(node));
      }
    };
    walk(roots());
    return out;
  };

  return {
    el,
    expanded: () => expanded(),
    toggle,
    expandAll: () => expanded.set(new Set(allBranchKeys())),
    collapseAll: () => expanded.set(new Set()),
  };
}

export function TreeView(props: TreeViewProps): El {
  return treeView(props).el;
}

/* -------------------------------------------------------------- ListView -- */

export interface ListViewProps<T> {
  items: Accessor<readonly T[]>;
  /** The content of a row. */
  render: (item: T, index: number) => Child;
  /** Grouping key; rows with the same key stay together. */
  groupBy?: (item: T) => string;
  /** Actions shown on the row. */
  actions?: (item: T) => Child;
  /** Enables selection with click/Ctrl/Shift. */
  selectable?: boolean;
  multiple?: boolean;
  onActivate?: (item: T) => void;
  empty?: Child;
  label?: string;
  class?: string;
}

export interface ListViewHandle<T> {
  el: El;
  selection: ReturnType<typeof selectionState<T>>;
}

/**
 * ListView - an interactive list with groups, actions and selection.
 *
 * Selection goes through `selectionState`, so Shift and Ctrl behave as in a
 * file manager. Double-click (or Enter) "activates" the row, which is different
 * from selecting it.
 */
export function listView<T>(props: ListViewProps<T>): ListViewHandle<T> {
  const selection = selectionState<T>({ items: () => props.items(), multiple: props.multiple !== false });
  const focusIndex = state(0);

  const grouped = derived<Array<{ title: string | null; items: readonly T[] }>>(() => {
    const items = props.items();
    if (!props.groupBy) return [{ title: null, items }];
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = props.groupBy(item);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map].map(([title, list]) => ({ title, items: list }));
  });

  const activate = (item: T): void => props.onActivate?.(item);

  const onKeydown = (e: any): void => {
    const items = props.items();
    if (items.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        focusIndex.set(Math.min(items.length - 1, focusIndex.peek() + 1));
        break;
      case "ArrowUp":
        e.preventDefault?.();
        focusIndex.set(Math.max(0, focusIndex.peek() - 1));
        break;
      case "Enter": {
        e.preventDefault?.();
        const item = items[focusIndex.peek()];
        if (item !== undefined) activate(item);
        break;
      }
      case " ": {
        e.preventDefault?.();
        const item = items[focusIndex.peek()];
        if (item !== undefined && props.selectable) selection.toggle(item);
        break;
      }
      case "a":
        if ((e.metaKey || e.ctrlKey) && props.selectable) {
          e.preventDefault?.();
          selection.selectAll();
        }
        break;
    }
  };

  const el = R.div(
    {
      class: props.class ? "rui-listview " + props.class : "rui-listview",
      role: props.selectable ? "listbox" : "list",
      ...(props.selectable && props.multiple !== false ? { "aria-multiselectable": "true" } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
      tabindex: "0",
      "on:keydown": onKeydown,
    },
    For({
      each: () => grouped(),
      children: (group: { title: string | null; items: readonly T[] }) =>
        R.div(
          { class: "rui-listview-group", ...(props.groupBy ? { role: "group" } : {}) },
          group.title !== null
            ? R.div({ class: "rui-listview-group-title" }, group.title)
            : null,
          For({
            each: () => group.items,
            children: (item: T) => {
              const index = (): number => props.items().indexOf(item);
              return R.div(
                {
                  class: () =>
                    "rui-listview-row" +
                    (props.selectable && selection.isSelected(item) ? " rui-selected" : "") +
                    (focusIndex() === index() ? " rui-focused" : ""),
                  role: props.selectable ? "option" : "listitem",
                  ...(props.selectable ? { "aria-selected": () => String(selection.isSelected(item)) } : {}),
                  "on:click": (e: any) => {
                    focusIndex.set(index());
                    if (props.selectable) {
                      selection.click(item, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
                    }
                  },
                  "on:dblclick": () => activate(item),
                },
                R.div({ class: "rui-listview-content" }, props.render(item, index())),
                props.actions
                  ? R.div({ class: "rui-listview-actions" }, props.actions(item))
                  : null,
              );
            },
          }),
        ),
    }),
    Show({
      when: () => props.items().length === 0,
      children: R.div({ class: "rui-listview-empty" }, props.empty ?? "Nothing to show"),
    }),
  );

  return { el, selection };
}

export function ListView<T>(props: ListViewProps<T>): El {
  return listView(props).el;
}

/* ----------------------------------------------------------- MultiSelect -- */

export interface MultiSelectProps<T> {
  options: Accessor<readonly T[]>;
  value: State<readonly T[]>;
  label: (option: T) => string;
  disabled?: (option: T) => boolean;
  placeholder?: string;
  /** Maximum number of selections. */
  max?: number;
  /** Allows searching the list. Default `true`. */
  searchable?: boolean;
  placement?: Placement;
  onChange?: (value: readonly T[]) => void;
  ariaLabel?: string;
  class?: string;
}

export interface MultiSelectHandle {
  el: El;
  open: Accessor<boolean>;
}

/**
 * MultiSelect - multiple selection with chips.
 *
 * The chips are OUTSIDE the input, not inside it: a chip placed in an input is
 * inaccessible (it cannot be given a button) and breaks on horizontal scroll.
 * Backspace on an empty field removes the last selection, as in any email
 * client.
 */
export function multiSelect<T>(props: MultiSelectProps<T>): MultiSelectHandle {
  const id = "rui-ms-" + ++idSeq;
  const open = state(false);
  const query = state("");
  const active = state(-1);
  let inputEl: El = null;

  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const visible = derived<readonly T[]>(() => {
    const q = query().toLowerCase();
    const all = props.options();
    if (q === "") return all;
    return all.filter((o) => props.label(o).toLowerCase().includes(q));
  });

  const selectable = derived<number[]>(() => {
    const list = visible();
    const out: number[] = [];
    for (let i = 0; i < list.length; i++) if (!props.disabled?.(list[i]!)) out.push(i);
    return out;
  });

  const isChosen = (option: T): boolean => props.value().includes(option);

  const toggle = (option: T): void => {
    if (props.disabled?.(option)) return;
    props.value.update((prev) => {
      if (prev.includes(option)) return prev.filter((o) => o !== option);
      if (props.max !== undefined && prev.length >= props.max) return prev;
      return [...prev, option];
    });
    props.onChange?.(props.value.peek());
    query.set("");
  };

  const move = (delta: number): void => {
    const idx = selectable();
    if (idx.length === 0) return;
    const at = idx.indexOf(active());
    const next = at === -1 ? (delta > 0 ? 0 : idx.length - 1) : (at + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  const onKeydown = (e: any): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault?.();
        if (!open()) open.set(true);
        else move(1);
        break;
      case "ArrowUp":
        e.preventDefault?.();
        if (!open()) open.set(true);
        else move(-1);
        break;
      case "Enter": {
        if (!open() || active() < 0) return;
        e.preventDefault?.();
        const option = visible()[active()];
        if (option !== undefined) toggle(option);
        break;
      }
      case "Escape":
        if (open()) {
          e.preventDefault?.();
          open.set(false);
        }
        break;
      case "Backspace": {
        if (query() !== "") return;
        const current = props.value.peek();
        if (current.length === 0) return;
        props.value.set(current.slice(0, -1));
        props.onChange?.(props.value.peek());
        break;
      }
    }
  };

  const el = R.div(
    {
      class: props.class ? "rui-multiselect " + props.class : "rui-multiselect",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.div(
      {
        class: "rui-multiselect-control",
        "on:click": () => {
          open.set(true);
          focus(inputEl);
        },
      },
      For({
        each: () => props.value(),
        children: (option: T) =>
          Tag({
            children: props.label(option),
            size: "sm",
            removeLabel: "Remove " + props.label(option),
            onRemove: () => toggle(option),
          }),
      }),
      R.input({
        id,
        type: "text",
        class: "rui-multiselect-input",
        role: "combobox",
        "aria-expanded": () => String(open()),
        "aria-controls": id + "-list",
        "aria-autocomplete": "list",
        ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
        ...(props.placeholder ? { placeholder: props.placeholder } : {}),
        readonly: props.searchable === false ? "" : undefined,
        value: () => query(),
        ref: (node: El) => {
          inputEl = node;
        },
        "on:input": (e: any) => {
          query.set(String(e.target?.value ?? ""));
          open.set(true);
          active.set(selectable.peek()[0] ?? -1);
        },
        "on:focus": () => open.set(true),
        "on:keydown": onKeydown,
      }),
    ),
    Show({
      when: () => open(),
      children: R.ul(
        {
          id: id + "-list",
          class: "rui-multiselect-list",
          role: "listbox",
          "aria-multiselectable": "true",
          ref: pos.floating,
          style: () => pos.style(),
        },
        For({
          each: () => visible(),
          children: (option: T, index: number) => {
            const off = props.disabled?.(option) ?? false;
            return R.li(
              {
                class: () => {
                  let cls = "rui-multiselect-option";
                  if (active() === index) cls += " rui-active";
                  if (isChosen(option)) cls += " rui-selected";
                  if (off) cls += " rui-disabled";
                  return cls;
                },
                role: "option",
                "aria-selected": () => String(isChosen(option)),
                ...(off ? { "aria-disabled": "true" } : {}),
                "on:click": (e: any) => {
                  e.stopPropagation?.();
                  toggle(option);
                },
                "on:mouseenter": () => {
                  if (!off) active.set(index);
                },
              },
              R.span({ class: "rui-multiselect-check", "aria-hidden": "true" }, () =>
                isChosen(option) ? "✓" : "",
              ),
              props.label(option),
            );
          },
        }),
        Show({
          when: () => visible().length === 0,
          children: R.li({ class: "rui-multiselect-empty", role: "presentation" }, "No results"),
        }),
      ),
    }),
  );

  return { el, open: () => open() };
}

export function MultiSelect<T>(props: MultiSelectProps<T>): El {
  return multiSelect(props).el;
}

/* ---------------------------------------------------------- Autocomplete -- */

export interface AutocompleteProps<T> {
  value: State<string>;
  /** Async search. Stale results are ignored if they arrive late. */
  search: (query: string) => Promise<readonly T[]>;
  label: (option: T) => string;
  /** Ms to wait before the request. Default 250. */
  debounce?: number;
  /** Do not search below this many characters. Default 1. */
  minLength?: number;
  onSelect?: (option: T) => void;
  placeholder?: string;
  placement?: Placement;
  ariaLabel?: string;
  class?: string;
}

export interface AutocompleteHandle<T> {
  el: El;
  results: Accessor<readonly T[]>;
  loading: Accessor<boolean>;
}

/**
 * Autocomplete - suggestions from the server.
 *
 * The part that goes wrong: **the race between requests**. If you type "ab" and
 * then "abc", the response for "ab" may arrive AFTER the one for "abc" and
 * overwrite it. Each request gets a sequence number and only the most recent one
 * is allowed to write the results.
 */
export function autocomplete<T>(props: AutocompleteProps<T>): AutocompleteHandle<T> {
  const id = "rui-ac-" + ++idSeq;
  const open = state(false);
  const results = state<readonly T[]>([]);
  const loading = state(false);
  const active = state(-1);
  const minLength = props.minLength ?? 1;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestSeq = 0;

  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  onCleanup(clearTimer);

  const run = (query: string): void => {
    clearTimer();
    if (query.length < minLength) {
      results.set([]);
      open.set(false);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      const seq = ++requestSeq;
      loading.set(true);
      props.search(query).then(
        (found) => {
          // Stale response: a newer request has already gone out.
          if (seq !== requestSeq) return;
          results.set(found);
          loading.set(false);
          open.set(true);
          active.set(found.length > 0 ? 0 : -1);
        },
        () => {
          if (seq !== requestSeq) return;
          loading.set(false);
          results.set([]);
        },
      );
    }, props.debounce ?? 250);
  };

  const choose = (index: number): void => {
    const option = results()[index];
    if (option === undefined) return;
    props.value.set(props.label(option));
    open.set(false);
    active.set(-1);
    props.onSelect?.(option);
  };

  const el = R.div(
    {
      class: props.class ? "rui-autocomplete " + props.class : "rui-autocomplete",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.input({
      id,
      type: "text",
      class: "rui-input-control",
      role: "combobox",
      autocomplete: "off",
      "aria-autocomplete": "list",
      "aria-expanded": () => String(open()),
      "aria-controls": id + "-list",
      "aria-busy": () => String(loading()),
      "aria-activedescendant": () => (open() && active() >= 0 ? id + "-opt-" + active() : ""),
      ...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {}),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      value: () => props.value(),
      "on:input": (e: any) => {
        const next = String(e.target?.value ?? "");
        props.value.set(next);
        run(next);
      },
      "on:keydown": (e: any) => {
        const list = results();
        if (e.key === "ArrowDown" && list.length > 0) {
          e.preventDefault?.();
          open.set(true);
          active.set((active() + 1) % list.length);
        } else if (e.key === "ArrowUp" && list.length > 0) {
          e.preventDefault?.();
          active.set((active() - 1 + list.length) % list.length);
        } else if (e.key === "Enter" && open() && active() >= 0) {
          e.preventDefault?.();
          choose(active());
        } else if (e.key === "Escape") {
          open.set(false);
        }
      },
    }),
    Show({
      when: () => open() && results().length > 0,
      children: R.ul(
        {
          id: id + "-list",
          class: "rui-autocomplete-list",
          role: "listbox",
          ref: pos.floating,
          style: () => pos.style(),
        },
        For({
          each: () => results(),
          children: (option: T, index: number) =>
            R.li(
              {
                id: id + "-opt-" + index,
                class: () => "rui-autocomplete-option" + (active() === index ? " rui-active" : ""),
                role: "option",
                "aria-selected": () => String(active() === index),
                "on:click": () => choose(index),
                "on:mouseenter": () => active.set(index),
              },
              props.label(option),
            ),
        }),
      ),
    }),
  );

  return { el, results: () => results(), loading: () => loading() };
}

export function Autocomplete<T>(props: AutocompleteProps<T>): El {
  return autocomplete(props).el;
}

/* -------------------------------------------------------- CommandPalette -- */

export interface Command {
  key: string;
  label: Child;
  /** Text to search by; defaults to `label` if it is a string. */
  searchText?: string;
  group?: string;
  hint?: string;
  icon?: Child;
  disabled?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  commands: readonly Command[] | Accessor<readonly Command[]>;
  open?: State<boolean>;
  /** Custom filtering. Defaults to case-insensitive substring matching. */
  filter?: (command: Command, query: string) => boolean;
  placeholder?: string;
  empty?: Child;
  class?: string;
}

export interface CommandPaletteHandle {
  el: Child;
  open: State<boolean>;
  toggle: () => void;
}

function commandText(command: Command): string {
  if (command.searchText) return command.searchText;
  return typeof command.label === "string" ? command.label : command.key;
}

/**
 * CommandPalette - Ctrl+K.
 *
 * It does not register the global shortcut itself: you bind it with `hotkeys`,
 * so it does not steal `mod+k` without you knowing. Mounted via `Portal`, with
 * `focusTrap`.
 */
export function commandPalette(props: CommandPaletteProps): CommandPaletteHandle {
  const id = "rui-cmd-" + ++idSeq;
  const open = props.open ?? state(false);
  const query = state("");
  const active = state(0);
  const all = typeof props.commands === "function" ? props.commands : () => props.commands as readonly Command[];

  const matches = props.filter ?? ((command: Command, q: string) =>
    commandText(command).toLowerCase().includes(q.toLowerCase()));

  const visible = derived<readonly Command[]>(() => {
    const q = query();
    const list = all().filter((c) => !c.disabled);
    return q === "" ? list : list.filter((c) => matches(c, q));
  });

  const groups = derived<Array<{ title: string | null; items: readonly Command[] }>>(() => {
    const list = visible();
    const map = new Map<string | null, Command[]>();
    for (const command of list) {
      const key = command.group ?? null;
      const bucket = map.get(key);
      if (bucket) bucket.push(command);
      else map.set(key, [command]);
    }
    return [...map].map(([title, items]) => ({ title, items }));
  });

  /** The global index of a command in the flattened list. */
  const indexOf = (command: Command): number => visible().indexOf(command);

  const close = (): void => {
    open.set(false);
    query.set("");
    active.set(0);
  };

  const run = (index: number): void => {
    const command = visible()[index];
    if (!command) return;
    close();
    command.run();
  };

  effect(() => {
    if (!open()) return;
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") close();
    });
    onCleanup(unbind);
  });

  // Filtering resets the selection: otherwise you could run the wrong command.
  effect(() => {
    void query();
    active.set(0);
  });

  const toggle = (): void => {
    if (open.peek()) close();
    else open.set(true);
  };

  const el = Show({
    when: () => open(),
    children: Portal({
      children: R.div(
        {
          class: "rui-cmd-backdrop",
          "on:click": (e: any) => {
            if (e.target === e.currentTarget) close();
          },
        },
        R.div(
          {
            class: props.class ? "rui-cmd " + props.class : "rui-cmd",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Command palette",
            ref: focusTrap(),
          },
          R.input({
            class: "rui-cmd-input",
            type: "text",
            role: "combobox",
            "aria-expanded": "true",
            "aria-controls": id + "-list",
            "aria-activedescendant": () => id + "-opt-" + active(),
            "aria-label": "Search for a command",
            placeholder: props.placeholder ?? "Search for a command…",
            value: () => query(),
            "on:input": (e: any) => query.set(String(e.target?.value ?? "")),
            "on:keydown": (e: any) => {
              const list = visible();
              if (e.key === "ArrowDown") {
                e.preventDefault?.();
                if (list.length > 0) active.set((active() + 1) % list.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault?.();
                if (list.length > 0) active.set((active() - 1 + list.length) % list.length);
              } else if (e.key === "Enter") {
                e.preventDefault?.();
                run(active());
              }
            },
          }),
          R.div(
            { id: id + "-list", class: "rui-cmd-list", role: "listbox" },
            For({
              each: () => groups(),
              children: (group: { title: string | null; items: readonly Command[] }) =>
                R.div(
                  { class: "rui-cmd-group", role: "group" },
                  group.title !== null
                    ? R.div({ class: "rui-cmd-group-title" }, group.title)
                    : null,
                  For({
                    each: () => group.items,
                    children: (command: Command) =>
                      R.div(
                        {
                          id: () => id + "-opt-" + indexOf(command),
                          class: () =>
                            "rui-cmd-item" + (indexOf(command) === active() ? " rui-active" : ""),
                          role: "option",
                          "aria-selected": () => String(indexOf(command) === active()),
                          "on:click": () => run(indexOf(command)),
                          "on:mouseenter": () => active.set(indexOf(command)),
                        },
                        command.icon !== undefined
                          ? R.span({ class: "rui-cmd-icon", "aria-hidden": "true" }, command.icon)
                          : null,
                        R.span({ class: "rui-cmd-label" }, command.label),
                        command.hint !== undefined
                          ? R.span({ class: "rui-cmd-hint" }, command.hint)
                          : null,
                      ),
                  }),
                ),
            }),
            Show({
              when: () => visible().length === 0,
              children: R.div({ class: "rui-cmd-empty" }, props.empty ?? "No commands"),
            }),
          ),
        ),
      ),
    }),
  });

  return { el, open, toggle };
}

export function CommandPalette(props: CommandPaletteProps): Child {
  return commandPalette(props).el;
}
