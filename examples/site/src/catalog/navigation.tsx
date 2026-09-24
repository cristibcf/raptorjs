/** Navigation. */
import { state, R } from "@raptor/dom";
import { Menubar } from "@raptor/ui/advanced";
import { Button } from "@raptor/ui/button";
import { type Command, CommandPalette } from "@raptor/ui/data-views";
import { BottomNavigation, Dock, SkipNav } from "@raptor/ui/layout-extra";
import { menuItem, menuSeparator } from "@raptor/ui/menu";
import { Anchor, Breadcrumbs, type NavItem, Navbar, NavigationMenu, Pagination, SidebarNav, Stepper } from "@raptor/ui/navigation";
import { Tabs } from "@raptor/ui/tabs";
import type { CatalogGroup } from "./types.ts";

/** Fixed-position components are contained by a transformed ancestor. */
function frame(height: string, children: any) {
  return (
    <div
      class="cmp-panel"
      style={"position:relative;transform:translate(0);overflow:hidden;padding:0;height:" + height}
    >
      {children}
    </div>
  );
}

export const NAVIGATION: CatalogGroup = {
  slug: "navigation",
  title: "Navigation",
  blurb: "Moving between places, and showing where you are. Every one of these is keyboard-complete.",
  items: [
    {
      slug: "tabs",
      name: "Tabs",
      tier: "T1",
      summary:
        "Tabs with the full keyboard contract: arrows move, Home/End jump, and `activation: \"manual\"` (the default) waits for Enter so arrowing through does not load every panel.",
      code: `Tabs({
  tabs: [
    { key: "code", label: "Code", content: () => codePanel() },
    { key: "tests", label: "Tests", content: () => testsPanel() },
  ],
  lazy: true,
});`,
      props: [
        { name: "tabs", type: "readonly Tab[]", desc: "key, label, content (a node or a function), disabled." },
        { name: "active", type: "State<string>", desc: "Control the selection from outside." },
        { name: "activation", type: `"manual" | "automatic"`, desc: "Whether arrowing changes the panel or only the focus." },
        { name: "lazy", type: "boolean", desc: "Build a panel the first time it is shown, then keep it mounted." },
        { name: "orientation", type: `"horizontal" | "vertical"`, desc: "Tab strip direction." },
      ],
      demo: () => {
        const active = state("overview");
        return (
          <div>
            {Tabs({
              active,
              label: "Demo tabs",
              tabs: [
                { key: "overview", label: "Overview", content: <div style="padding:12px 2px;font-size:14px">The first panel.</div> },
                { key: "usage", label: "Usage", content: <div style="padding:12px 2px;font-size:14px">The second panel.</div> },
                { key: "api", label: "API", content: <div style="padding:12px 2px;font-size:14px">The third panel.</div> },
                { key: "legacy", label: "Legacy", disabled: true, content: "" },
              ],
            })}
            <div class="cmp-row" style="margin-top:8px">
              <span class="chip">
                active = <b>{active}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "breadcrumbs",
      name: "Breadcrumbs",
      tier: "T2",
      summary: "The trail back up. Past `maxItems` the middle collapses into an ellipsis instead of wrapping onto a second line.",
      code: `Breadcrumbs({ items: [{ label: "Docs", onClick: go }, { label: "Components" }], maxItems: 4 });`,
      demo: () => {
        const last = state("—");
        return (
          <div>
            {Breadcrumbs({
              maxItems: 4,
              items: [
                { label: "Home", onClick: () => last.set("Home") },
                { label: "Docs", onClick: () => last.set("Docs") },
                { label: "Packages", onClick: () => last.set("Packages") },
                { label: "UI", onClick: () => last.set("UI") },
                { label: "Breadcrumbs" },
              ],
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                clicked: <b>{last}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "pagination",
      name: "Pagination",
      tier: "T1",
      summary: "Page numbers with the ellipsis logic worked out once — `paginationRange` is exported, so you can reuse it without the markup.",
      code: `const page = state(1);
Pagination({ page, pageCount: 12, siblings: 1 });`,
      demo: () => {
        const page = state(4);
        return (
          <div>
            {Pagination({ page, pageCount: 12, label: "Results" })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                page <b>{page}</b> of 12
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "stepper",
      name: "Stepper",
      tier: "T2",
      summary: "Where you are in a sequence: done, current, upcoming, or failed. `clickable` lets people go back to a finished step.",
      code: `Stepper({ steps, current, clickable: true });`,
      demo: () => {
        const current = state(1);
        return (
          <div>
            {Stepper({
              current,
              clickable: true,
              steps: [
                { key: "cart", label: "Cart" },
                { key: "address", label: "Address", description: "Where it goes" },
                { key: "pay", label: "Payment" },
                { key: "done", label: "Done" },
              ],
            })}
            <div class="cmp-row" style="margin-top:12px">
              {Button({ children: "Back", size: "sm", onClick: () => current.update((n) => Math.max(0, n - 1)) })}
              {Button({ children: "Next", size: "sm", variant: "primary", onClick: () => current.update((n) => Math.min(3, n + 1)) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "anchor",
      name: "Anchor",
      tier: "T2",
      summary:
        "A table of contents with scroll-spy: it watches the real headings and highlights the one you are reading. Exactly the widget on the right of this site's Learn pages.",
      code: `Anchor({ items: [{ id: "install", label: "Install" }, { id: "usage", label: "Usage", level: 2 }] });`,
      demo: () =>
        Anchor({
          items: [
            { id: "demo", label: "Live" },
            { id: "props", label: "Props" },
            { id: "notes", label: "Notes" },
          ],
          label: "On this page",
        }),
      notes: ["The demo points at this very page's headings — click an entry and the page scrolls."],
    },
    {
      slug: "sidebar-nav",
      name: "SidebarNav",
      tier: "T2",
      summary: "Grouped navigation with optional nesting, icons and badges, and one active key that you own.",
      code: `SidebarNav({ groups, active: () => current(), onNavigate: (item) => go(item.key) });`,
      demo: () => {
        const active = state("signals");
        return (
          <div style="max-width:260px">
            {SidebarNav({
              active: () => active(),
              onNavigate: (item: NavItem) => active.set(item.key),
              groups: [
                {
                  title: "Getting started",
                  items: [
                    { key: "install", label: "Install" },
                    { key: "signals", label: "Signals", badge: "new" },
                  ],
                },
                {
                  title: "Guides",
                  items: [
                    {
                      key: "wire",
                      label: "RaptorWire",
                      children: [
                        { key: "wire-ops", label: "Operations" },
                        { key: "wire-ras", label: "Address space" },
                      ],
                    },
                    { key: "build", label: "Build" },
                  ],
                },
              ],
            })}
          </div>
        );
      },
    },
    {
      slug: "navbar",
      name: "Navbar",
      tier: "T2",
      summary: "A top bar that folds its links into a menu below a breakpoint — the responsive bit you would otherwise rewrite in every project.",
      code: `Navbar({ brand, actions, breakpoint: 768, children: links });`,
      demo: () =>
        frame(
          "76px",
          Navbar({
            brand: <b style="font-size:15px">raptor</b>,
            breakpoint: 1,
            children: (
              <div class="cmp-row" style="margin:0;font-size:14px">
                <span>Docs</span>
                <span>Learn</span>
                <span>Blog</span>
              </div>
            ),
            actions: Button({ children: "Sign in", size: "sm", variant: "primary" }),
          }),
        ),
      notes: ["The demo pins the breakpoint so the bar stays expanded inside the page; in an app you leave the default 768px."],
    },
    {
      slug: "navigation-menu",
      name: "NavigationMenu",
      tier: "T2",
      summary: "A horizontal menu whose entries can open a panel of sub-links — the marketing-site nav, with the keyboard handling done.",
      code: `NavigationMenu({ entries: [{ key: "products", label: "Products", items: [...] }] });`,
      demo: () => {
        const picked = state("—");
        return NavigationMenu({
          onNavigate: (item: any) => picked.set(String(item.key)),
          entries: [
            {
              key: "products",
              label: "Products",
              items: [
                { key: "runtime", label: "Runtime" },
                { key: "wire", label: "Wire" },
                { key: "engine", label: "Engine" },
              ],
            },
            { key: "pricing", label: "Pricing" },
            {
              key: "learn",
              label: "Learn",
              items: [
                { key: "tutorial", label: "Tutorial" },
                { key: "examples", label: "Examples" },
              ],
            },
          ],
        });
      },
    },
    {
      slug: "menubar",
      name: "Menubar",
      tier: "T3",
      summary:
        "A desktop-style menu bar: once one menu is open, moving sideways opens the next without clicking — the behaviour people expect from File / Edit / View.",
      code: `Menubar({ menus: [{ key: "file", label: "File", entries: [menuItem("New", onNew)] }] });`,
      demo: () => {
        const last = state("—");
        const pick = (what: string) => () => last.set(what);
        return (
          <div>
            {Menubar({
              menus: [
                {
                  key: "file",
                  label: "File",
                  entries: [
                    menuItem("New", pick("New"), { hint: "Ctrl+N" }),
                    menuItem("Open…", pick("Open")),
                    menuSeparator(),
                    menuItem("Save", pick("Save"), { hint: "Ctrl+S" }),
                  ],
                },
                {
                  key: "edit",
                  label: "Edit",
                  entries: [menuItem("Undo", pick("Undo")), menuItem("Redo", pick("Redo"), { disabled: true })],
                },
                { key: "view", label: "View", entries: [menuItem("Zoom in", pick("Zoom in"))] },
              ],
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                chose: <b>{last}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "command-palette",
      name: "CommandPalette",
      tier: "T2",
      thesis:
        "Typing filters a list of hundreds of commands by rebinding rows, not by rebuilding the overlay. The input keeps focus and its value because nothing around it is re-created.",
      summary: "Ctrl/Cmd+K, type, Enter. Commands can be grouped, carry a hint, and be filtered by your own matcher.",
      code: `CommandPalette({
  commands: [
    { key: "new", label: "New document", group: "File", hint: "Ctrl+N", run: newDoc },
    { key: "theme", label: "Toggle theme", group: "View", run: toggleTheme },
  ],
});`,
      demo: () => {
        const open = state(false);
        const last = state("—");
        const commands: Command[] = [
          { key: "new", label: "New document", group: "File", hint: "Ctrl+N", run: () => last.set("New document") },
          { key: "open", label: "Open file…", group: "File", run: () => last.set("Open file") },
          { key: "theme", label: "Toggle theme", group: "View", run: () => last.set("Toggle theme") },
          { key: "split", label: "Split editor", group: "View", run: () => last.set("Split editor") },
          { key: "deploy", label: "Deploy to production", group: "Actions", run: () => last.set("Deploy") },
        ];
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Open palette", variant: "primary", onClick: () => open.set(true) })}
              <span class="chip">or press Ctrl / Cmd + K</span>
              <span class="chip">
                ran: <b>{last}</b>
              </span>
            </div>
            {CommandPalette({ commands, open, placeholder: "Type a command…" })}
          </div>
        );
      },
    },
    {
      slug: "bottom-navigation",
      name: "BottomNavigation",
      tier: "T3",
      summary: "The phone-sized navigation bar: it renders only below its breakpoint, so it costs nothing on a desktop.",
      code: `BottomNavigation({ items, active: () => tab(), onSelect: tab.set });`,
      demo: () => {
        const tab = state("home");
        return frame(
          "92px",
          BottomNavigation({
            breakpoint: 99999,
            active: () => tab(),
            onSelect: (k: string) => tab.set(k),
            items: [
              { key: "home", label: "Home", icon: "⌂" },
              { key: "search", label: "Search", icon: "⌕" },
              { key: "alerts", label: "Alerts", icon: "◔", badge: "3" },
              { key: "me", label: "Profile", icon: "☺" },
            ],
          }),
        );
      },
      notes: ["The demo raises the breakpoint so you can see it on a desktop; by default it appears under 768px."],
    },
    {
      slug: "dock",
      name: "Dock",
      tier: "T3",
      summary: "A floating strip of icon actions. Every button has a name, because an icon alone is not one.",
      code: `Dock({ items: [{ key: "zoom", label: "Zoom in", icon: "+", onClick: zoomIn }] });`,
      demo: () => {
        const bold = state(false);
        return frame(
          "110px",
          Dock({
            items: [
              { key: "bold", label: "Bold", icon: "B", active: () => bold(), onClick: () => bold.update((v) => !v) },
              { key: "zoom-in", label: "Zoom in", icon: "＋", onClick: () => {} },
              { key: "zoom-out", label: "Zoom out", icon: "－", onClick: () => {} },
              { key: "share", label: "Share", icon: "↗", onClick: () => {} },
            ],
          }),
        );
      },
    },
    {
      slug: "skip-nav",
      name: "SkipNav",
      tier: "T3",
      summary:
        "The link that is invisible until it is focused, letting a keyboard user jump past the navigation. By default it targets the `<main>` that AppShell renders.",
      code: `SkipNav({ target: "rui-main", children: "Skip to content" });`,
      demo: () => (
        <div>
          {SkipNav({ target: "app", children: "Skip to content" })}
          <div class="cmp-row" style="margin-top:8px">
            <span class="chip">click here, then press Tab — the link appears</span>
          </div>
        </div>
      ),
    },
  ],
};
