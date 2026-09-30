/**
 * Layout - primitives for placing things on the page.
 *
 * They are pure functions that return nodes: no state, no effects, no runtime
 * cost beyond `createElement`. Their point isn't performance, it's so you don't
 * write `display:flex;gap:8px` three hundred times and so each developer
 * doesn't invent a different spacing scale.
 *
 * Spacing is in steps (`0..8`), not free pixels: a small scale kept with
 * discipline looks better than ad-hoc values.
 */
import { R, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The steps of the spacing scale, in px. */
export const SPACE = [0, 2, 4, 8, 12, 16, 24, 32, 48] as const;
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function px(step: Space | undefined): string | null {
  if (step === undefined) return null;
  return SPACE[step] + "px";
}

function joinStyle(parts: Array<string | null>): string | undefined {
  const out = parts.filter((p): p is string => p !== null && p !== "");
  return out.length > 0 ? out.join(";") : undefined;
}

export interface BoxProps {
  children?: Child;
  /** Tag name. Default `div`. Use `section`, `aside`, `nav`... */
  as?: string;
  padding?: Space;
  paddingX?: Space;
  paddingY?: Space;
  margin?: Space;
  width?: string;
  height?: string;
  /** Extra style, concatenated at the end. */
  style?: string;
  class?: string;
  /**
   * Attributes put directly on the element (`id`, `aria-*`, `on:click`).
   *
   * Explicit, not an index signature: with `[key: string]: unknown`,
   * `Omit<T, K>` would erase all declared members (`keyof T` becomes `string`),
   * and derived types like `StackProps` would lose `gap`, `align` etc.
   */
  attrs?: Record<string, unknown>;
}

export function Box(props: BoxProps): El {
  const style = joinStyle([
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.paddingX !== undefined ? "padding-left:" + px(props.paddingX) + ";padding-right:" + px(props.paddingX) : null,
    props.paddingY !== undefined ? "padding-top:" + px(props.paddingY) + ";padding-bottom:" + px(props.paddingY) : null,
    props.margin !== undefined ? "margin:" + px(props.margin) : null,
    props.width ? "width:" + props.width : null,
    props.height ? "height:" + props.height : null,
    props.style ?? null,
  ]);

  return R[props.as ?? "div"]!(
    {
      ...(props.attrs ?? {}),
      ...(props.class ? { class: props.class } : {}),
      ...(style ? { style } : {}),
    },
    props.children ?? null,
  );
}

export type AlignItems = "start" | "center" | "end" | "stretch" | "baseline";
export type JustifyContent = "start" | "center" | "end" | "between" | "around" | "evenly";

const ALIGN: Record<AlignItems, string> = {
  start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline",
};
const JUSTIFY: Record<JustifyContent, string> = {
  start: "flex-start", center: "center", end: "flex-end",
  between: "space-between", around: "space-around", evenly: "space-evenly",
};

export interface FlexProps extends BoxProps {
  direction?: "row" | "column";
  gap?: Space;
  align?: AlignItems;
  justify?: JustifyContent;
  wrap?: boolean;
  /** `flex` on the container (e.g. "1" to fill the parent's space). */
  grow?: boolean;
}

export function Flex(props: FlexProps): El {
  const style = joinStyle([
    "display:flex",
    props.direction === "column" ? "flex-direction:column" : null,
    props.gap !== undefined ? "gap:" + px(props.gap) : null,
    props.align ? "align-items:" + ALIGN[props.align] : null,
    props.justify ? "justify-content:" + JUSTIFY[props.justify] : null,
    props.wrap ? "flex-wrap:wrap" : null,
    props.grow ? "flex:1 1 auto;min-width:0;min-height:0" : null,
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.width ? "width:" + props.width : null,
    props.height ? "height:" + props.height : null,
    props.style ?? null,
  ]);

  return R[props.as ?? "div"]!(
    {
      ...(props.attrs ?? {}),
      ...(props.class ? { class: props.class } : {}),
      style,
    },
    props.children ?? null,
  );
}

export interface StackProps extends Omit<FlexProps, "direction"> {
  /** `vertical` (default) or `horizontal`. */
  orientation?: "vertical" | "horizontal";
}

/** Stacking with a gap. The most-used layout primitive. */
export function Stack(props: StackProps): El {
  const { orientation, ...rest } = props;
  return Flex({
    ...rest,
    direction: orientation === "horizontal" ? "row" : "column",
    gap: props.gap ?? 4,
    // A vertical stack aligns to start by default, it doesn't stretch children.
    align: props.align ?? (orientation === "horizontal" ? "center" : undefined),
  });
}

/** Horizontal grouping: same as a horizontal `Stack`, idiomatic name. */
export function Group(props: Omit<StackProps, "orientation">): El {
  return Stack({ ...props, orientation: "horizontal" });
}

export interface GridProps extends BoxProps {
  /** Number of equal columns, or a full `grid-template-columns`. */
  columns?: number | string;
  rows?: number | string;
  gap?: Space;
  columnGap?: Space;
  rowGap?: Space;
  align?: AlignItems;
  justify?: JustifyContent;
}

function track(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === "number" ? `repeat(${value}, minmax(0, 1fr))` : value;
}

export function Grid(props: GridProps): El {
  const style = joinStyle([
    "display:grid",
    track(props.columns) ? "grid-template-columns:" + track(props.columns) : null,
    track(props.rows) ? "grid-template-rows:" + track(props.rows) : null,
    props.gap !== undefined ? "gap:" + px(props.gap) : null,
    props.columnGap !== undefined ? "column-gap:" + px(props.columnGap) : null,
    props.rowGap !== undefined ? "row-gap:" + px(props.rowGap) : null,
    props.align ? "align-items:" + ALIGN[props.align] : null,
    props.justify ? "justify-content:" + JUSTIFY[props.justify] : null,
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.style ?? null,
  ]);

  return R[props.as ?? "div"]!(
    { ...(props.attrs ?? {}), ...(props.class ? { class: props.class } : {}), style },
    props.children ?? null,
  );
}

export interface SimpleGridProps extends BoxProps {
  /** The minimum width of a column; their number adapts on its own. */
  minColumnWidth?: string;
  gap?: Space;
}

/**
 * A grid that picks its own number of columns. No media queries: `auto-fill`
 * plus `minmax` solves the responsive part in a single declaration.
 */
export function SimpleGrid(props: SimpleGridProps): El {
  const min = props.minColumnWidth ?? "220px";
  const style = joinStyle([
    "display:grid",
    `grid-template-columns:repeat(auto-fill, minmax(min(${min}, 100%), 1fr))`,
    "gap:" + px(props.gap ?? 4),
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.style ?? null,
  ]);

  return R[props.as ?? "div"]!(
    { ...(props.attrs ?? {}), ...(props.class ? { class: props.class } : {}), style },
    props.children ?? null,
  );
}

export interface ContainerProps extends BoxProps {
  /** The maximum width. Default 1100px. */
  maxWidth?: string;
  /** Side space kept on small screens. Default step 5 (16px). */
  gutter?: Space;
}

export function Container(props: ContainerProps): El {
  const gutter = px(props.gutter ?? 5);
  const style = joinStyle([
    "width:100%",
    "max-width:" + (props.maxWidth ?? "1100px"),
    "margin-left:auto;margin-right:auto",
    `padding-left:${gutter};padding-right:${gutter}`,
    props.style ?? null,
  ]);

  return R[props.as ?? "div"]!(
    { ...(props.attrs ?? {}), ...(props.class ? { class: props.class } : {}), style },
    props.children ?? null,
  );
}

export interface CenterProps extends BoxProps {
  /** Also center vertically, taking up all available height. */
  fullHeight?: boolean;
}

export function Center(props: CenterProps): El {
  const style = joinStyle([
    "display:flex;align-items:center;justify-content:center",
    props.fullHeight ? "height:100%" : null,
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.style ?? null,
  ]);
  return R[props.as ?? "div"]!(
    { ...(props.attrs ?? {}), ...(props.class ? { class: props.class } : {}), style },
    props.children ?? null,
  );
}

export interface SpacerProps {
  /** Fixed size; without it, it takes all the free space in a flex. */
  size?: Space;
}

export function Spacer(props?: SpacerProps): El {
  const size = props?.size;
  return R.div({
    class: "rui-spacer",
    "aria-hidden": "true",
    style: size === undefined ? "flex:1 1 auto" : `flex:0 0 ${px(size)};width:${px(size)};height:${px(size)}`,
  });
}

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  /** Text in the middle of the line (e.g. "or"). Horizontal only. */
  label?: Child;
  spacing?: Space;
  class?: string;
}

export function Divider(props: DividerProps): El {
  const vertical = props.orientation === "vertical";
  const spacing = px(props.spacing ?? 4);

  if (props.label !== undefined && !vertical) {
    return R.div(
      {
        class: props.class ? "rui-divider rui-divider-label " + props.class : "rui-divider rui-divider-label",
        role: "separator",
        style: `margin-top:${spacing};margin-bottom:${spacing}`,
      },
      R.span({ class: "rui-divider-line", "aria-hidden": "true" }),
      R.span({ class: "rui-divider-text" }, props.label),
      R.span({ class: "rui-divider-line", "aria-hidden": "true" }),
    );
  }

  return R.div({
    class: () => "rui-divider" + (vertical ? " rui-vertical" : "") + (props.class ? " " + props.class : ""),
    role: "separator",
    "aria-orientation": vertical ? "vertical" : "horizontal",
    style: vertical
      ? `margin-left:${spacing};margin-right:${spacing}`
      : `margin-top:${spacing};margin-bottom:${spacing}`,
  });
}

export interface AspectRatioProps {
  children: Child;
  /** Width/height ratio. Default 16/9. */
  ratio?: number;
  class?: string;
}

export function AspectRatio(props: AspectRatioProps): El {
  return R.div(
    {
      class: props.class ? "rui-aspect " + props.class : "rui-aspect",
      style: "aspect-ratio:" + (props.ratio ?? 16 / 9),
    },
    props.children,
  );
}

export interface ScrollAreaProps extends BoxProps {
  /** The axis it scrolls on. Default `y`. */
  axis?: "x" | "y" | "both";
  maxHeight?: string;
}

export function ScrollArea(props: ScrollAreaProps): El {
  const axis = props.axis ?? "y";
  const style = joinStyle([
    axis === "both" ? "overflow:auto" : axis === "x" ? "overflow-x:auto;overflow-y:hidden" : "overflow-y:auto;overflow-x:hidden",
    props.maxHeight ? "max-height:" + props.maxHeight : null,
    props.height ? "height:" + props.height : null,
    props.padding !== undefined ? "padding:" + px(props.padding) : null,
    props.style ?? null,
  ]);
  return R[props.as ?? "div"]!(
    {
      ...(props.attrs ?? {}),
      class: props.class ? "rui-scroll " + props.class : "rui-scroll",
      style,
      // A scrollable region must be focusable, otherwise it can't be
      // traversed from the keyboard (WCAG 2.1.1 criterion).
      tabindex: "0",
    },
    props.children ?? null,
  );
}
