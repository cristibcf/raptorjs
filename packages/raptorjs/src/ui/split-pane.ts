/**
 * SplitPane - two panels with a resizable handle between them.
 *
 * A component on top of the `resizable` behavior (#189): it adds the markup,
 * collapsing and size persistence. The behavior stays separate so you can use it
 * on other shapes too (a side palette, a drawer, a table column).
 *
 * The thesis: dragging the handle rewrites a single style attribute per frame;
 * the panels don't re-render. See the test with 60 `pointermove`s.
 */
import { state, type Accessor } from "@raptorstack/raptorjs";
import { R, type Child } from "@raptorstack/raptorjs/dom";
import { resizable, type Resizable } from "./primitives/resizable.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface SplitPaneProps {
  first: Child;
  second: Child;
  /** `horizontal` = panels side by side (a vertical handle). Default this. */
  direction?: "horizontal" | "vertical";
  /** The initial size of the first panel, in px. */
  initial?: number;
  min?: number;
  max?: number;
  /** Quantization on drag and keyboard step. */
  step?: number;
  /** localStorage key for keeping the size between sessions. */
  persist?: string;
  /** Allow collapsing the first panel with a double-click on the handle. */
  collapsible?: boolean;
  onResize?: (size: number) => void;
  label?: string;
  class?: string;
}

export interface SplitPane {
  el: El;
  size: Accessor<number>;
  setSize: (size: number) => void;
  collapsed: Accessor<boolean>;
  toggle: () => void;
  handle: Resizable;
}

function readPersisted(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = (globalThis as any).localStorage?.getItem(key);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback; // localStorage blocked (private mode, iframe)
  }
}

function writePersisted(key: string | undefined, value: number): void {
  if (!key) return;
  try {
    (globalThis as any).localStorage?.setItem(key, String(value));
  } catch {
    /* the write may fail; that's no reason for the UI to crash */
  }
}

export function splitPane(props: SplitPaneProps): SplitPane {
  const horizontal = (props.direction ?? "horizontal") === "horizontal";
  const initial = readPersisted(props.persist, props.initial ?? 240);
  const min = props.min ?? 120;
  const max = props.max ?? Number.POSITIVE_INFINITY;

  const collapsed = state(false);
  let restore = initial;

  const handle = resizable({
    axis: horizontal ? "x" : "y",
    initial,
    min: 0, // 0 allowed so we can collapse; `min` is applied on drag
    max,
    step: props.step,
    onResize: (size) => {
      if (size > 0 && size < min) {
        // Below the minimum: collapse instead of leaving an unusable panel.
        handle.setSize(0);
        return;
      }
      collapsed.set(size === 0);
      if (size > 0) restore = size;
      props.onResize?.(size);
    },
    onEnd: (size) => writePersisted(props.persist, size),
  });

  const toggle = (): void => {
    if (collapsed.peek()) handle.setSize(restore || props.initial || 240);
    else handle.setSize(0);
    writePersisted(props.persist, handle.size());
  };

  const el = R.div(
    {
      class: () =>
        "rui-split" +
        (horizontal ? " rui-split-h" : " rui-split-v") +
        (collapsed() ? " rui-collapsed" : "") +
        (handle.resizing() ? " rui-resizing" : "") +
        (props.class ? " " + props.class : ""),
    },
    R.div({ class: "rui-split-first", style: () => handle.style() }, props.first),
    R.div({
      class: "rui-resize-handle rui-split-handle",
      ref: handle.handle,
      ...(props.label ? { "aria-label": props.label } : {}),
      "aria-valuenow": () => String(Math.round(handle.size())),
      ...(props.collapsible ? { "on:dblclick": toggle } : {}),
    }),
    R.div({ class: "rui-split-second" }, props.second),
  );

  return { el, size: () => handle.size(), setSize: handle.setSize, collapsed: () => collapsed(), toggle, handle };
}

/** The component variant, when you don't need the returned handle. */
export function SplitPane(props: SplitPaneProps): El {
  return splitPane(props).el;
}
