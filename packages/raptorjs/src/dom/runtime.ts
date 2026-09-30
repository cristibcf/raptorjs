/**
 * The Raptor DOM runtime - creates real nodes and binds them fine-grained to
 * signals. This is the "conceptual output" of the compiler from whitepaper
 * section 6: with no Virtual DOM, every dynamic expression becomes an effect
 * that touches exactly one text-node / attribute / list region.
 *
 * DOM types are treated structurally (`any`) so it works identically in the
 * browser and on the headless mini-dom.
 */
import { effect, onCleanup, createRoot } from "@raptorstack/raptorjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Accessor<T> = () => T;

/** A self-managed content region (For, Show, Dynamic). */
export interface Block {
  __raptorBlock: true;
  mount(parent: El, anchor: El | null): void;
}

export type Child =
  | El
  | string
  | number
  | boolean
  | null
  | undefined
  | Block
  | ChildAccessor
  | ChildArray;

// The interfaces break the alias self-reference (otherwise TS2456).
interface ChildAccessor {
  (): Child;
}
interface ChildArray extends Array<Child> {}

function doc(): any {
  const d = (globalThis as any).document;
  if (!d) {
    throw new Error(
      "[raptor] no `document` available. In Node, import @raptorstack/raptorjs/dom/testing and call installMiniDom().",
    );
  }
  return d;
}

export function isBlock(value: unknown): value is Block {
  return typeof value === "object" && value !== null && (value as any).__raptorBlock === true;
}

function isNode(value: unknown): value is El {
  return typeof value === "object" && value !== null && typeof (value as any).nodeType === "number";
}

export function block(mount: (parent: El, anchor: El | null) => void): Block {
  return { __raptorBlock: true, mount };
}

// --- Element creation + props ----------------------------------------------

export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Tags that exist ONLY in SVG. In the browser `document.createElement("svg")`
 * produces an unknown HTML element that renders nothing - it needs
 * `createElementNS`. The ambiguous tags (`a`, `script`, `style`, `title`) are
 * NOT here: they also exist in HTML, and the correct choice would require the
 * parent's context. For those, use the second argument of `createElement`.
 */
const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "defs", "use", "symbol", "marker", "mask",
  "clipPath", "pattern", "image", "filter", "foreignObject", "switch",
  "linearGradient", "radialGradient", "stop", "animate", "animateTransform",
  "animateMotion", "desc", "metadata", "view",
]);

export function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag);
}

export function createElement(tag: string, namespace?: string): El {
  const ns = namespace ?? (SVG_TAGS.has(tag) ? SVG_NS : undefined);
  const d = doc();
  if (ns && typeof d.createElementNS === "function") return d.createElementNS(ns, tag);
  return d.createElement(tag);
}

/**
 * A factory for instances from a STATIC skeleton, via `cloneNode(true)`
 * (whitepaper section 6: the compiler's output). `build` runs only once to
 * construct the prototype; each call returns a fresh clone, avoiding
 * `createElement` per node on every instance. Binding of dynamic content
 * happens on the clone (the skeleton is static). For repeated rows (lists) this
 * significantly reduces the create cost.
 */
export function template(build: () => El): () => El {
  let proto: El | null = null;
  return () => {
    if (proto === null) proto = build();
    return proto.cloneNode(true);
  };
}

const BOOLEAN_ATTRS = new Set(["disabled", "checked", "readonly", "required", "selected", "hidden"]);

/**
 * Form controls where the attribute alone is not enough. Once the user has
 * typed into an input (or checked a box), the element becomes "dirty" and the
 * attribute no longer changes what is shown - a reactively bound `value` would
 * stop having any effect right after the first interaction.
 *
 * We write BOTH the property (what is shown now) AND the attribute (what gets
 * serialized on SSR and what becomes the default value again on form.reset()).
 */
const FORM_PROPS: Record<string, Set<string>> = {
  value: new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]),
  checked: new Set(["INPUT"]),
  selected: new Set(["OPTION"]),
};

function setFormProperty(el: El, name: string, value: unknown): void {
  const target = el as unknown as Record<string, unknown>;
  if (name === "value") {
    const next = value == null || value === false ? "" : String(value);
    // Don't write if already equal: otherwise the cursor jumps to the end while typing.
    if (target.value !== next) target.value = next;
    return;
  }
  target[name] = value === true || (value != null && value !== false);
}

/**
 * The attributes that load an address: there a `javascript:` scheme executes
 * code.
 *
 * `formaction` and `action` matter just as much as `href`: a submit button with
 * `formaction="javascript:..."` runs on click.
 */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "data", "srcdoc"]);

/**
 * `true` if the value is an address that executes code instead of navigating.
 *
 * Normalization matters more than the list: browsers ignore whitespace and
 * control characters before the scheme, so `"java\\nscript:alert(1)"` and
 * `" javascript:alert(1)"` are just as executable as the clean form. We check
 * after stripping them, not before.
 */
const EXECUTABLE_SCHEMES = ["javascript:", "vbscript:", "data:text/html"];

/** Whitespace and control characters that the URL parser ignores. */
function isIgnorable(code: number): boolean {
  if (code <= 0x20) return true; // control + space
  return code === 0xa0 || code === 0x180e || code === 0xfeff || (code >= 0x2000 && code <= 0x200d) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

function isExecutableUrl(value: string): boolean {
  let normalized = "";
  for (const ch of value) {
    if (!isIgnorable(ch.codePointAt(0)!)) normalized += ch;
    // Stop once we've passed the longest prefix we care about.
    if (normalized.length > 16) break;
  }
  const head = normalized.toLowerCase();
  return EXECUTABLE_SCHEMES.some((scheme) => head.startsWith(scheme));
}

function setAttribute(el: El, name: string, value: unknown): void {
  // tagName is uppercase in the real DOM and lowercase in the test mini-dom.
  const tag = ((el as unknown as { tagName?: string }).tagName ?? "").toUpperCase();
  if (FORM_PROPS[name]?.has(tag)) setFormProperty(el, name, value);

  if (BOOLEAN_ATTRS.has(name)) {
    if (value === false || value == null) el.removeAttribute(name);
    else el.setAttribute(name, "");
    return;
  }
  if (value === false || value == null) {
    el.removeAttribute(name);
    return;
  }

  const text = String(value);
  // An address almost always comes from data, and data comes off the wire: that
  // is the whole RaptorWire thesis. An `href` taken from a navigation element
  // sent by the server must not be allowed to execute code. We reject it, and
  // say why - an attribute that vanishes without explanation is harder to debug
  // than a hole.
  if (URL_ATTRS.has(name) && isExecutableUrl(text)) {
    console.warn(`[raptor] '${name}' with executable scheme, rejected: ${text.slice(0, 60)}`);
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, text);
}

export function applyProps(el: El, props: Record<string, unknown> | null): void {
  if (!props) return;
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "key" || key === "ref") continue;
    const value = props[key];

    // Events: `on:click` or `onClick`.
    if (key.startsWith("on:") || (key.startsWith("on") && key.length > 2 && key[2] === key[2]?.toUpperCase())) {
      const type = key.startsWith("on:") ? key.slice(3) : key.slice(2).toLowerCase();
      el.addEventListener(type, value as (e: unknown) => void);
      continue;
    }

    if (typeof value === "function") {
      // Fine-grained reactive binding: only this attribute updates.
      effect(() => setAttribute(el, key, (value as Accessor<unknown>)()));
    } else {
      setAttribute(el, key, value);
    }
  }
  if (typeof props.ref === "function") (props.ref as (el: El) => void)(el);
}

// --- Mounting children ------------------------------------------------------
export function mountChild(parent: El, child: Child, anchor: El | null): void {
  if (child == null || child === true || child === false) return;

  if (typeof child === "string" || typeof child === "number") {
    insertNode(parent, doc().createTextNode(String(child)), anchor);
    return;
  }

  if (Array.isArray(child)) {
    for (const c of child) mountChild(parent, c, anchor);
    return;
  }

  if (isBlock(child)) {
    child.mount(parent, anchor);
    return;
  }

  if (isNode(child)) {
    insertNode(parent, child, anchor);
    return;
  }

  if (typeof child === "function") {
    mountDynamic(parent, child as Accessor<Child>, anchor);
    return;
  }
}

function insertNode(parent: El, node: El, anchor: El | null): void {
  if (anchor) parent.insertBefore(node, anchor);
  else parent.appendChild(node);
}

/**
 * A counter that suppresses DOM removals. When an ancestor is detached in a
 * single operation (e.g. `For` removes a whole `<tr>`), the region cleanups no
 * longer need to individually remove each text-node/anchor beneath it — that
 * would be duplicated work on already-detached nodes. `disposeDetached` raises
 * the flag while it runs the reactive dispose.
 */
let removalSuppressed = 0;

/**
 * Removes `node` from its parent in a single `removeChild` (detaching the whole
 * subtree), then runs `dispose` with DOM removals suppressed. Reduces
 * `clear`/remove from O(nodes) to O(rows) DOM operations. See [[For]].
 */
export function disposeDetached(node: El, dispose: () => void): void {
  const parent = node.parentNode;
  if (parent) parent.removeChild(node);
  removalSuppressed++;
  try {
    dispose();
  } finally {
    removalSuppressed--;
  }
}

/**
 * A dynamic region: `() => value`. Fast-path for text: it creates ONLY a
 * text-node (no comment-anchor) and updates `.data` on change — the comment
 * anchor is materialized lazily only if the region becomes structural
 * (array/node). This saves a node + an insert per text binding (a win on bulk
 * create).
 */
function mountDynamic(parent: El, accessor: Accessor<Child>, anchor: El | null): void {
  let end: El | null = null; // comment-anchor, created lazily
  let current: El[] = [];
  let textNode: El | null = null;

  function ensureEnd(): El {
    if (end === null) {
      end = doc().createComment("");
      // Place it right after the current content (or at the anchor).
      const ref = current.length > 0 ? current[current.length - 1]!.nextSibling : anchor;
      insertNode(parent, end, ref);
    }
    return end;
  }

  effect(() => {
    const value = accessor();
    // Fast-path text: reuse the text-node, just move `.data`.
    if (typeof value === "string" || typeof value === "number") {
      const str = String(value);
      if (textNode !== null) {
        if (textNode.data !== str) textNode.data = str;
        return;
      }
      if (current.length === 0 && end === null) {
        // Pure-text region: no comment anchor.
        textNode = doc().createTextNode(str);
        insertNode(parent, textNode, anchor);
        current = [textNode];
        return;
      }
      const text = doc().createTextNode(str);
      current = replaceRegion(parent, current, [text], ensureEnd());
      textNode = text;
      return;
    }
    // Structural: we need the end anchor.
    textNode = null;
    const nodes = resolveNodes(value);
    current = replaceRegion(parent, current, nodes, ensureEnd());
  });

  onCleanup(() => {
    if (removalSuppressed === 0) {
      for (const n of current) if (n.parentNode) n.parentNode.removeChild(n);
      if (end !== null && end.parentNode) end.parentNode.removeChild(end);
    }
  });
}

function resolveNodes(value: Child): El[] {
  if (value == null || value === true || value === false) return [];
  if (typeof value === "string" || typeof value === "number") {
    return [doc().createTextNode(String(value))];
  }
  if (Array.isArray(value)) {
    const out: El[] = [];
    for (const v of value) out.push(...resolveNodes(v));
    return out;
  }
  if (isNode(value)) return [value];
  if (typeof value === "function") return resolveNodes((value as Accessor<Child>)());
  if (isBlock(value)) {
    // A `Block` mounts itself into a parent; it cannot be reduced to a list of
    // nodes. Previously it fell through to `return []` and vanished SILENTLY,
    // which is the worst way to fail. Blocks go directly as children
    // (`R.div(For({...}))`), not through `() => For({...})`.
    throw new Error(
      "[raptor] a Block (For/Show/Portal) cannot be returned from a dynamic " +
        "region. Put it directly as a child instead of `() => For({...})`.",
    );
  }
  return [];
}

function replaceRegion(parent: El, current: El[], next: El[], anchor: El): El[] {
  for (const n of current) if (n.parentNode === parent) parent.removeChild(n);
  for (const n of next) parent.insertBefore(n, anchor);
  return next;
}

// --- render ----------------------------------------------------------------
export type Component = () => Child;

const mountCallbacks: Array<() => void> = [];

/** Schedules a callback after the current tree has been mounted (section 10). */
export function onMount(fn: () => void): void {
  mountCallbacks.push(fn);
}

/** Mounts a component into a container. Returns a deterministic dispose. */
export function render(component: Component, container: El): () => void {
  return createRoot((dispose) => {
    const child = component();
    mountChild(container, child, null);
    const pending = mountCallbacks.splice(0);
    for (const cb of pending) cb();
    return () => {
      dispose();
      container.textContent = "";
    };
  });
}
