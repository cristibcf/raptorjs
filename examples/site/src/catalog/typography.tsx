/** Typography. */
import { state, derived, onCleanup } from "@raptor/dom";
import { Input } from "@raptor/ui/input";
import { Blockquote, CodeBlock, Heading, Kbd, Link, Mark, Text, TextList, Truncate } from "@raptor/ui/typography";
import { Code as UICode } from "@raptor/ui/typography";
import { highlight } from "../lib/ui.tsx";
import type { CatalogGroup } from "./types.ts";

const LOREM =
  "A compiler-centric stack: the compiler, the runtime and the wire protocol all read the same state graph, " +
  "which is why an update knows exactly which text node it has to touch and nothing else gets re-run.";

export const TYPOGRAPHY: CatalogGroup = {
  slug: "typography",
  title: "Typography",
  blurb: "Semantic text with a size scale — and numbers that do not jiggle when they change.",
  items: [
    {
      slug: "text",
      name: "Text",
      tier: "T1",
      summary:
        "Text with a size, a tone and a weight. `tabular` switches on equal-width digits, which is what you want for any number that updates in place.",
      code: `Text({ children: "Body copy", size: "md", tone: "muted" });
Text({ children: total, tabular: true, weight: "semibold" });`,
      props: [
        { name: "size", type: `"xs" … "3xl"`, desc: "Step on the type scale." },
        { name: "tone", type: `"default" | "muted" | "accent" | "success" | "warning" | "danger"`, desc: "Semantic colour." },
        { name: "weight", type: `"normal" | "medium" | "semibold" | "bold"`, desc: "Font weight." },
        { name: "tabular", type: "boolean", desc: "Equal-width digits — required for changing numbers." },
        { name: "clamp", type: "number", desc: "Cut to N lines with an ellipsis." },
      ],
      demo: () => {
        const n = state(1080);
        const timer = setInterval(() => n.update((v) => v + Math.round(Math.random() * 90 - 40)), 700);
        onCleanup(() => clearInterval(timer));
        return (
          <div>
            <div class="cmp-row" style="align-items:baseline">
              {Text({ children: "3xl", size: "3xl", weight: "bold" })}
              {Text({ children: "xl", size: "xl" })}
              {Text({ children: "md (default)", size: "md" })}
              {Text({ children: "xs", size: "xs" })}
            </div>
            <div class="cmp-row">
              {Text({ children: "default", tone: "default" })}
              {Text({ children: "muted", tone: "muted" })}
              {Text({ children: "accent", tone: "accent" })}
              {Text({ children: "success", tone: "success" })}
              {Text({ children: "warning", tone: "warning" })}
              {Text({ children: "danger", tone: "danger" })}
            </div>
            <div class="cmp-row">
              {Text({ children: () => String(n()), tabular: true, size: "xl", weight: "semibold" })}
              <span class="chip">tabular digits — the value changes, the width does not</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "heading",
      name: "Heading",
      tier: "T1",
      summary:
        "Headings where the semantic level and the visual size are two separate decisions: `level` picks h1–h6 for the document outline, `size` picks how big it looks.",
      code: `Heading({ level: 2, children: "Section" });
Heading({ level: 3, size: "2xl", children: "Looks big, still an h3" });`,
      demo: () => (
        <div>
          {Heading({ level: 3, size: "2xl", children: "Level 3, size 2xl" })}
          {Heading({ level: 4, size: "lg", children: "Level 4, size lg" })}
          {Heading({ level: 5, size: "md", tone: "muted", children: "Level 5, muted" })}
        </div>
      ),
      notes: [
        "Choosing the level by how big you want the text is how documents end up with an unusable outline. Here you do not have to.",
      ],
    },
    {
      slug: "link",
      name: "Link",
      tier: "T1",
      summary:
        "An anchor that can hand navigation to your router through `onNavigate`, and that marks external links with `rel=\"noreferrer\"` and a visible cue.",
      code: `Link({ href: "/docs", onNavigate: (href) => router.go(href), children: "Docs" });
Link({ href: "https://example.com", external: true, children: "External" });`,
      demo: () => {
        const last = state("—");
        return (
          <div>
            <div class="cmp-row">
              {Link({ href: "/docs", children: "In-app link", onNavigate: (href: string) => last.set(href) })}
              {Link({ href: "https://example.com", external: true, children: "External link" })}
              {Link({ href: "#", tone: "danger", children: "Danger tone" })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                onNavigate saw <b>{last}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "code",
      name: "Code",
      tier: "T2",
      summary: "Inline code: monospace, a soft background, no layout shift.",
      code: `Code({ children: "state(0)" });`,
      demo: () => (
        <p style="margin:0">
          Read a signal by calling it: {UICode({ children: "count()" })}, write it with{" "}
          {UICode({ children: "count.set(5)" })}.
        </p>
      ),
    },
    {
      slug: "code-block",
      name: "CodeBlock",
      tier: "T2",
      summary:
        "A block of code with an optional filename, a copy button, and a `highlight` hook — you bring your own tokenizer instead of shipping one inside the component.",
      code: `CodeBlock({
  code: source,
  file: "counter.ts",
  highlight: (code) => myTokenizer(code),
});`,
      props: [
        { name: "code", type: "Accessor<string> | string", desc: "The source. An accessor makes the block live." },
        { name: "file", type: "string", desc: "Label in the top bar." },
        { name: "highlight", type: "(code: string) => Child", desc: "External tokenizer; without it the code is plain text." },
        { name: "copyable", type: "boolean", desc: "Show the copy button. Default true." },
      ],
      demo: () =>
        CodeBlock({
          file: "counter.ts",
          code: `const count = state(0);
const doubled = derived(() => count() * 2);

effect(() => console.log(doubled()));
count.set(21); // logs 42`,
          highlight: (code: string) => highlight(code),
        }),
      notes: ["This demo passes the site's own tokenizer, the same one used by every code block on this site."],
    },
    {
      slug: "kbd",
      name: "Kbd",
      tier: "T3",
      summary: "A key as it looks on a keyboard. Used by menus, the command palette and shortcut lists.",
      code: `Kbd({ children: "Ctrl" });`,
      demo: () => (
        <div class="cmp-row">
          {Kbd({ children: "Ctrl" })}
          <span>+</span>
          {Kbd({ children: "K" })}
          <span style="margin-left:12px">opens the command palette</span>
        </div>
      ),
    },
    {
      slug: "blockquote",
      name: "Blockquote",
      tier: "T3",
      summary: "A quotation with an optional citation line.",
      code: `Blockquote({ children: "…", cite: "RaptorJS whitepaper, §1.2" });`,
      demo: () =>
        Blockquote({
          children: "We do not parse arbitrary JavaScript: a small grammar, fully understood, beats a large one half-understood.",
          cite: "RaptorEngine whitepaper, §1.2",
        }),
    },
    {
      slug: "text-list",
      name: "TextList",
      tier: "T2",
      summary: "An ordered or unordered list that takes its items from an array — or from an accessor, in which case it stays live.",
      code: `TextList({ items: ["signals", "derived", "effects"] });
TextList({ items: steps, ordered: true });`,
      demo: () => (
        <div class="cmp-row" style="align-items:flex-start;gap:40px">
          {TextList({ items: ["signals", "derived values", "effects"] })}
          {TextList({ items: ["parse", "optimise", "emit"], ordered: true })}
        </div>
      ),
    },
    {
      slug: "truncate",
      name: "Truncate",
      tier: "T2",
      summary: "Cuts text to N lines with an ellipsis and keeps the full string in `title` for hover.",
      code: `Truncate({ lines: 2, title: full, children: full });`,
      demo: () => (
        <div style="max-width:320px">
          {Truncate({ lines: 2, title: LOREM, children: LOREM })}
        </div>
      ),
    },
    {
      slug: "mark",
      name: "Mark",
      tier: "T3",
      summary:
        "Highlights every occurrence of a query inside a string. Type below: only the matching text nodes are rebuilt, the paragraph around them is untouched.",
      code: `const query = state("graph");
Mark({ text: paragraph, query });`,
      demo: () => {
        const query = state("graph");
        const hits = derived(() => {
          const q = query().trim().toLowerCase();
          if (!q) return 0;
          return LOREM.toLowerCase().split(q).length - 1;
        });
        return (
          <div>
            <div class="cmp-row">
              {Input({ value: query, placeholder: "Search…", label: "Query" })}
              <span class="chip">
                <b>{() => String(hits())}</b> matches
              </span>
            </div>
            <p style="margin:0;max-width:56ch">{Mark({ text: LOREM, query })}</p>
          </div>
        );
      },
    },
  ],
};
