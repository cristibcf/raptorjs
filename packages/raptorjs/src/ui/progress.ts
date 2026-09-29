/**
 * Progress - bara de progres determinata sau nedeterminata.
 *
 * Cea mai simpla componenta-teza, si de aceea cea mai clara: o valoare care
 * urca de la 0 la 100 in 100 de pasi scrie **doua atribute** la fiecare pas
 * (latimea umpluturii si `aria-valuenow`) si nu atinge niciun nod. Intr-un
 * framework cu Virtual DOM aceiasi 100 de pasi inseamna 100 de re-randari si
 * 100 de reconcilieri ale subarborelui.
 */
import { derived, type Accessor } from "raptorjs";
import { R, Show, type Child } from "raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export interface ProgressProps {
  /** Valoarea curenta. Omisa (sau `indeterminate`) => bara nedeterminata. */
  value?: Accessor<number>;
  min?: number;
  max?: number;
  indeterminate?: boolean;
  /** Eticheta pentru screen reader. */
  label?: string;
  /** Text afisat langa bara; `true` afiseaza procentul. */
  caption?: Child | true;
  class?: string;
}

export function Progress(props: ProgressProps): El {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const span = max - min || 1;
  const indeterminate = props.indeterminate === true || props.value === undefined;

  /** Procent 0..100, plafonat. Un singur `derived` alimenteaza tot. */
  const percent = derived(() => {
    if (indeterminate) return 0;
    const raw = (props.value!() - min) / span;
    return Math.min(100, Math.max(0, raw * 100));
  });

  return R.div(
    {
      class: props.class ? "rui-progress " + props.class : "rui-progress",
      role: "progressbar",
      "aria-valuemin": String(min),
      "aria-valuemax": String(max),
      ...(props.label ? { "aria-label": props.label } : {}),
      // Nedeterminata: fara `aria-valuenow`, asa cere specificatia ARIA.
      ...(indeterminate
        ? { "data-indeterminate": "true" }
        : { "aria-valuenow": () => String(Math.round(props.value!())) }),
    },
    R.div(
      { class: "rui-progress-track" },
      R.div({
        class: indeterminate ? "rui-progress-fill rui-indeterminate" : "rui-progress-fill",
        // Singurul lucru care se schimba la fiecare pas.
        ...(indeterminate ? {} : { style: () => "width:" + percent().toFixed(2) + "%" }),
      }),
    ),
    Show({
      when: () => props.caption !== undefined,
      children: R.span(
        { class: "rui-progress-caption" },
        props.caption === true ? () => Math.round(percent()) + "%" : (props.caption as Child),
      ),
    }),
  );
}

/**
 * CircularProgress - aceeasi logica, randata ca inel SVG.
 * `stroke-dashoffset` e singurul atribut care se misca.
 */
export interface CircularProgressProps extends ProgressProps {
  size?: number;
  thickness?: number;
}

export function CircularProgress(props: CircularProgressProps): El {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const span = max - min || 1;
  const size = props.size ?? 40;
  const thickness = props.thickness ?? 4;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = props.indeterminate === true || props.value === undefined;

  const fraction = derived(() => {
    if (indeterminate) return 0.25;
    const raw = (props.value!() - min) / span;
    return Math.min(1, Math.max(0, raw));
  });

  return R.svg(
    {
      class: indeterminate ? "rui-circular rui-indeterminate" : "rui-circular",
      width: String(size),
      height: String(size),
      viewBox: `0 0 ${size} ${size}`,
      role: "progressbar",
      "aria-valuemin": String(min),
      "aria-valuemax": String(max),
      ...(props.label ? { "aria-label": props.label } : {}),
      ...(indeterminate ? {} : { "aria-valuenow": () => String(Math.round(props.value!())) }),
    },
    R.circle({
      class: "rui-circular-track",
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(radius),
      fill: "none",
      "stroke-width": String(thickness),
    }),
    R.circle({
      class: "rui-circular-fill",
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(radius),
      fill: "none",
      "stroke-width": String(thickness),
      "stroke-dasharray": String(circumference),
      "stroke-linecap": "round",
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      "stroke-dashoffset": () => (circumference * (1 - fraction())).toFixed(2),
    }),
  );
}
