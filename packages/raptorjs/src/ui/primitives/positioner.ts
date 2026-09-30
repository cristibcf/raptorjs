/**
 * positioner - places a floating element relative to a reference, without going
 * off screen.
 *
 * Without this, any overlay positioned with pure CSS (`position:absolute; top:100%`)
 * is clipped at the window edge: a menu near the bottom edge stays half
 * invisible. `flip` turns the placement to the opposite side when it doesn't fit,
 * `shift` slides it on the secondary axis just enough to stay inside.
 *
 * The result is a signal, so repositioning rewrites **a single style attribute**
 * - it doesn't re-render the overlay's content.
 *
 * `getBoundingClientRect` doesn't exist on mini-dom; in that case the position
 * stays {0,0} and `update()` can be called manually with given rectangles, so
 * the flip/shift logic is testable without real layout.
 */
import { state, onCleanup, type Accessor } from "@raptorstack/raptorjs";
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
  /** The desired placement. Defaults to `bottom-start`. */
  placement?: Placement;
  /** Distance in px from the reference. Defaults to 4. */
  offset?: number;
  /** Turn to the opposite side if it doesn't fit. Defaults to `true`. */
  flip?: boolean;
  /** Slide on the secondary axis to stay on screen. Defaults to `true`. */
  shift?: boolean;
  /** The margin kept from the screen edge. Defaults to 8. */
  padding?: number;
  /** While this returns `false`, nothing is recomputed (overlay closed). */
  enabled?: () => boolean;
}

export interface Positioner {
  /** `ref` for the reference element (the trigger). */
  reference: (el: El) => void;
  /** `ref` for the floating element. */
  floating: (el: El) => void;
  /** Style ready to put on the floating element. */
  style: Accessor<string>;
  x: Accessor<number>;
  y: Accessor<number>;
  /** The placement actually used (may differ from the requested one, after flip). */
  placement: Accessor<Placement>;
  /** Recompute. With arguments, uses the given rectangles (tests/SSR). */
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

/** The base position for a placement, without corrections. */
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
  if (view.width <= 0 || view.height <= 0) return true; // viewport unknown
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

    // flip: if it doesn't fit on the requested side, try the opposite and keep
    // the variant that fits (or the original one if neither fits).
    if (doFlip && !fits(pos, float, view, padding)) {
      const alt = OPPOSITE[side];
      const altPos = place(ref, float, alt, align, offset);
      if (fits(altPos, float, view, padding)) {
        finalSide = alt;
        pos = altPos;
      }
    }

    // shift: slide on the secondary axis just enough to stay inside.
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
    // Reposition on scroll/resize. `capture` catches the scroll of intermediate
    // containers too, not just the window's.
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
