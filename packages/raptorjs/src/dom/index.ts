/**
 * @raptor/dom - runtime DOM fine-grained + control flow.
 * Re-exporta si primitivele reactive din @raptor/core pentru ergonomie.
 */
export {
  render,
  onMount,
  createElement,
  isSvgTag,
  SVG_NS,
  template,
  applyProps,
  mountChild,
  block,
  isBlock,
  disposeDetached,
  type Block,
  type Child,
  type Component,
} from "./runtime.ts";

export { For, Show, type ForProps, type ShowProps } from "./control.ts";

export { jsx, jsxs, Fragment } from "./jsx-runtime.ts";

export { R, type Hyperscript } from "./hyperscript.ts";

export {
  state,
  derived,
  memo,
  effect,
  batch,
  untracked,
  createRoot,
  onCleanup,
  type State,
  type Derived,
  type Accessor,
  type Dispose,
} from "raptorjs";
