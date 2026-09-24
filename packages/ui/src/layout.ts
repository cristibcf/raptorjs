/**
 * Layout - primitive de asezare in pagina.
 *
 * Sunt functii pure care intorc noduri: fara stare, fara effects, fara cost la
 * runtime peste `createElement`. Rostul lor nu e performanta, ci sa nu mai
 * scrii `display:flex;gap:8px` de trei sute de ori si sa nu mai inventezi
 * fiecare dezvoltator alta scara de spatiere.
 *
 * Spatierea e in trepte (`0..8`), nu in pixeli liberi: o scara mica tinuta cu
 * disciplina arata mai bine decat valori alese ad-hoc.
 */
import { R, type Child } from "@raptor/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Treptele scarii de spatiere, in px. */
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
  /** Eticheta de tag. Implicit `div`. Foloseste `section`, `aside`, `nav`... */
  as?: string;
  padding?: Space;
  paddingX?: Space;
  paddingY?: Space;
  margin?: Space;
  width?: string;
  height?: string;
  /** Stil suplimentar, concatenat la final. */
  style?: string;
  class?: string;
  /**
   * Atribute puse direct pe element (`id`, `aria-*`, `on:click`).
   *
   * Explicit, nu index signature: cu `[key: string]: unknown`, `Omit<T, K>` ar
   * sterge toti membrii declarati (`keyof T` devine `string`), si tipurile
   * derivate ca `StackProps` ar pierde `gap`, `align` etc.
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
  /** `flex` pe container (ex. "1" ca sa umple spatiul din parinte). */
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
  /** `vertical` (implicit) sau `horizontal`. */
  orientation?: "vertical" | "horizontal";
}

/** Stivuire cu gap. Cea mai folosita primitiva de layout. */
export function Stack(props: StackProps): El {
  const { orientation, ...rest } = props;
  return Flex({
    ...rest,
    direction: orientation === "horizontal" ? "row" : "column",
    gap: props.gap ?? 4,
    // O stiva verticala aliniaza implicit la start, nu intinde copiii.
    align: props.align ?? (orientation === "horizontal" ? "center" : undefined),
  });
}

/** Grupare orizontala: acelasi lucru ca `Stack` orizontal, nume idiomatic. */
export function Group(props: Omit<StackProps, "orientation">): El {
  return Stack({ ...props, orientation: "horizontal" });
}

export interface GridProps extends BoxProps {
  /** Numar de coloane egale, sau un `grid-template-columns` complet. */
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
  /** Latimea minima a unei coloane; numarul lor se adapteaza singur. */
  minColumnWidth?: string;
  gap?: Space;
}

/**
 * Grid care isi alege singur numarul de coloane. Fara media queries: `auto-fill`
 * plus `minmax` rezolva responsive-ul dintr-o singura declaratie.
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
  /** Latimea maxima. Implicit 1100px. */
  maxWidth?: string;
  /** Spatiu lateral pastrat pe ecrane mici. Implicit treapta 5 (16px). */
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
  /** Centreaza si pe verticala, ocupand toata inaltimea disponibila. */
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
  /** Marime fixa; fara ea, ocupa tot spatiul liber dintr-un flex. */
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
  /** Text in mijlocul liniei (ex. "sau"). Doar pe orizontala. */
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
  /** Raport latime/inaltime. Implicit 16/9. */
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
  /** Axa pe care se deruleaza. Implicit `y`. */
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
      // Zona derulabila trebuie sa fie focusabila, altfel nu poate fi
      // parcursa de la tastatura (criteriu WCAG 2.1.1).
      tabindex: "0",
    },
    props.children ?? null,
  );
}
