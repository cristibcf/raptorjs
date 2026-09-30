/**
 * VisuallyHidden - content hidden visually but read by screen readers.
 *
 * We don't use `display:none` or `visibility:hidden` (those would remove it from
 * the accessibility tree); instead the standard clip-rect technique, defined in
 * `@raptorstack/raptorjs/ui/styles` under the `.rui-sr-only` class.
 */
import { R, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./env.ts";

export function VisuallyHidden(...children: Child[]): El {
  return R.span({ class: "rui-sr-only" }, children);
}

/** Variant that becomes visible on focus (for "skip to content"). */
export function VisuallyHiddenFocusable(...children: Child[]): El {
  return R.span({ class: "rui-sr-only rui-sr-focusable" }, children);
}
