/**
 * VisuallyHidden - continut ascuns vizual dar citit de screen reader.
 *
 * Nu folosim `display:none` sau `visibility:hidden` (le-ar scoate din arborele
 * de accesibilitate) ci tehnica clip-rect standard, definita in `@raptor/ui/styles`
 * sub clasa `.rui-sr-only`.
 */
import { R, type Child } from "raptorjs/dom";
import { type El } from "./env.ts";

export function VisuallyHidden(...children: Child[]): El {
  return R.span({ class: "rui-sr-only" }, children);
}

/** Varianta care devine vizibila la focus (pentru "skip to content"). */
export function VisuallyHiddenFocusable(...children: Child[]): El {
  return R.span({ class: "rui-sr-only rui-sr-focusable" }, children);
}
