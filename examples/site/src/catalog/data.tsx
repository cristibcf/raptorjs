/** Data display. */
import { state, R } from "raptorjs/dom";
import { Kanban, type KanbanCard } from "raptorjs/ui/advanced";
import { Button } from "raptorjs/ui/button";
import { DataGrid } from "raptorjs/ui/data-grid";
import { ListView, TreeView } from "raptorjs/ui/data-views";
import { Accordion, Collapsible } from "raptorjs/ui/disclosure";
import {
  Avatar,
  AvatarGroup,
  Badge,
  Card,
  DescriptionList,
  EmptyState,
  Image,
  Stat,
  Tag,
  Timeline,
} from "raptorjs/ui/display";
import { ComparisonTable, DiffViewer, JsonViewer } from "raptorjs/ui/editors";
import { Carousel, Gallery } from "raptorjs/ui/media";
import { Table } from "raptorjs/ui/table";
import { SAMPLE_IMAGES, BROKEN_IMAGE } from "./sample.ts";
import type { CatalogGroup } from "./types.ts";

interface Row {
  id: number;
  pkg: string;
  tests: number;
  size: number;
}
const ROWS: Row[] = [
  { id: 1, pkg: "raptorjs", tests: 31, size: 6.2 },
  { id: 2, pkg: "raptorjs/dom", tests: 24, size: 8.8 },
  { id: 3, pkg: "@raptor/wire", tests: 38, size: 11.4 },
  { id: 4, pkg: "@raptor/wire/server", tests: 12, size: 4.1 },
  { id: 5, pkg: "raptorjs/ui", tests: 46, size: 22.9 },
];


const OLD_TEXT = `function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price;
  return sum;
}`;
const NEW_TEXT = `function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price * item.qty;
  return Math.round(sum);
}`;

export const DATA: CatalogGroup = {
  slug: "data",
  title: "Data display",
  blurb:
    "Tables, trees, cards and badges. This is where fine-grained updates stop being a talking point: a cell changes, a cell is written.",
  items: [
    {
      slug: "table",
      name: "Table",
      tier: "T1",
      thesis:
        "A cell can return an accessor, and then that cell alone is a binding. Sorting reorders the existing rows instead of rebuilding them, and a value that changes writes one text node.",
      summary:
        "A sortable table where the cells are yours. A column without `sort` is deliberately not sortable — there is no implicit string comparison to get dates and numbers wrong.",
      code: `Table({
  rows: () => rows(),
  sort: { key: "tests", dir: "desc" },
  columns: [
    { key: "pkg", header: "Package", cell: (r) => r.pkg, sort: (a, b) => a.pkg.localeCompare(b.pkg) },
    { key: "tests", header: "Tests", align: "right", cell: (r) => r.tests, sort: (a, b) => a.tests - b.tests },
  ],
});`,
      props: [
        { name: "rows", type: "Accessor<readonly T[]>", desc: "The data, as an accessor — change it and the table follows." },
        { name: "columns", type: "readonly Column<T>[]", desc: "key, header, cell, optional sort comparator, width, align." },
        { name: "sort", type: "SortState", desc: "Initial sort. Omit it and the order is yours." },
        { name: "selected", type: "State<ReadonlySet<T>>", desc: "Pass a signal to switch selection on; you own it." },
        { name: "empty", type: "Child", desc: "Shown when there are no rows." },
      ],
      demo: () => {
        const rows = state<readonly Row[]>(ROWS);
        const selected = state<ReadonlySet<Row>>(new Set());
        return (
          <div>
            {Table({
              rows: () => rows(),
              selected,
              sort: { key: "tests", dir: "desc" },
              columns: [
                { key: "pkg", header: "Package", cell: (r: Row) => r.pkg, sort: (a: Row, b: Row) => a.pkg.localeCompare(b.pkg) },
                { key: "tests", header: "Tests", align: "right", cell: (r: Row) => String(r.tests), sort: (a: Row, b: Row) => a.tests - b.tests },
                { key: "size", header: "Size (KB)", align: "right", cell: (r: Row) => r.size.toFixed(1), sort: (a: Row, b: Row) => a.size - b.size },
              ],
            })}
            <div class="cmp-row" style="margin-top:12px">
              <span class="chip">
                selected: <b>{() => String(selected().size)}</b>
              </span>
              {Button({ children: "Add a row", size: "sm", onClick: () => rows.update((rs) => [...rs, { id: rs.length + 1, pkg: "@raptor/new-" + rs.length, tests: 1, size: 0.4 }]) })}
            </div>
          </div>
        );
      },
      notes: ["Click a header to sort, click a row to select it — the selection is a `Set` signal you own."],
    },
    {
      slug: "data-grid",
      name: "DataGrid",
      tier: "T2",
      thesis:
        "The grid renders a window, not a list: 50 000 rows are about a dozen row nodes in the DOM, recycled as you scroll. That is the virtualizer primitive doing the work, not a special case in the grid.",
      summary: "A virtualised table with resizable columns for lists too long to render — scroll through 20 000 rows and watch the node count stay flat.",
      code: `DataGrid({
  rows: () => bigList(),
  rowHeight: 32,
  height: 320,
  columns: [{ key: "id", header: "#", width: 80, cell: (r) => r.id }, …],
});`,
      demo: () => {
        const big = Array.from({ length: 20_000 }, (_, i) => ({
          id: i + 1,
          name: "row-" + (i + 1),
          value: Math.round(Math.sin(i) * 1000) / 10,
        }));
        return (
          <div>
            {DataGrid({
              rows: () => big,
              rowHeight: 30,
              height: 260,
              columns: [
                { key: "id", header: "#", width: 80, align: "right", cell: (r: any) => String(r.id), sort: (a: any, b: any) => a.id - b.id },
                { key: "name", header: "Name", width: 180, cell: (r: any) => r.name },
                { key: "value", header: "Value", width: 120, align: "right", cell: (r: any) => r.value.toFixed(1), sort: (a: any, b: any) => a.value - b.value },
              ],
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">20 000 rows — drag a column edge to resize</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "tree-view",
      name: "TreeView",
      tier: "T2",
      summary:
        "An expandable tree with the full keyboard contract and lazy children: a node marked `hasChildren` calls `loadChildren` the first time it opens.",
      code: `TreeView({
  nodes: TREE,
  loadChildren: async (node) => fetchChildren(node.key),
  onSelect: (node) => open(node.key),
});`,
      demo: () => {
        const selected = state<string | null>(null);
        return (
          <div>
            {TreeView({
              selected,
              label: "Repository",
              nodes: [
                {
                  key: "packages",
                  label: "packages",
                  children: [
                    { key: "core", label: "core" },
                    { key: "dom", label: "dom" },
                    { key: "wire", label: "wire", hasChildren: true },
                  ],
                },
                { key: "examples", label: "examples", children: [{ key: "site", label: "site" }] },
              ],
              loadChildren: (node: any) =>
                new Promise((resolve) =>
                  setTimeout(() => resolve([{ key: node.key + "-codec", label: "codec" }, { key: node.key + "-core", label: "core" }]), 500),
                ),
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                selected: <b>{() => selected() ?? "—"}</b>
              </span>
              <span class="chip">open “wire” — its children arrive after 500 ms</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "list-view",
      name: "ListView",
      tier: "T2",
      summary:
        "A list with grouping, per-row actions, and real multi-selection: click, Ctrl+click, Shift+click — the behaviour of a file manager, not of a checkbox column.",
      code: `ListView({
  items: () => files(),
  render: (f) => f.name,
  groupBy: (f) => f.kind,
  selectable: true,
  actions: (f) => Button({ children: "Open", size: "sm" }),
});`,
      demo: () =>
        ListView({
          items: () => ROWS,
          selectable: true,
          multiple: true,
          label: "Packages",
          groupBy: (r: Row) => (r.tests > 25 ? "Well covered" : "Needs tests"),
          render: (r: Row) => R.span({}, r.pkg),
          actions: (r: Row) => Button({ children: "Open", size: "sm", label: "Open " + r.pkg }),
        }),
    },
    {
      slug: "description-list",
      name: "DescriptionList",
      tier: "T2",
      summary: "Key–value pairs as a real `<dl>` — metadata panels, receipt details, a settings summary.",
      code: `DescriptionList({ items: [{ term: "Version", description: "0.1.0-alpha" }] });`,
      demo: () =>
        DescriptionList({
          items: [
            { term: "Version", description: "0.1.0-alpha" },
            { term: "License", description: "MIT" },
            { term: "Runtime dependencies", description: "none" },
          ],
        }),
    },
    {
      slug: "card",
      name: "Card",
      tier: "T1",
      summary: "A surface with a header and a footer. Give it `onClick` and it becomes a real button — Enter and Space included.",
      code: `Card({ title: "Wire", children: body, footer: actions });`,
      demo: () => {
        const clicks = state(0);
        return (
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            {Card({
              title: "Static card",
              children: R.div({ style: "font-size:14px" }, "A surface with a title and a body."),
              footer: R.span({ style: "font-size:12px;color:var(--faint)" }, "Footer"),
            })}
            {Card({
              title: "Interactive card",
              label: "Interactive card",
              onClick: () => clicks.update((n) => n + 1),
              children: R.div({ style: "font-size:14px" }, ["Clicked ", R.b({}, () => String(clicks())), " times — try Enter too."]),
            })}
          </div>
        );
      },
    },
    {
      slug: "stat",
      name: "Stat",
      tier: "T2",
      summary:
        "A number with its change. `invertDelta` exists because growth is not always good — for churn or latency, up is the bad direction.",
      code: `Stat({ label: "Requests", value: () => count(), delta: 12.5 });
Stat({ label: "Churn", value: "3.1%", delta: 0.6, invertDelta: true });`,
      demo: () => {
        const count = state(1284);
        return (
          <div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
              {Stat({ label: "Requests", value: () => count().toLocaleString("en-GB"), delta: 12.5 })}
              {Stat({ label: "p95 latency", value: "84 ms", delta: -6.2, hint: "vs last week" })}
              {Stat({ label: "Churn", value: "3.1%", delta: 0.6, invertDelta: true })}
            </div>
            <div class="cmp-row" style="margin-top:12px">
              {Button({ children: "Simulate traffic", size: "sm", onClick: () => count.update((n) => n + Math.round(Math.random() * 400)) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "badge",
      name: "Badge",
      tier: "T1",
      summary: "A count or a dot. Past `max` it shows 99+, at zero it hides itself, and `label` gives it a name so “3” means something out loud.",
      code: `Badge({ count: () => unread(), max: 99, label: "unread messages" });
Badge({ dot: true, tone: "danger" });`,
      demo: () => {
        const unread = state(3);
        return (
          <div>
            <div class="cmp-row">
              {Badge({ count: () => unread(), max: 99, tone: "accent", label: "unread messages" })}
              {Badge({ children: "beta", tone: "warning" })}
              {Badge({ children: "stable", tone: "success" })}
              {Badge({ dot: true, tone: "danger", label: "offline" })}
            </div>
            <div class="cmp-row">
              {Button({ children: "+1", size: "sm", onClick: () => unread.update((n) => n + 1) })}
              {Button({ children: "+100", size: "sm", onClick: () => unread.update((n) => n + 100) })}
              {Button({ children: "Clear", size: "sm", onClick: () => unread.set(0) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "tag",
      name: "Tag",
      tier: "T1",
      summary: "A label, optionally removable. The ✕ gets its own accessible name, because “remove” alone tells you nothing.",
      code: `Tag({ children: "signals", onRemove: () => drop("signals"), removeLabel: "Remove signals" });`,
      demo: () => {
        const tags = state<readonly string[]>(["signals", "wire", "compiler", "ssr"]);
        return (
          <div>
            <div class="cmp-row">
              {() =>
                tags().map((t) =>
                  Tag({
                    children: t,
                    tone: "accent",
                    removeLabel: "Remove " + t,
                    onRemove: () => tags.update((xs) => xs.filter((x) => x !== t)),
                  }),
                )
              }
            </div>
            <div class="cmp-row">
              {Button({ children: "Reset", size: "sm", onClick: () => tags.set(["signals", "wire", "compiler", "ssr"]) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "avatar",
      name: "Avatar",
      tier: "T1",
      summary: "An image with initials as the fallback — and the fallback is used on a load error too, not only when there is no URL.",
      code: `Avatar({ name: "Ana Petrescu", src: user.photo, size: "md" });`,
      demo: () => (
        <div class="cmp-row">
          {Avatar({ name: "Ana Petrescu", size: "xs" })}
          {Avatar({ name: "Bogdan Ilie", size: "sm" })}
          {Avatar({ name: "Carmen Dobre", size: "md" })}
          {Avatar({ name: "Dan Marin", size: "lg", square: true })}
          {Avatar({ name: "Broken image", src: BROKEN_IMAGE, size: "lg" })}
        </div>
      ),
      notes: ["The last one points at a URL that cannot load — it falls back to initials."],
    },
    {
      slug: "avatar-group",
      name: "AvatarGroup",
      tier: "T2",
      summary: "Overlapping avatars with a +N overflow, for “who is on this” rows.",
      code: `AvatarGroup({ people: members, max: 4 });`,
      demo: () =>
        AvatarGroup({
          max: 4,
          people: [
            { name: "Ana Petrescu" },
            { name: "Bogdan Ilie" },
            { name: "Carmen Dobre" },
            { name: "Dan Marin" },
            { name: "Elena Toma" },
            { name: "Florin Radu" },
          ],
        }),
    },
    {
      slug: "timeline",
      name: "Timeline",
      tier: "T2",
      summary: "Events down a line, each with a tone and a time — deploys, audit trails, an order's history.",
      code: `Timeline({ items: [{ title: "Deployed", time: "10:24", tone: "success" }] });`,
      demo: () =>
        Timeline({
          items: [
            { title: "Pushed 3 commits", time: "09:02", description: "branch wire/resync" },
            { title: "Tests green", time: "09:06", tone: "success", description: "149 passing" },
            { title: "Deploy failed", time: "09:11", tone: "danger", description: "Timeout reaching the registry" },
            { title: "Retried and deployed", time: "09:18", tone: "success" },
          ],
        }),
    },
    {
      slug: "accordion",
      name: "Accordion",
      tier: "T1",
      summary:
        "Expandable sections, one at a time (`single`) or many (`multiple`). `unmount` decides whether a closed panel keeps its DOM and its state.",
      code: `Accordion({ sections, mode: "single", initial: ["what"] });`,
      demo: () =>
        Accordion({
          mode: "single",
          initial: ["what"],
          sections: [
            { key: "what", title: "What is a signal?", content: R.div({ style: "font-size:14px" }, "A value you call to read, and that remembers who read it.") },
            { key: "why", title: "Why no virtual DOM?", content: R.div({ style: "font-size:14px" }, "Because the graph already knows what changed; diffing re-discovers it.") },
            { key: "when", title: "When would I not use this?", content: R.div({ style: "font-size:14px" }, "When you need an ecosystem today — this stack is young on purpose.") },
          ],
        }),
    },
    {
      slug: "collapsible",
      name: "Collapsible",
      tier: "T1",
      summary: "One foldable region with a button that reports `aria-expanded`. The building block Accordion is made of.",
      code: `Collapsible({ trigger: "Advanced options", children: options });`,
      demo: () =>
        Collapsible({
          trigger: "Advanced options",
          children: R.div({ style: "font-size:14px;padding-top:8px" }, "Hidden until you ask for it, and announced correctly when you do."),
        }),
    },
    {
      slug: "carousel",
      name: "Carousel",
      tier: "T3",
      summary: "Slides with dots, arrows, optional looping and autoplay that stops as soon as someone interacts.",
      code: `Carousel({ slides, autoplay: 4000, loop: true });`,
      demo: () =>
        Carousel({
          loop: true,
          label: "Demo carousel",
          slides: ["One", "Two", "Three"].map((t, i) =>
            R.div(
              {
                style:
                  "height:140px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-family:var(--mono);color:var(--accent);background:" +
                  ["#eaf0f7", "#f1f9f4", "#fdf6e9"][i],
              },
              t,
            ),
          ),
        }),
    },
    {
      slug: "kanban",
      name: "Kanban",
      tier: "T3",
      thesis:
        "Moving a card moves one node. The `For` over each column is keyed, so the card that travels is re-parented, not recreated — its DOM, and anything focused inside it, survives the move.",
      summary: "Columns with draggable cards, WIP limits, and a keyboard path for moving a card without a pointer.",
      code: `Kanban({ columns, cards, onMove: (card, from, to, index) => persist(card, to, index) });`,
      demo: () => {
        const cards = state<Readonly<Record<string, readonly KanbanCard[]>>>({
          todo: [
            { key: "a", title: "Design the wire frame format", badge: "spec" },
            { key: "b", title: "Write the codec tests" },
          ],
          doing: [{ key: "c", title: "Delta resync", description: "Resume without a full resend" }],
          done: [{ key: "d", title: "Address book" }],
        });
        const moves = state(0);
        return (
          <div>
            {Kanban({
              cards,
              onMove: () => moves.update((n) => n + 1),
              columns: [
                { key: "todo", title: "To do" },
                { key: "doing", title: "In progress", limit: 2 },
                { key: "done", title: "Done" },
              ],
            })}
            <div class="cmp-row" style="margin-top:12px">
              <span class="chip">
                moves: <b>{moves}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "json-viewer",
      name: "JsonViewer",
      tier: "T3",
      summary:
        "An expandable view of any value, with large collections collapsed by default so pasting a 5 MB response does not build 200 000 nodes.",
      code: `JsonViewer({ data: () => response(), defaultDepth: 1 });`,
      demo: () =>
        JsonViewer({
          defaultDepth: 2,
          data: {
            protocol: "raptorwire/0.2",
            frame: { type: "delta", ops: [{ op: "SET", address: 6305, value: 42 }, { op: "INC", address: 6306, value: 1 }] },
            addressBook: { "user.count": 6305, "user.visits": 6306 },
            stats: { bytes: 18, rebuilt: false },
          },
        }),
    },
    {
      slug: "diff-viewer",
      name: "DiffViewer",
      tier: "T3",
      summary: "A line diff, unified or side by side, with a context window. The diff itself (`diffLines`) is exported and pure.",
      code: `DiffViewer({ oldText, newText, mode: "split", context: 3 });`,
      demo: () => DiffViewer({ oldText: OLD_TEXT, newText: NEW_TEXT, mode: "unified", oldLabel: "before", newLabel: "after" }),
    },
    {
      slug: "image",
      name: "Image",
      tier: "T2",
      summary: "Lazy loading, a skeleton while it arrives, a fallback if it never does, and a reserved box so the page does not jump.",
      code: `Image({ src: photo, alt: "", ratio: 16 / 9, lazy: true });`,
      demo: () => (
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:440px">
          {Image({ src: SAMPLE_IMAGES[0]!.src, alt: SAMPLE_IMAGES[0]!.alt, ratio: 16 / 9, lazy: true })}
          {Image({ src: BROKEN_IMAGE, alt: "Deliberately broken", ratio: 16 / 9, fallback: "could not load" })}
        </div>
      ),
    },
    {
      slug: "gallery",
      name: "Gallery",
      tier: "T3",
      summary: "A grid of thumbnails that opens the lightbox on click, with arrow keys moving between images.",
      code: `Gallery({ images, columns: 4 });`,
      demo: () => Gallery({ images: SAMPLE_IMAGES, columns: 4, label: "Demo gallery" }),
    },
    {
      slug: "empty-state",
      name: "EmptyState",
      tier: "T2",
      summary: "The screen that says why there is nothing here and what to do about it — an empty list without one is a dead end.",
      code: `EmptyState({ title: "No projects yet", description: "…", action: Button({ children: "New project" }) });`,
      demo: () =>
        EmptyState({
          icon: "◇",
          title: "No projects yet",
          description: "Projects you create or are invited to will show up here.",
          action: Button({ children: "New project", variant: "primary" }),
        }),
    },
    {
      slug: "comparison-table",
      name: "ComparisonTable",
      tier: "T3",
      summary: "Plans across the top, features down the side, one column marked as the recommended one. Pricing pages, mostly.",
      code: `ComparisonTable({ features, plans });`,
      demo: () =>
        ComparisonTable({
          features: [
            { key: "signals", label: "Fine-grained signals" },
            { key: "wire", label: "Binary wire protocol" },
            { key: "ssr", label: "SSR + resume" },
            { key: "support", label: "Support", hint: "Response time" },
          ],
          plans: [
            { key: "oss", label: "Open source", values: { signals: true, wire: true, ssr: true, support: "Community" } },
            { key: "team", label: "Team", featured: true, badge: "Popular", values: { signals: true, wire: true, ssr: true, support: "1 business day" } },
            { key: "ent", label: "Enterprise", values: { signals: true, wire: true, ssr: true, support: "1 hour" } },
          ],
        }),
    },
  ],
};
