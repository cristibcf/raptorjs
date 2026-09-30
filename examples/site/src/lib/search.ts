/**
 * Client-side search, zero-dep. The index is built once from the site's
 * already-structured content (Learn, Docs, Components) - the same data that
 * feeds the pages, so it cannot diverge from them. No Algolia, no external
 * service: it fits the "zero dependencies" thesis.
 */
import { LESSONS } from "../content/learn.ts";
import { REF_PACKAGES } from "../content/reference.ts";
import { ALL_COMPONENTS } from "../catalog/index.ts";
import type { Block } from "./ui.tsx";

export interface SearchDoc {
  title: string;
  /** Section label shown next to the result. */
  kind: string;
  /** Internal route (without `#/`). */
  path: string;
  text: string;
}
export interface SearchResult extends SearchDoc {
  score: number;
}

/** The searchable text from a sequence of content blocks. */
function blockText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.t === "p" || b.t === "h") parts.push(b.text);
    else if (b.t === "note") parts.push((b.title ?? "") + " " + b.text);
    else if (b.t === "list") parts.push(b.items.join(" "));
    else if (b.t === "code") parts.push(b.code);
    else if (b.t === "table") parts.push([...b.head, ...b.rows.flat()].join(" "));
  }
  return parts.join(" ");
}

let INDEX: SearchDoc[] | null = null;

function buildIndex(): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const l of LESSONS) {
    docs.push({ title: l.title, kind: "Learn", path: "learn/" + l.slug, text: l.intro + " " + blockText(l.blocks) });
  }
  for (const p of REF_PACKAGES) {
    docs.push({ title: p.name, kind: "Docs", path: "reference/" + p.slug, text: p.tagline });
    for (const e of p.entries) {
      docs.push({ title: e.name, kind: p.name, path: "reference/" + p.slug, text: e.summary + " " + e.signature });
    }
  }
  for (const c of ALL_COMPONENTS) {
    docs.push({ title: c.name, kind: "Component", path: "components/" + c.slug, text: c.summary });
  }
  return docs;
}

/** The total number of indexed documents (for display/tests). */
export function indexSize(): number {
  if (!INDEX) INDEX = buildIndex();
  return INDEX.length;
}

/**
 * Search `query` in the index. Scoring: a title match >> a body match.
 * Every term must appear somewhere (title or body), otherwise the result drops out.
 */
export function search(query: string, limit = 10): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  if (!INDEX) INDEX = buildIndex();
  const terms = q.split(/\s+/).filter(Boolean);
  const out: SearchResult[] = [];
  for (const d of INDEX) {
    const title = d.title.toLowerCase();
    const text = d.text.toLowerCase();
    const all = terms.every((t) => title.includes(t) || text.includes(t));
    if (!all) continue;
    let score = 0;
    for (const t of terms) {
      if (title === t) score += 100;
      else if (title.startsWith(t)) score += 45;
      else if (title.includes(t)) score += 22;
      if (text.includes(t)) score += 4;
    }
    if (score > 0) out.push({ ...d, score });
  }
  out.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return out.slice(0, limit);
}
