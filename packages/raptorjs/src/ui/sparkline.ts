/**
 * Sparkline - grafic minuscul, inline, fara axe.
 *
 * Componenta-teza pentru date live. Un flux care trimite o valoare pe secunda
 * rescrie **un singur atribut** (`d`-ul path-ului) si nu atinge niciun nod.
 * Intr-un framework cu Virtual DOM, acelasi flux ar re-crea arborele SVG la
 * fiecare tick si l-ar reconcilia punct cu punct.
 *
 * Are nevoie de suportul SVG din `@raptor/dom` (`createElementNS`) - fara el,
 * `document.createElement("svg")` produce un element HTML care nu randeaza.
 */
import { derived, type Accessor } from "raptorjs";
import { R, Show } from "raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface SparklineProps {
  data: Accessor<readonly number[]>;
  width?: number;
  height?: number;
  /** Grosimea liniei. Implicit 1.5. */
  thickness?: number;
  /** Umple aria de sub linie. Implicit `false`. */
  area?: boolean;
  /** Marcheaza ultimul punct cu un cerc. Implicit `false`. */
  lastPoint?: boolean;
  /** Fixeaza scara verticala; altfel se ia min/max din date. */
  min?: number;
  max?: number;
  /** Eticheta pentru screen reader (graficul insusi e `aria-hidden`). */
  label?: string;
  class?: string;
}

interface Geometry {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  empty: boolean;
}

function geometry(
  data: readonly number[],
  width: number,
  height: number,
  pad: number,
  fixedMin?: number,
  fixedMax?: number,
): Geometry {
  const n = data.length;
  if (n === 0) return { line: "", area: "", lastX: 0, lastY: 0, empty: true };

  let lo = fixedMin ?? Number.POSITIVE_INFINITY;
  let hi = fixedMax ?? Number.NEGATIVE_INFINITY;
  if (fixedMin === undefined || fixedMax === undefined) {
    for (const v of data) {
      if (fixedMin === undefined && v < lo) lo = v;
      if (fixedMax === undefined && v > hi) hi = v;
    }
  }
  // Serie constanta: o linie la mijloc, nu o impartire la zero.
  const span = hi - lo || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  let line = "";
  let lastX = pad;
  let lastY = pad + innerH / 2;
  for (let i = 0; i < n; i++) {
    const x = pad + i * stepX;
    const y = pad + innerH - ((data[i]! - lo) / span) * innerH;
    line += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    lastX = x;
    lastY = y;
  }

  const base = (height - pad).toFixed(2);
  const area = line + `L${lastX.toFixed(2)} ${base}L${pad.toFixed(2)} ${base}Z`;
  return { line, area, lastX, lastY, empty: false };
}

export function Sparkline(props: SparklineProps): El {
  const width = props.width ?? 120;
  const height = props.height ?? 32;
  const thickness = props.thickness ?? 1.5;
  const pad = thickness; // ca linia sa nu fie taiata la margini

  // Un singur derived alimenteaza toate atributele; fiecare atribut e propriul
  // sau binding, deci se rescrie doar ce s-a schimbat.
  const geo = derived(() => geometry(props.data(), width, height, pad, props.min, props.max));

  return R.span(
    { class: props.class ? "rui-sparkline " + props.class : "rui-sparkline", role: "img", ...(props.label ? { "aria-label": props.label } : {}) },
    R.svg(
      {
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        "aria-hidden": "true",
        preserveAspectRatio: "none",
      },
      props.area
        ? R.path({ class: "rui-sparkline-area", d: () => geo().area, stroke: "none" })
        : null,
      R.path({
        class: "rui-sparkline-line",
        fill: "none",
        "stroke-width": String(thickness),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        d: () => geo().line,
      }),
      props.lastPoint
        ? Show({
            when: () => !geo().empty,
            children: R.circle({
              class: "rui-sparkline-point",
              r: String(thickness + 0.5),
              cx: () => geo().lastX.toFixed(2),
              cy: () => geo().lastY.toFixed(2),
            }),
          })
        : null,
    ),
  );
}
