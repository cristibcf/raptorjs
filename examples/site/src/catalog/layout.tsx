/** Layout and structure. */
import { state } from "raptorjs/dom";
import { Button } from "raptorjs/ui/button";
import { AspectRatio, Box, Center, Container, Divider, Flex, Grid, Group, ScrollArea, SimpleGrid, Spacer, Stack } from "raptorjs/ui/layout";
import { Affix, Masonry, SafeArea } from "raptorjs/ui/layout-extra";
import { AppShell, Sidebar } from "raptorjs/ui/navigation";
import { SplitPane } from "raptorjs/ui/split-pane";
import type { CatalogGroup } from "./types.ts";

/** A visible block, so the layout itself is what you see. */
function tile(label: string, tone = "var(--accent-soft)") {
  return (
    <div
      style={
        "background:" +
        tone +
        ";border:1px solid var(--accent-soft-border);border-radius:6px;padding:12px 14px;" +
        "font-family:var(--mono);font-size:12px;color:var(--accent);text-align:center"
      }
    >
      {label}
    </div>
  );
}

export const LAYOUT: CatalogGroup = {
  slug: "layout",
  title: "Layout & structure",
  blurb: "The boxes everything else sits in. Spacing is a scale, not a free-form number.",
  items: [
    {
      slug: "box",
      name: "Box",
      tier: "T1",
      summary:
        "The style primitive. Padding and margin take a step on the spacing scale (0–8 → 0, 2, 4, 8, 12, 16, 24, 32, 48px), so spacing stays consistent across an app.",
      code: `Box({ padding: 5, as: "section", children: "16px of padding" });`,
      props: [
        { name: "as", type: "string", desc: "Tag name. Default div — use section, aside, nav…" },
        { name: "padding / paddingX / paddingY", type: "Space (0–8)", desc: "A step on the scale, not raw pixels." },
        { name: "margin", type: "Space (0–8)", desc: "Outer spacing, same scale." },
        { name: "width / height", type: "string", desc: "Raw CSS when you need it." },
        { name: "attrs", type: "Record<string, unknown>", desc: "Attributes put straight on the element (id, aria-*, on:click)." },
      ],
      demo: () => (
        <div class="cmp-row" style="align-items:flex-start">
          {Box({ padding: 3, class: "cmp-panel", children: tile("padding 3 → 4px") })}
          {Box({ padding: 5, class: "cmp-panel", children: tile("padding 5 → 16px") })}
          {Box({ padding: 7, class: "cmp-panel", children: tile("padding 7 → 32px") })}
        </div>
      ),
    },
    {
      slug: "flex",
      name: "Flex",
      tier: "T1",
      summary: "A flexbox container with named alignment, so `justify: \"between\"` beats remembering `space-between`.",
      code: `Flex({ gap: 4, justify: "between", align: "center", children: [a, b, c] });`,
      props: [
        { name: "direction", type: `"row" | "column"`, desc: "Main axis." },
        { name: "gap", type: "Space (0–8)", desc: "Gap between children." },
        { name: "align", type: `"start" | "center" | "end" | "stretch" | "baseline"`, desc: "Cross-axis alignment." },
        { name: "justify", type: `"start" | "center" | "end" | "between" | "around" | "evenly"`, desc: "Main-axis distribution." },
        { name: "wrap", type: "boolean", desc: "Allow wrapping." },
      ],
      demo: () =>
        Flex({
          gap: 4,
          justify: "between",
          align: "center",
          class: "cmp-panel",
          children: [tile("left"), tile("center"), tile("right")],
        }),
    },
    {
      slug: "stack",
      name: "Stack",
      tier: "T1",
      summary: "A one-direction Flex: vertical by default, horizontal on request. The gap is the only spacing decision you make.",
      code: `Stack({ gap: 4, children: [a, b, c] });
Stack({ orientation: "horizontal", gap: 3, children: [a, b] });`,
      demo: () => (
        <div class="cmp-row" style="align-items:stretch">
          {Stack({ gap: 3, class: "cmp-panel", children: [tile("one"), tile("two"), tile("three")] })}
          {Stack({
            orientation: "horizontal",
            gap: 3,
            class: "cmp-panel",
            children: [tile("one"), tile("two"), tile("three")],
          })}
        </div>
      ),
    },
    {
      slug: "group",
      name: "Group",
      tier: "T2",
      summary: "A horizontal Stack with a shorter name — for rows of buttons, tags or fields.",
      code: `Group({ gap: 3, children: [Button({ children: "Cancel" }), Button({ children: "Save", variant: "primary" })] });`,
      demo: () =>
        Group({
          gap: 3,
          class: "cmp-panel",
          children: [Button({ children: "Cancel" }), Button({ children: "Save", variant: "primary" })],
        }),
    },
    {
      slug: "grid",
      name: "Grid",
      tier: "T1",
      summary: "CSS grid with a column count or a full template, plus the same spacing scale.",
      code: `Grid({ columns: 3, gap: 4, children: cells });
Grid({ columns: "2fr 1fr", gap: 4, children: [main, aside] });`,
      props: [
        { name: "columns", type: "number | string", desc: "Equal columns, or a grid-template-columns string." },
        { name: "rows", type: "number | string", desc: "Same, for rows." },
        { name: "gap / columnGap / rowGap", type: "Space (0–8)", desc: "Gutters." },
      ],
      demo: () => (
        <div>
          {Grid({
            columns: 3,
            gap: 4,
            class: "cmp-panel",
            children: [tile("1"), tile("2"), tile("3"), tile("4"), tile("5"), tile("6")],
          })}
          <div style="height:12px"></div>
          {Grid({ columns: "2fr 1fr", gap: 4, class: "cmp-panel", children: [tile("2fr"), tile("1fr")] })}
        </div>
      ),
    },
    {
      slug: "simple-grid",
      name: "SimpleGrid",
      tier: "T2",
      summary: "Responsive without breakpoints: you give a minimum column width and the column count follows the container.",
      code: `SimpleGrid({ minColumnWidth: "160px", gap: 4, children: cards });`,
      demo: () =>
        SimpleGrid({
          minColumnWidth: "140px",
          gap: 4,
          class: "cmp-panel",
          children: [tile("auto"), tile("auto"), tile("auto"), tile("auto"), tile("auto")],
        }),
      notes: ["Resize this window — the columns re-flow with no media query and no JavaScript."],
    },
    {
      slug: "container",
      name: "Container",
      tier: "T1",
      summary: "Caps the content width and keeps a gutter on small screens. The outermost box of most pages.",
      code: `Container({ maxWidth: "720px", children: page });`,
      demo: () => (
        <div style="background:var(--sunken);border-radius:8px">
          {Container({ maxWidth: "320px", children: tile("maxWidth 320px, centred"), padding: 4 })}
        </div>
      ),
    },
    {
      slug: "center",
      name: "Center",
      tier: "T2",
      summary: "Centres on both axes. With `fullHeight` it takes the height it is given — the empty-state and spinner wrapper.",
      code: `Center({ fullHeight: true, children: Spinner({}) });`,
      demo: () => (
        <div class="cmp-panel" style="height:120px">
          {Center({ fullHeight: true, children: tile("dead centre") })}
        </div>
      ),
    },
    {
      slug: "spacer",
      name: "Spacer",
      tier: "T2",
      summary: "Eats the free space in a flex row, pushing what follows to the far end. With `size` it becomes a fixed gap instead.",
      code: `Flex({ align: "center", children: [logo, Spacer(), Button({ children: "Sign in" })] });`,
      demo: () =>
        Flex({
          align: "center",
          class: "cmp-panel",
          children: [tile("logo"), Spacer(), Button({ children: "Sign in", size: "sm" })],
        }),
    },
    {
      slug: "divider",
      name: "Divider",
      tier: "T1",
      summary: "A rule between sections, horizontal or vertical, optionally with a label in the middle.",
      code: `Divider({});
Divider({ label: "or" });
Divider({ orientation: "vertical" });`,
      demo: () => (
        <div class="cmp-panel">
          {tile("above")}
          {Divider({})}
          {tile("below")}
          {Divider({ label: "or" })}
          <div style="display:flex;align-items:center;height:48px">
            {tile("left")}
            {Divider({ orientation: "vertical" })}
            {tile("right")}
          </div>
        </div>
      ),
    },
    {
      slug: "aspect-ratio",
      name: "AspectRatio",
      tier: "T2",
      summary: "Holds a fixed width/height ratio — so an embed or an image reserves its space before it loads and the page never jumps.",
      code: `AspectRatio({ ratio: 16 / 9, children: video });`,
      demo: () => (
        <div style="max-width:320px">
          {AspectRatio({
            ratio: 16 / 9,
            children: (
              <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--accent-soft);border:1px solid var(--accent-soft-border);border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--accent)">
                16 / 9
              </div>
            ),
          })}
        </div>
      ),
    },
    {
      slug: "scroll-area",
      name: "ScrollArea",
      tier: "T2",
      summary: "A scroll box with a thin, consistent scrollbar and an axis you choose.",
      code: `ScrollArea({ maxHeight: "140px", children: longList });`,
      demo: () =>
        ScrollArea({
          maxHeight: "140px",
          class: "cmp-panel",
          children: Array.from({ length: 12 }, (_, i) => (
            <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:14px">Row {String(i + 1)}</div>
          )),
        }),
    },
    {
      slug: "split-pane",
      name: "SplitPane",
      tier: "T1",
      thesis:
        "Dragging the handle writes one style string per frame onto one element. There is no tree to reconcile, so a split that holds a whole editor costs the same as a split that holds two words.",
      summary:
        "Two panes with a draggable handle. Arrow keys move it too, double-click collapses it, and `persist` remembers the size across sessions.",
      code: `SplitPane({
  first: leftPane,
  second: rightPane,
  initial: 220,
  min: 120,
  max: 420,
  collapsible: true,
  persist: "editor-split",
});`,
      props: [
        { name: "first / second", type: "Child", desc: "The two panes." },
        { name: "initial", type: "number", desc: "Starting size of the first pane, in px." },
        { name: "min / max / step", type: "number", desc: "Bounds and quantisation for drag and arrow keys." },
        { name: "persist", type: "string", desc: "localStorage key; the size survives a reload." },
        { name: "collapsible", type: "boolean", desc: "Double-click the handle to collapse the first pane." },
      ],
      demo: () => (
        <div class="cmp-panel" style="height:180px;padding:0;overflow:hidden">
          {SplitPane({
            first: <div style="padding:14px;font-size:14px">Drag the handle →<br />or focus it and use ← →</div>,
            second: <div style="padding:14px;font-size:14px">Second pane</div>,
            initial: 180,
            min: 90,
            max: 360,
            collapsible: true,
            label: "Demo split",
          })}
        </div>
      ),
    },
    {
      slug: "sidebar",
      name: "Sidebar",
      tier: "T2",
      summary:
        "A side panel that is docked on wide screens and slides over the content on narrow ones. Below the breakpoint it is hidden from screen readers while closed.",
      code: `const open = state(true);
Sidebar({ open, width: "220px", children: nav });`,
      demo: () => {
        const open = state(true);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Toggle", size: "sm", onClick: () => open.update((v) => !v) })}
              <span class="chip">
                open = <b>{() => String(open())}</b>
              </span>
            </div>
            <div class="cmp-panel" style="display:flex;gap:12px;padding:0;overflow:hidden;height:130px">
              {Sidebar({
                open,
                breakpoint: 1,
                width: "170px",
                children: (
                  <div style="padding:12px;background:var(--soft);height:100%;font-size:14px">
                    <div style="font-family:var(--mono);font-size:11px;color:var(--faint);margin-bottom:8px">NAV</div>
                    <div>Overview</div>
                    <div>Reports</div>
                    <div>Settings</div>
                  </div>
                ),
              })}
              <div style="padding:12px;font-size:14px">Content keeps its place; the panel animates its width.</div>
            </div>
          </div>
        );
      },
      notes: [
        "The demo pins `breakpoint: 1` so the panel stays docked inside this page. In an app you leave the default (1024px) and it becomes an overlay on phones.",
      ],
    },
    {
      slug: "app-shell",
      name: "AppShell",
      tier: "T2",
      summary: "Header, sidebar, content, footer — the skeleton of an application, with the content in a real `<main>` that a skip link can target.",
      code: `AppShell({
  header: topBar,
  sidebar: nav,
  footer: status,
  sidebarWidth: "220px",
  children: page,
});`,
      demo: () => (
        <div class="cmp-panel" style="padding:0;overflow:hidden">
          {AppShell({
            sidebarWidth: "150px",
            header: (
              <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-weight:600;font-size:14px">
                Header
              </div>
            ),
            sidebar: (
              <div style="padding:12px;border-right:1px solid var(--border);font-size:14px;height:100%;background:var(--soft)">
                Sidebar
              </div>
            ),
            children: <div style="padding:16px;font-size:14px">Main content</div>,
            footer: (
              <div style="padding:8px 14px;border-top:1px solid var(--border);font-family:var(--mono);font-size:11px;color:var(--faint)">
                Footer
              </div>
            ),
          })}
        </div>
      ),
    },
    {
      slug: "masonry",
      name: "Masonry",
      tier: "T3",
      summary:
        "Columns of unequal height, filled shortest-first — for cards whose height depends on their content and would leave holes in a grid.",
      code: `Masonry({ items: cards, columns: 3, gap: 4 });`,
      demo: () =>
        Masonry({
          columns: 3,
          gap: 4,
          items: [90, 140, 70, 110, 60, 130, 80].map((h, i) => (
            <div
              style={
                "height:" +
                h +
                "px;border-radius:8px;background:var(--accent-soft);border:1px solid var(--accent-soft-border);" +
                "display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;color:var(--accent)"
              }
            >
              {String(h)}px
            </div>
          )),
        }),
    },
    {
      slug: "affix",
      name: "Affix",
      tier: "T3",
      summary:
        "Sticks its content to the top (or bottom) once you scroll past it, and reserves the space it leaves so the page does not jump when it detaches.",
      code: `Affix({ offsetTop: 72, children: toolbar, onChange: (stuck) => shadow.set(stuck) });`,
      demo: () => {
        const stuck = state(false);
        return (
          <div>
            <div class="cmp-panel" style="height:180px;overflow:auto;padding:12px">
              <div style="height:90px;font-size:13px;color:var(--muted)">scroll down inside this box ↓</div>
              {Affix({
                offsetTop: 0,
                onChange: (v: boolean) => stuck.set(v),
                children: (
                  <div style="background:var(--accent);color:#fff;border-radius:8px;padding:8px 12px;font-size:13px">
                    I stick to the top
                  </div>
                ),
              })}
              <div style="height:300px"></div>
            </div>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                affixed = <b>{() => String(stuck())}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "safe-area",
      name: "SafeArea",
      tier: "T3",
      summary:
        "Padding from the device's safe-area insets, so content clears a notch or a home indicator. On a desktop the insets are zero and only `minimum` applies.",
      code: `SafeArea({ edges: ["bottom"], minimum: 4, children: bottomBar });`,
      demo: () =>
        SafeArea({
          minimum: 5,
          children: <div class="cmp-panel" style="font-size:14px">Padded by the safe-area insets, or by the minimum when there are none.</div>,
        }),
    },
  ],
};
