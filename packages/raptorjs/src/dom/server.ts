/**
 * @raptorstack/raptorjs/dom/server - render a component to an HTML string at build
 * time (SSG, report #1). The runtime reaches the DOM only through
 * `globalThis.document`, so server rendering is: install a headless document,
 * `render()` into it, serialize, dispose, restore.
 *
 * The headless document is mini-dom (already proven to render real components in
 * the test suite). mini-dom's own `toHTML()` is for tests and is NOT spec-correct
 * for serving - it closes void elements, drops the `style` object and does not
 * merge it with a `style` attribute. The serializer here is the SSG-grade one:
 *   - void elements self-close;
 *   - `el.style` (set imperatively, e.g. by VirtualFor) is flushed and merged
 *     with any `style` attribute;
 *   - attributes and text are escaped.
 *
 * `onMount` and other browser-only work is skipped via the runtime's server mode
 * (see `setServerMode`); an effect that touches `window` must guard with
 * `isServer()`.
 */
import { MiniDocument, MiniElement, MiniText, MiniComment } from "./testing/mini-dom.ts";
import { render, setServerMode, type Child, type Component } from "./runtime.ts";
import { captureHead, renderHeadEntries, type HeadEntry } from "./head.ts";

/** Elements that have no closing tag and no children in HTML. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** camelCase style keys -> kebab-case CSS property names. */
function hyphenate(key: string): string {
  return key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** Serializes an imperatively-set `style` object into a declaration string. */
function styleObjectToString(style: Record<string, string> | undefined): string {
  if (!style) return "";
  const parts: string[] = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value !== "" && value != null) parts.push(`${hyphenate(key)}: ${value}`);
  }
  return parts.join("; ");
}

function serializeElement(el: MiniElement): string {
  const tag = el.tagName;

  let attrs = "";
  for (const [name, value] of el.attributes) {
    if (name === "style") continue; // merged below with the style object
    attrs += ` ${name}="${escapeAttr(value)}"`;
  }

  // Merge a `style` attribute (string prop) with the imperative `el.style` object.
  const styleParts: string[] = [];
  const attrStyle = el.attributes.get("style");
  if (attrStyle) styleParts.push(attrStyle.replace(/\s*;\s*$/, ""));
  const objStyle = styleObjectToString((el as unknown as { style?: Record<string, string> }).style);
  if (objStyle) styleParts.push(objStyle);
  if (styleParts.length > 0) attrs += ` style="${escapeAttr(styleParts.join("; "))}"`;

  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;

  let inner = "";
  for (const child of el.childNodes) inner += serializeNode(child);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/** Serializes a single node (element / text / comment) to HTML. */
export function serializeNode(node: unknown): string {
  if (node instanceof MiniText) return escapeText(node.data);
  if (node instanceof MiniComment) return `<!--${node.data}-->`;
  if (node instanceof MiniElement) return serializeElement(node);
  return "";
}

/**
 * Core render: install a fresh headless document, render into it, serialize,
 * dispose, restore. `capture` collects head entries (Title/Meta/Link) when set.
 * Isolated - the previous `globalThis.document` and server-mode flag are
 * restored - so it is safe to call from a process that has another document.
 */
function renderInternal(component: Component, capture: boolean): { html: string; entries: HeadEntry[] } {
  const globals = globalThis as unknown as { document?: unknown };
  const prevDocument = globals.document;
  const prevServer = setServerMode(true);
  const doc = new MiniDocument();
  globals.document = doc;
  try {
    const root = doc.createElement("div");
    let entries: HeadEntry[] = [];
    let dispose: () => void;
    if (capture) {
      const captured = captureHead(() => render(component, root));
      dispose = captured.result;
      entries = captured.entries;
    } else {
      dispose = render(component, root);
    }
    let html = "";
    for (const child of root.childNodes) html += serializeNode(child);
    dispose();
    return { html, entries };
  } finally {
    setServerMode(prevServer);
    globals.document = prevDocument;
  }
}

/** Renders `component` to an HTML string (the mounted markup, no document shell). */
export function renderToString(component: Component): string {
  return renderInternal(component, false).html;
}

/**
 * Like {@link renderToString}, but also returns the serialized `<head>` markup
 * collected from Title/Meta/Link (from @raptorstack/raptorjs/dom/head) during the
 * render - pass it as {@link DocumentShellOptions.head}.
 */
export function renderToStringWithHead(component: Component): { html: string; head: string } {
  const { html, entries } = renderInternal(component, true);
  return { html, head: renderHeadEntries(entries) };
}

export interface DocumentShellOptions {
  /** The rendered body markup (typically from {@link renderToString}). */
  body: string;
  /** Raw markup injected into `<head>` (stylesheet links, meta, title; 3B/3D). */
  head?: string;
  /** `lang` attribute on `<html>`. */
  lang?: string;
}

/** Wraps rendered body markup in a complete HTML document (doctype + html/head/body). */
export function renderDocument(options: DocumentShellOptions): string {
  const lang = options.lang ? ` lang="${escapeAttr(options.lang)}"` : "";
  return (
    "<!doctype html>\n" +
    `<html${lang}>\n` +
    `<head>${options.head ?? ""}</head>\n` +
    `<body>${options.body}</body>\n` +
    "</html>\n"
  );
}

export type { Child, Component };
