/**
 * @raptorstack/raptorjs/dom/head - document head management (SSG 3B, report #7).
 *
 * `Title`, `Meta` and `Link` are placed anywhere in the component tree and render
 * no visible DOM; they manage `<title>`/`<meta>`/`<link>` instead. The same call
 * works in both modes:
 *   - on the server (inside `renderToStringWithHead`), the entry is recorded into
 *     the active capture so the driver can serialize it into the page `<head>` -
 *     which is what gets a crawler the title/description without running JS;
 *   - on the client, it reconciles `document.head` reactively (keyed,
 *     last-writer-wins) and removes its tag when the owning scope unmounts.
 *
 * This lives on its own subpath, not the `dom` barrel, so its `Link` (the
 * `<link>` element) does not collide with the router's `Link` (an `<a>`).
 */
import { effect, onCleanup } from "@raptorstack/raptorjs";
import { block, isServer, type Block } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

/** A head element to emit: a title with text, or a meta/link with attributes. */
export interface HeadEntry {
  tag: "title" | "meta" | "link";
  /** Dedup key: entries with the same key replace each other (last wins). */
  key: string;
  attrs: Record<string, string>;
  text?: string;
}

// --- Server-side capture ---------------------------------------------------
let sink: HeadEntry[] | null = null;

/** Runs `fn` with head capture active and returns its result plus the entries. */
export function captureHead<T>(fn: () => T): { result: T; entries: HeadEntry[] } {
  const prev = sink;
  const entries: HeadEntry[] = [];
  sink = entries;
  try {
    return { result: fn(), entries };
  } finally {
    sink = prev;
  }
}

function record(entry: HeadEntry): void {
  if (!sink) return;
  const i = sink.findIndex((e) => e.key === entry.key);
  if (i >= 0) sink[i] = entry;
  else sink.push(entry);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Serializes captured head entries to markup for a page `<head>`. */
export function renderHeadEntries(entries: readonly HeadEntry[]): string {
  let out = "";
  for (const e of entries) {
    if (e.tag === "title") {
      out += `<title>${escapeText(e.text ?? "")}</title>`;
    } else {
      let attrs = "";
      for (const name of Object.keys(e.attrs)) attrs += ` ${name}="${escapeAttr(e.attrs[name]!)}"`;
      out += `<${e.tag}${attrs}>`; // meta and link are void
    }
  }
  return out;
}

// --- Client-side reconciliation --------------------------------------------
interface HeadManager {
  set(entry: HeadEntry): void;
  remove(key: string): void;
}

let manager: HeadManager | null = null;

/** Test helper: drop the client head manager and its element cache. */
export function resetHead(): void {
  manager = null;
}

function headManager(): HeadManager {
  if (manager) return manager;
  const els = new Map<string, El>();
  const doc = (): any => (globalThis as any).document;
  manager = {
    set(entry) {
      const d = doc();
      if (!d || !d.head) return;
      let el = els.get(entry.key);
      if (!el) {
        el = d.createElement(entry.tag);
        els.set(entry.key, el);
        d.head.appendChild(el);
      }
      if (entry.tag === "title") el.textContent = entry.text ?? "";
      else for (const name of Object.keys(entry.attrs)) el.setAttribute(name, entry.attrs[name]!);
    },
    remove(key) {
      if (key === "title") return; // the title persists across navigations
      const el = els.get(key);
      if (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
        els.delete(key);
      }
    },
  };
  return manager;
}

// --- Components ------------------------------------------------------------
/** A head block: records on the server (single pass), reconciles on the client. */
function headBlock(compute: () => HeadEntry): Block {
  return block(() => {
    if (isServer()) {
      record(compute());
      return;
    }
    const head = headManager();
    let key: string | null = null;
    effect(() => {
      const entry = compute();
      key = entry.key;
      head.set(entry);
    });
    onCleanup(() => {
      if (key !== null) head.remove(key);
    });
  });
}

/** Sets the document title. Accepts a string or a reactive accessor. */
export function Title(text: string | (() => string)): Block {
  return headBlock(() => ({
    tag: "title",
    key: "title",
    attrs: {},
    text: typeof text === "function" ? text() : text,
  }));
}

export interface MetaProps {
  name?: string;
  property?: string;
  charset?: string;
  httpEquiv?: string;
  content?: string;
  [key: string]: string | undefined;
}

/** Drops undefined values and maps `httpEquiv` to the `http-equiv` attribute. */
function toAttrs(props: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value == null) continue;
    out[key === "httpEquiv" ? "http-equiv" : key] = value;
  }
  return out;
}

/** A `<meta>` tag, deduped by name/property/charset/http-equiv. */
export function Meta(props: MetaProps | (() => MetaProps)): Block {
  return headBlock(() => {
    const p = typeof props === "function" ? props() : props;
    const key = "meta:" + (p.name ?? p.property ?? p.charset ?? p.httpEquiv ?? JSON.stringify(p));
    return { tag: "meta", key, attrs: toAttrs(p) };
  });
}

export interface LinkProps {
  rel?: string;
  href?: string;
  [key: string]: string | undefined;
}

/** A `<link>` tag (stylesheet, canonical, icon, ...), deduped by rel+href. */
export function Link(props: LinkProps | (() => LinkProps)): Block {
  return headBlock(() => {
    const p = typeof props === "function" ? props() : props;
    const key = "link:" + (p.rel ?? "") + ":" + (p.href ?? "");
    return { tag: "link", key, attrs: toAttrs(p) };
  });
}
