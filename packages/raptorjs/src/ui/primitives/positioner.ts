/**
 * positioner - asaza un element flotant fata de o referinta, fara sa iasa din
 * ecran.
 *
 * Fara asta, orice overlay pozitionat cu CSS pur (`position:absolute; top:100%`)
 * se taie la marginea ferestrei: un meniu langa marginea de jos ramane pe
 * jumatate invizibil. `flip` intoarce plasamentul pe partea opusa cand nu incape,
 * `shift` il gliseaza pe axa secundara cat sa ramana inauntru.
 *
 * Rezultatul e un semnal, deci repozitionarea rescrie **un singur atribut de
 * stil** - nu re-randeaza continutul overlay-ului.
 *
 * `getBoundingClientRect` nu exista pe mini-dom; atunci pozitia ramane {0,0} si
 * `update()` poate fi apelat manual cu dreptunghiuri date, ca logica de flip/shift
 * sa fie testabila fara layout real.
 */
import { state, onCleanup, type Accessor } from "raptorjs";
import { onDoc, type El } from "./env.ts";

export type Side = "top" | "right" | "bottom" | "left";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-${Align}`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionerOptions {
  /** Plasamentul dorit. Implicit `bottom-start`. */
  placement?: Placement;
  /** Distanta in px fata de referinta. Implicit 4. */
  offset?: number;
  /** Intoarce pe partea opusa daca nu incape. Implicit `true`. */
  flip?: boolean;
  /** Gliseaza pe axa secundara cat sa ramana in ecran. Implicit `true`. */
  shift?: boolean;
  /** Marginea pastrata fata de marginea ecranului. Implicit 8. */
  padding?: number;
  /** Cat timp intoarce `false`, nu se recalculeaza (overlay inchis). */
  enabled?: () => boolean;
}

export interface Positioner {
  /** `ref` pentru elementul de referinta (trigger-ul). */
  reference: (el: El) => void;
  /** `ref` pentru elementul flotant. */
  floating: (el: El) => void;
  /** Stil gata de pus pe elementul flotant. */
  style: Accessor<string>;
  x: Accessor<number>;
  y: Accessor<number>;
  /** Plasamentul efectiv folosit (poate diferi de cel cerut, dupa flip). */
  placement: Accessor<Placement>;
  /** Recalculeaza. Cu argumente, foloseste dreptunghiurile date (teste/SSR). */
  update: (rects?: { reference: Rect; floating: Rect; viewport?: Rect }) => void;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function parse(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split("-") as [Side, Align | undefined];
  return { side, align: align ?? "center" };
}

function rectOf(el: El): Rect | null {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  const r = el.getBoundingClientRect();
  if (!r) return null;
  return { x: Number(r.x ?? r.left ?? 0), y: Number(r.y ?? r.top ?? 0), width: Number(r.width ?? 0), height: Number(r.height ?? 0) };
}

function viewportRect(): Rect {
  const w = (globalThis as any).innerWidth;
  const h = (globalThis as any).innerHeight;
  return {
    x: 0,
    y: 0,
    width: typeof w === "number" ? w : 0,
    height: typeof h === "number" ? h : 0,
  };
}

/** Pozitia de baza pentru un plasament, fara corectii. */
function place(ref: Rect, float: Rect, side: Side, align: Align, offset: number): { x: number; y: number } {
  const alongX = side === "top" || side === "bottom";
  let x = 0;
  let y = 0;

  if (side === "top") y = ref.y - float.height - offset;
  else if (side === "bottom") y = ref.y + ref.height + offset;
  else if (side === "left") x = ref.x - float.width - offset;
  else x = ref.x + ref.width + offset;

  if (alongX) {
    if (align === "start") x = ref.x;
    else if (align === "end") x = ref.x + ref.width - float.width;
    else x = ref.x + ref.width / 2 - float.width / 2;
  } else {
    if (align === "start") y = ref.y;
    else if (align === "end") y = ref.y + ref.height - float.height;
    else y = ref.y + ref.height / 2 - float.height / 2;
  }

  return { x, y };
}

function fits(pos: { x: number; y: number }, float: Rect, view: Rect, padding: number): boolean {
  if (view.width <= 0 || view.height <= 0) return true; // viewport necunoscut
  return (
    pos.x >= padding &&
    pos.y >= padding &&
    pos.x + float.width <= view.width - padding &&
    pos.y + float.height <= view.height - padding
  );
}

export function positioner(options?: PositionerOptions): Positioner {
  const wanted = options?.placement ?? "bottom-start";
  const offset = options?.offset ?? 4;
  const padding = options?.padding ?? 8;
  const doFlip = options?.flip ?? true;
  const doShift = options?.shift ?? true;

  const x = state(0);
  const y = state(0);
  const used = state<Placement>(wanted);

  let refEl: El = null;
  let floatEl: El = null;

  const compute = (ref: Rect, float: Rect, view: Rect): void => {
    const { side, align } = parse(wanted);

    let finalSide = side;
    let pos = place(ref, float, side, align, offset);

    // flip: daca nu incape pe partea ceruta, incearca opusul si pastreaza
    // varianta care incape (sau pe cea originala daca niciuna nu incape).
    if (doFlip && !fits(pos, float, view, padding)) {
      const alt = OPPOSITE[side];
      const altPos = place(ref, float, alt, align, offset);
      if (fits(altPos, float, view, padding)) {
        finalSide = alt;
        pos = altPos;
      }
    }

    // shift: gliseaza pe axa secundara cat sa ramana inauntru.
    if (doShift && view.width > 0 && view.height > 0) {
      const alongX = finalSide === "top" || finalSide === "bottom";
      if (alongX) {
        pos.x = Math.min(Math.max(pos.x, padding), Math.max(padding, view.width - float.width - padding));
      } else {
        pos.y = Math.min(Math.max(pos.y, padding), Math.max(padding, view.height - float.height - padding));
      }
    }

    x.set(Math.round(pos.x));
    y.set(Math.round(pos.y));
    used.set(align === "center" ? finalSide : (`${finalSide}-${align}` as Placement));
  };

  const update: Positioner["update"] = (rects) => {
    if (options?.enabled && !options.enabled()) return;
    if (rects) {
      compute(rects.reference, rects.floating, rects.viewport ?? viewportRect());
      return;
    }
    const ref = rectOf(refEl);
    const float = rectOf(floatEl);
    if (!ref || !float) return;
    compute(ref, float, viewportRect());
  };

  const reference = (el: El): void => {
    refEl = el;
    update();
  };

  const floating = (el: El): void => {
    floatEl = el;
    update();
    if (!el) return;
    // Repozitionare la scroll/resize. `capture` prinde si scroll-ul
    // containerelor intermediare, nu doar al ferestrei.
    const unScroll = onDoc("scroll", update);
    const w = (globalThis as any).addEventListener ? globalThis : null;
    const onResize = (): void => update();
    (w as any)?.addEventListener?.("resize", onResize);
    onCleanup(() => {
      unScroll();
      (w as any)?.removeEventListener?.("resize", onResize);
      floatEl = null;
    });
  };

  const style: Accessor<string> = () =>
    `position:fixed;left:${x()}px;top:${y()}px`;

  return { reference, floating, style, x: () => x(), y: () => y(), placement: () => used(), update };
}
