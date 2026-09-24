/**
 * Hyperscript builder `R` - API fara JSX peste aceleasi primitive fine-grained.
 *
 * `R.div({ class: "x" }, () => count())` face exact ce face `jsx("div", ...)`:
 * creeaza nodul DOM real imediat si leaga expresiile reactive prin effects.
 * Nu exista Virtual DOM si nu exista pas de compilare - util acolo unde codul
 * e evaluat la runtime (playground, REPL) sau in proiecte fara build step.
 *
 * Componentele se construiesc apeland `R` direct: `R(MyComp, { a: 1 }, child)`.
 */
import { createElement, applyProps, mountChild, isBlock, type Child } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Props = Record<string, unknown>;

/**
 * Primul argument e `props` doar daca e un obiect simplu. Nu e euristica:
 * un `Child` (vezi runtime.ts) e nod DOM, string, number, boolean, `Block`,
 * accessor sau array - deci un obiect care nu e niciuna dintre astea e props.
 */
function isProps(value: unknown): value is Props {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isBlock(value) &&
    typeof (value as any).nodeType !== "number"
  );
}

function build(tag: string, args: unknown[]): El {
  const el = createElement(tag);
  let i = 0;
  if (isProps(args[0])) {
    applyProps(el, args[0] as Props);
    i = 1;
  }
  for (; i < args.length; i++) mountChild(el, args[i] as Child, null);
  return el;
}

/** Apelul direct `R(Component, props?, ...children)`. */
function component(type: (props: any) => El, props?: Props | null, ...children: Child[]): El {
  return type({ ...(props ?? {}), children });
}

type Builder = (...args: unknown[]) => El;

export type Hyperscript = typeof component & {
  readonly [K in keyof HTMLElementTagNameMap]: Builder;
} & {
  // SVG separat: altfel `R.svg` / `R.path` cad pe index signature si, cu
  // `noUncheckedIndexedAccess`, ajung `Builder | undefined`.
  readonly [K in keyof SVGElementTagNameMap]: Builder;
} & { readonly [tag: string]: Builder };

// Un builder pe tag, creat o singura data. Proxy-ul face doar lookup in Map.
const builders = new Map<string, Builder>();

export const R: Hyperscript = new Proxy(component, {
  get(target, key) {
    // Cheile non-string (simboluri) si `then` raman ale functiei-target:
    // altfel `await R` ar vedea un thenable fals si ar strica apelul.
    if (typeof key !== "string" || key === "then") {
      return (target as any)[key];
    }
    let fn = builders.get(key);
    if (fn === undefined) {
      fn = (...args: unknown[]) => build(key, args);
      builders.set(key, fn);
    }
    return fn;
  },
}) as Hyperscript;
