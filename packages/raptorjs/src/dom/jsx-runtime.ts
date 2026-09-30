/**
 * Fine-grained JSX runtime (automatic runtime). Configure tsconfig with:
 *   "jsx": "react-jsx", "jsxImportSource": "raptorjs/dom"
 *
 * There is no Virtual DOM: `jsx` creates real DOM nodes immediately and binds
 * reactive expressions through effects. Components are just functions that
 * return nodes (whitepaper section 6.1).
 */
import { createElement, applyProps, mountChild, type Child } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export const Fragment = Symbol.for("raptor.fragment");

type Props = Record<string, unknown> & { children?: Child };

export function jsx(type: any, props: Props): El | Child {
  if (type === Fragment) {
    return (props.children ?? null) as Child;
  }
  if (typeof type === "function") {
    // Component: a function that returns content.
    return type(props);
  }
  // Intrinsic element.
  const el = createElement(String(type));
  applyProps(el, props);
  if (props.children != null) {
    mountChild(el, props.children as Child, null);
  }
  return el;
}

// In a fine-grained runtime jsxs === jsx (children arrive as an array in props.children).
export const jsxs = jsx;
export const jsxDEV = jsx;

// JSX namespace (types only => erasable). Permissive for the MVP.
export namespace JSX {
  export type Element = any;
  export interface IntrinsicElements {
    [name: string]: any;
  }
  export interface ElementChildrenAttribute {
    children: Record<string, never>;
  }
}
