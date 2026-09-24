/**
 * SplitPane - doua panouri cu maner redimensionabil intre ele.
 *
 * Componenta peste comportamentul `resizable` (#189): adauga markup-ul,
 * colapsarea si persistarea marimii. Comportamentul ramane separat ca sa-l poti
 * folosi si pe alte forme (paleta laterala, sertar, coloana de tabel).
 *
 * Teza: tragerea manerului rescrie un singur atribut de stil pe frame; panourile
 * nu se re-randeaza. Vezi testul cu 60 de `pointermove`.
 */
import { state, type Accessor } from "@raptor/core";
import { R, type Child } from "@raptor/dom";
import { resizable, type Resizable } from "./primitives/resizable.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface SplitPaneProps {
  first: Child;
  second: Child;
  /** `horizontal` = panouri unul langa altul (maner vertical). Implicit asa. */
  direction?: "horizontal" | "vertical";
  /** Marimea initiala a primului panou, in px. */
  initial?: number;
  min?: number;
  max?: number;
  /** Cuantizare la tragere si pas de tastatura. */
  step?: number;
  /** Cheie de localStorage pentru pastrarea marimii intre sesiuni. */
  persist?: string;
  /** Permite colapsarea primului panou la dublu-click pe maner. */
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
    return fallback; // localStorage blocat (mod privat, iframe)
  }
}

function writePersisted(key: string | undefined, value: number): void {
  if (!key) return;
  try {
    (globalThis as any).localStorage?.setItem(key, String(value));
  } catch {
    /* scrierea poate esua; nu e motiv sa pice UI-ul */
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
    min: 0, // 0 permis ca sa putem colapsa; `min` e aplicat la tragere
    max,
    step: props.step,
    onResize: (size) => {
      if (size > 0 && size < min) {
        // Sub minim: colapsam in loc sa lasam un panou inutilizabil.
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

/** Varianta componenta, cand nu ai nevoie de handle-ul returnat. */
export function SplitPane(props: SplitPaneProps): El {
  return splitPane(props).el;
}
