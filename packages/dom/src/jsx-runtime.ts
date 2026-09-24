/**
 * JSX runtime fine-grained (automatic runtime). Configureaza tsconfig cu:
 *   "jsx": "react-jsx", "jsxImportSource": "@raptor/dom"
 *
 * Nu exista Virtual DOM: `jsx` creeaza noduri DOM reale imediat si leaga
 * expresiile reactive prin effects. Componentele sunt simple functii care
 * intorc noduri (whitepaper sectiunea 6.1).
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
    // Component: functie care intoarce continut.
    return type(props);
  }
  // Element intrinsec.
  const el = createElement(String(type));
  applyProps(el, props);
  if (props.children != null) {
    mountChild(el, props.children as Child, null);
  }
  return el;
}

// In runtime fine-grained jsxs === jsx (copiii vin ca array in props.children).
export const jsxs = jsx;
export const jsxDEV = jsx;

// Namespace JSX (doar tipuri => erasabil). Permisiv pentru MVP.
export namespace JSX {
  export type Element = any;
  export interface IntrinsicElements {
    [name: string]: any;
  }
  export interface ElementChildrenAttribute {
    children: Record<string, never>;
  }
}
