/**
 * Hyperscript builder `R` - a JSX-free API over the same fine-grained
 * primitives.
 *
 * `R.div({ class: "x" }, () => count())` does exactly what `jsx("div", ...)`
 * does: it creates the real DOM node immediately and binds reactive expressions
 * through effects. There is no Virtual DOM and no compilation step - useful
 * where code is evaluated at runtime (playground, REPL) or in projects without
 * a build step.
 *
 * Components are built by calling `R` directly: `R(MyComp, { a: 1 }, child)`.
 */
import { createElement, applyProps, mountChild, isBlock, type Child } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Props = Record<string, unknown>;

/**
 * The first argument is `props` only if it is a plain object. This is not a
 * heuristic: a `Child` (see runtime.ts) is a DOM node, string, number, boolean,
 * `Block`, accessor or array - so an object that is none of these is props.
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

/** The direct call `R(Component, props?, ...children)`. */
function component(type: (props: any) => El, props?: Props | null, ...children: Child[]): El {
  return type({ ...(props ?? {}), children });
}

type Builder = (...args: unknown[]) => El;

export type Hyperscript = typeof component & {
  readonly [K in keyof HTMLElementTagNameMap]: Builder;
} & {
  // SVG kept separate: otherwise `R.svg` / `R.path` fall onto the index
  // signature and, with `noUncheckedIndexedAccess`, become `Builder | undefined`.
  readonly [K in keyof SVGElementTagNameMap]: Builder;
} & { readonly [tag: string]: Builder };

// One builder per tag, created once. The proxy only does a Map lookup.
const builders = new Map<string, Builder>();

export const R: Hyperscript = new Proxy(component, {
  get(target, key) {
    // Non-string keys (symbols) and `then` stay on the target function:
    // otherwise `await R` would see a fake thenable and break the call.
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
