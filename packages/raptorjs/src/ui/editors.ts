/**
 * RichTextEditor, CodeEditor, JsonViewer, DiffViewer, ComparisonTable.
 *
 * Content editors and viewers. The algorithmic part (line and word diff) is
 * exported separately and tested without a DOM.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* -------------------------------------------------------- RichTextEditor -- */

export type RichCommand =
  | "bold" | "italic" | "underline" | "strikeThrough"
  | "insertUnorderedList" | "insertOrderedList"
  | "formatBlock" | "createLink" | "unlink" | "removeFormat";

export interface RichToolbarButton {
  command: RichCommand;
  label: string;
  icon: Child;
  /** Argument for commands like `formatBlock`. */
  value?: string;
}

export const DEFAULT_RICH_TOOLBAR: readonly RichToolbarButton[] = [
  { command: "bold", label: "Bold", icon: "B" },
  { command: "italic", label: "Italic", icon: "I" },
  { command: "underline", label: "Underline", icon: "U" },
  { command: "insertUnorderedList", label: "Bulleted list", icon: "•" },
  { command: "insertOrderedList", label: "Numbered list", icon: "1." },
  { command: "createLink", label: "Link", icon: "🔗" },
  { command: "removeFormat", label: "Clear formatting", icon: "⌫" },
];

export interface RichTextEditorProps {
  /** The HTML content. */
  value: State<string>;
  toolbar?: readonly RichToolbarButton[];
  placeholder?: string;
  readonly?: Accessor<boolean> | boolean;
  minHeight?: string;
  label?: string;
  onChange?: (html: string) => void;
  class?: string;
}

/**
 * RichTextEditor - minimal WYSIWYG editor.
 *
 * **Its limits, stated plainly:** it uses `contenteditable` and
 * `document.execCommand`. `execCommand` is marked deprecated and produces
 * slightly different HTML in each browser. The real alternative - your own
 * document model with selection management, like ProseMirror - is a months-long
 * project, not a component. This covers the "description field with bold and
 * links" case; for a serious editor use a dedicated library.
 *
 * It does not sanitize the HTML. If you render it back from untrusted sources,
 * clean it up yourself.
 */
export function RichTextEditor(props: RichTextEditorProps): El {
  const id = "rui-rte-" + ++idSeq;
  const buttons = props.toolbar ?? DEFAULT_RICH_TOOLBAR;
  const empty = derived(() => props.value().replace(/<[^>]*>/g, "").trim() === "");
  let editor: El = null;

  const off = (): boolean =>
    typeof props.readonly === "function" ? props.readonly() : props.readonly === true;

  const exec = (button: RichToolbarButton): void => {
    if (off()) return;
    const doc: any = (globalThis as any).document;
    if (typeof doc?.execCommand !== "function") return;

    let value = button.value;
    if (button.command === "createLink") {
      const url = (globalThis as any).prompt?.("Link address:");
      if (!url) return;
      value = String(url);
    }
    // Focus must be in the editor for there to be a selection to modify.
    if (editor && typeof editor.focus === "function") editor.focus();
    try {
      doc.execCommand(button.command, false, value);
    } catch {
      /* unsupported command */
    }
    sync();
  };

  const sync = (): void => {
    if (!editor) return;
    const html = String(editor.innerHTML ?? "");
    if (html === props.value.peek()) return;
    props.value.set(html);
    props.onChange?.(html);
  };

  // Content coming from outside is written into the editor only if it REALLY
  // differs: otherwise we'd reset the cursor on every keystroke.
  effect(() => {
    const next = props.value();
    if (!editor) return;
    if (String(editor.innerHTML ?? "") !== next) editor.innerHTML = next;
  });

  return R.div(
    { class: props.class ? "rui-rte " + props.class : "rui-rte" },
    R.div(
      { class: "rui-rte-toolbar", role: "toolbar", "aria-label": "Formatting", "aria-controls": id },
      buttons.map((button) =>
        R.button({
          type: "button",
          class: "rui-rte-button",
          "aria-label": button.label,
          // `mousedown` preventDefault: otherwise the button steals focus and
          // the editor's selection disappears before the command is applied.
          "on:mousedown": (e: any) => e.preventDefault?.(),
          disabled: () => off(),
          "on:click": () => exec(button),
        }, button.icon),
      ),
    ),
    R.div({
      id,
      class: () => "rui-rte-body" + (empty() ? " rui-empty" : ""),
      contenteditable: () => (off() ? "false" : "true"),
      role: "textbox",
      "aria-multiline": "true",
      ...(props.label ? { "aria-label": props.label } : {}),
      ...(props.placeholder ? { "data-placeholder": props.placeholder } : {}),
      style: "min-height:" + (props.minHeight ?? "120px"),
      ref: (el: El) => {
        editor = el;
        if (el) el.innerHTML = props.value.peek();
      },
      "on:input": sync,
      "on:blur": sync,
    }),
  );
}

/* -------------------------------------------------------------- CodeEditor */

export interface CodeEditorProps {
  value: State<string>;
  /** External tokenizer; receives the code and returns colored nodes. */
  highlight?: (code: string) => Child;
  /** The number of spaces inserted by Tab. Default 2. */
  tabSize?: number;
  lineNumbers?: boolean;
  readonly?: Accessor<boolean> | boolean;
  placeholder?: string;
  minHeight?: string;
  label?: string;
  class?: string;
}

/**
 * CodeEditor - a transparent `textarea` over a colored layer.
 *
 * The standard technique: the textarea keeps the cursor, selection, native
 * undo and accessibility; the layer underneath only colors. The two must have
 * EXACTLY the same metrics (font, line-height, padding), otherwise the text and
 * the color visibly fall out of sync.
 *
 * Tab inserts spaces instead of moving focus - but Escape then Tab moves out of
 * the field, so it isn't a trap for keyboard navigation.
 */
export function CodeEditor(props: CodeEditorProps): El {
  const id = "rui-code-" + ++idSeq;
  const tab = " ".repeat(props.tabSize ?? 2);
  const escaped = state(false);
  let textarea: El = null;

  const off = (): boolean =>
    typeof props.readonly === "function" ? props.readonly() : props.readonly === true;

  const lines = derived(() => props.value().split("\n").length);

  const insertTab = (el: El): void => {
    const start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    const text = props.value.peek();
    props.value.set(text.slice(0, start) + tab + text.slice(end));
    queueMicrotask(() => {
      try {
        el.setSelectionRange(start + tab.length, start + tab.length);
      } catch {
        /* no selection */
      }
    });
  };

  return R.div(
    {
      class: props.class ? "rui-codeeditor " + props.class : "rui-codeeditor",
      style: "min-height:" + (props.minHeight ?? "160px"),
    },
    props.lineNumbers !== false
      ? R.div({ class: "rui-code-gutter", "aria-hidden": "true" }, () =>
          Array.from({ length: lines() }, (_, i) => R.div({ class: "rui-code-lineno" }, String(i + 1))),
        )
      : null,
    R.div(
      { class: "rui-code-stack" },
      // The colored layer, purely decorative.
      R.pre(
        { class: "rui-code-highlight", "aria-hidden": "true" },
        R.code({}, () =>
          props.highlight ? props.highlight(props.value()) : props.value() + "\n",
        ),
      ),
      R.textarea({
        id,
        class: "rui-code-input",
        spellcheck: "false",
        autocomplete: "off",
        autocapitalize: "off",
        ...(props.placeholder ? { placeholder: props.placeholder } : {}),
        ...(props.label ? { "aria-label": props.label } : {}),
        readonly: () => (off() ? "" : undefined),
        value: () => props.value(),
        ref: (el: El) => {
          textarea = el;
        },
        "on:input": (e: any) => props.value.set(String(e.target?.value ?? "")),
        "on:keydown": (e: any) => {
          if (e.key === "Escape") {
            // The next Tab moves out of the field.
            escaped.set(true);
            return;
          }
          if (e.key === "Tab" && !escaped.peek() && !off()) {
            e.preventDefault?.();
            insertTab(e.target ?? textarea);
            return;
          }
          escaped.set(false);
        },
      }),
    ),
  );
}

/* ------------------------------------------------------------- JsonViewer -- */

export interface JsonViewerProps {
  data: Accessor<unknown> | unknown;
  /** Levels expanded initially. Default 1. */
  defaultDepth?: number;
  /** Above this many items, collections are shown collapsed. Default 50. */
  collapseAbove?: number;
  label?: string;
  class?: string;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function preview(value: unknown): string {
  const kind = typeOf(value);
  if (kind === "array") return "[" + (value as unknown[]).length + "]";
  if (kind === "object") return "{" + Object.keys(value as object).length + "}";
  if (kind === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * JsonViewer - expandable JSON tree.
 *
 * It renders only the expanded nodes: a 5MB document doesn't produce 200,000
 * DOM elements, only the open ones. Cyclic values are flagged, so they don't
 * lead to infinite recursion.
 */
export function JsonViewer(props: JsonViewerProps): El {
  const read = (): unknown => (typeof props.data === "function" ? (props.data as Accessor<unknown>)() : props.data);
  const defaultDepth = props.defaultDepth ?? 1;
  const limit = props.collapseAbove ?? 50;
  const expanded = state<ReadonlySet<string>>(new Set());

  const isOpen = (path: string, depth: number, size: number): boolean => {
    const set = expanded();
    if (set.has(path)) return true;
    if (set.has("!" + path)) return false; // explicitly closed
    return depth < defaultDepth && size <= limit;
  };

  const toggle = (path: string, open: boolean): void => {
    expanded.update((prev) => {
      const next = new Set(prev);
      next.delete(path);
      next.delete("!" + path);
      next.add(open ? "!" + path : path);
      return next;
    });
  };

  const renderValue = (value: unknown, path: string, depth: number, seen: Set<unknown>): Child => {
    const kind = typeOf(value);

    if (kind !== "object" && kind !== "array") {
      return R.span({ class: "rui-json-" + kind }, preview(value));
    }
    if (seen.has(value)) {
      return R.span({ class: "rui-json-cycle" }, "[circular reference]");
    }

    const entries: Array<[string, unknown]> =
      kind === "array"
        ? (value as unknown[]).map((v, i) => [String(i), v])
        : Object.entries(value as Record<string, unknown>);
    const open = isOpen(path, depth, entries.length);
    const nextSeen = new Set(seen).add(value);

    return R.div(
      { class: "rui-json-node" },
      R.button(
        {
          type: "button",
          class: "rui-json-toggle",
          "aria-expanded": String(open),
          "on:click": () => toggle(path, open),
        },
        R.span({ class: "rui-json-caret", "aria-hidden": "true" }, open ? "▾" : "▸"),
        R.span({ class: "rui-json-preview" }, preview(value)),
      ),
      open
        ? R.ul(
            { class: "rui-json-children" },
            entries.map(([key, child]) =>
              R.li(
                { class: "rui-json-entry" },
                R.span({ class: "rui-json-key" }, kind === "array" ? key : JSON.stringify(key)),
                R.span({ class: "rui-json-colon" }, ": "),
                renderValue(child, path + "." + key, depth + 1, nextSeen),
              ),
            ),
          )
        : null,
    );
  };

  return R.div(
    {
      class: props.class ? "rui-json " + props.class : "rui-json",
      role: "tree",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    () => renderValue(read(), "$", 0, new Set()),
  );
}

/* ------------------------------------------------------------ DiffViewer -- */

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffChunk {
  op: DiffOp;
  /** The index in the old text, or `-1` for insertions. */
  oldIndex: number;
  /** The index in the new text, or `-1` for deletions. */
  newIndex: number;
  value: string;
}

/**
 * Line diff, using the longest common subsequence.
 *
 * O(n*m) dynamic programming: enough for files on the order of thousands of
 * lines, which is the case this component exists for. For huge files you need
 * banded Myers, and at that point a dedicated library.
 */
export function diffLines(oldText: string, newText: string): DiffChunk[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  // The LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffChunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", oldIndex: i, newIndex: j, value: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "delete", oldIndex: i, newIndex: -1, value: a[i]! });
      i++;
    } else {
      out.push({ op: "insert", oldIndex: -1, newIndex: j, value: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: "delete", oldIndex: i, newIndex: -1, value: a[i++]! });
  while (j < m) out.push({ op: "insert", oldIndex: -1, newIndex: j, value: b[j++]! });
  return out;
}

/** Statistics for a diff header. */
export function diffStats(chunks: readonly DiffChunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const chunk of chunks) {
    if (chunk.op === "insert") added++;
    else if (chunk.op === "delete") removed++;
  }
  return { added, removed };
}

export interface DiffViewerProps {
  oldText: Accessor<string> | string;
  newText: Accessor<string> | string;
  /** `unified` (default) or `split`. */
  mode?: "unified" | "split";
  /** How many context lines are kept around the changes. `0` = all. */
  context?: number;
  oldLabel?: Child;
  newLabel?: Child;
  label?: string;
  class?: string;
}

export function DiffViewer(props: DiffViewerProps): El {
  const readOld = (): string => (typeof props.oldText === "function" ? props.oldText() : props.oldText);
  const readNew = (): string => (typeof props.newText === "function" ? props.newText() : props.newText);

  const chunks = derived(() => diffLines(readOld(), readNew()));
  const stats = derived(() => diffStats(chunks()));

  /** Hides long blocks of unchanged lines. */
  const visible = derived<Array<DiffChunk | { op: "skip"; count: number }>>(() => {
    const context = props.context ?? 3;
    const list = chunks();
    if (context <= 0) return [...list];

    const keep = new Set<number>();
    list.forEach((chunk, index) => {
      if (chunk.op === "equal") return;
      for (let k = index - context; k <= index + context; k++) {
        if (k >= 0 && k < list.length) keep.add(k);
      }
    });

    const out: Array<DiffChunk | { op: "skip"; count: number }> = [];
    let skipped = 0;
    list.forEach((chunk, index) => {
      if (keep.has(index)) {
        if (skipped > 0) {
          out.push({ op: "skip", count: skipped });
          skipped = 0;
        }
        out.push(chunk);
      } else {
        skipped++;
      }
    });
    if (skipped > 0) out.push({ op: "skip", count: skipped });
    return out;
  });

  const SIGN: Record<DiffOp, string> = { equal: " ", insert: "+", delete: "-" };

  return R.div(
    {
      class:
        "rui-diff rui-diff-" + (props.mode ?? "unified") + (props.class ? " " + props.class : ""),
      ...(props.label ? { "aria-label": props.label, role: "region" } : {}),
    },
    R.div(
      { class: "rui-diff-head" },
      R.span({ class: "rui-diff-file" }, props.oldLabel ?? "old"),
      R.span({ class: "rui-diff-arrow", "aria-hidden": "true" }, "→"),
      R.span({ class: "rui-diff-file" }, props.newLabel ?? "new"),
      R.span({ class: "rui-diff-stats" }, () => `+${stats().added} −${stats().removed}`),
    ),
    R.table(
      { class: "rui-diff-table" },
      R.tbody({}, () =>
        visible().map((row) => {
          if (row.op === "skip") {
            return R.tr(
              { class: "rui-diff-skip" },
              R.td({ colspan: "3" }, `… ${row.count} unchanged lines`),
            );
          }
          const chunk = row as DiffChunk;
          return R.tr(
            { class: "rui-diff-row rui-diff-" + chunk.op },
            R.td({ class: "rui-diff-lineno" }, chunk.oldIndex >= 0 ? String(chunk.oldIndex + 1) : ""),
            R.td({ class: "rui-diff-lineno" }, chunk.newIndex >= 0 ? String(chunk.newIndex + 1) : ""),
            R.td(
              { class: "rui-diff-line" },
              // The sign is read by the screen reader: without it, a monochrome
              // diff is impossible to interpret.
              R.span({ class: "rui-sr-only" },
                chunk.op === "insert" ? "added: " : chunk.op === "delete" ? "deleted: " : "",
              ),
              R.span({ class: "rui-diff-sign", "aria-hidden": "true" }, SIGN[chunk.op]),
              chunk.value === "" ? " " : chunk.value,
            ),
          );
        }),
      ),
    ),
  );
}

/* ------------------------------------------------------- ComparisonTable -- */

export interface ComparisonFeature {
  key: string;
  label: Child;
  /** Optional group to organize the rows. */
  group?: string;
  hint?: Child;
}

export interface ComparisonPlan {
  key: string;
  label: Child;
  /** Highlights the column as recommended. */
  featured?: boolean;
  badge?: Child;
  footer?: Child;
  /** The value for each feature: `true`/`false` or text. */
  values: Readonly<Record<string, boolean | Child>>;
}

export interface ComparisonTableProps {
  features: readonly ComparisonFeature[];
  plans: readonly ComparisonPlan[];
  label?: string;
  class?: string;
}

/**
 * ComparisonTable - comparison table between offerings.
 *
 * The checkmarks also have screen-reader text: a colored `✓` alone says
 * nothing, and a whole table of symbols is unreadable without sight.
 */
export function ComparisonTable(props: ComparisonTableProps): El {
  const groups = derived<Array<{ title: string | null; rows: readonly ComparisonFeature[] }>>(() => {
    const map = new Map<string | null, ComparisonFeature[]>();
    for (const feature of props.features) {
      const key = feature.group ?? null;
      const bucket = map.get(key);
      if (bucket) bucket.push(feature);
      else map.set(key, [feature]);
    }
    return [...map].map(([title, rows]) => ({ title, rows }));
  });

  const cell = (plan: ComparisonPlan, feature: ComparisonFeature): Child => {
    const value = plan.values[feature.key];
    if (value === true) {
      return [
        R.span({ class: "rui-compare-yes", "aria-hidden": "true" }, "✓"),
        R.span({ class: "rui-sr-only" }, "included"),
      ];
    }
    if (value === false || value === undefined) {
      return [
        R.span({ class: "rui-compare-no", "aria-hidden": "true" }, "—"),
        R.span({ class: "rui-sr-only" }, "not included"),
      ];
    }
    return value;
  };

  return R.table(
    {
      class: props.class ? "rui-compare " + props.class : "rui-compare",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    R.thead(
      {},
      R.tr(
        {},
        R.th({ scope: "col", class: "rui-compare-corner" }, ""),
        props.plans.map((plan) =>
          R.th(
            {
              scope: "col",
              class: "rui-compare-plan" + (plan.featured ? " rui-featured" : ""),
            },
            R.div({ class: "rui-compare-plan-label" }, plan.label),
            plan.badge !== undefined ? R.div({ class: "rui-compare-badge" }, plan.badge) : null,
          ),
        ),
      ),
    ),
    R.tbody({}, () =>
      groups().flatMap((group) => {
        const rows: El[] = [];
        if (group.title !== null) {
          rows.push(
            R.tr(
              { class: "rui-compare-group" },
              R.th({ scope: "colgroup", colspan: String(props.plans.length + 1) }, group.title),
            ),
          );
        }
        for (const feature of group.rows) {
          rows.push(
            R.tr(
              { class: "rui-compare-row" },
              // `scope="row"`: this is how the screen reader knows what each cell compares.
              R.th(
                { scope: "row", class: "rui-compare-feature" },
                feature.label,
                feature.hint !== undefined
                  ? R.span({ class: "rui-compare-hint" }, feature.hint)
                  : null,
              ),
              props.plans.map((plan) =>
                R.td(
                  { class: "rui-compare-cell" + (plan.featured ? " rui-featured" : "") },
                  cell(plan, feature),
                ),
              ),
            ),
          );
        }
        return rows;
      }),
    ),
    props.plans.some((p) => p.footer !== undefined)
      ? R.tfoot(
          {},
          R.tr(
            {},
            R.td({}, ""),
            props.plans.map((plan) =>
              R.td({ class: "rui-compare-foot" + (plan.featured ? " rui-featured" : "") }, plan.footer ?? null),
            ),
          ),
        )
      : null,
  );
}
