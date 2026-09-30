/**
 * Navigare: Breadcrumbs, Pagination, Stepper, Anchor (TOC), Navbar,
 * NavigationMenu, SidebarNav, AppShell, Sidebar.
 *
 * The rule that holds them all together: **navigation is a list of links**, not
 * a pile of `div`s with `onClick`. A `nav` with `ul`/`li` and `aria-current`
 * tells a screen reader how many items there are and where you are; a `div`
 * says nothing.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";
import { type El } from "./primitives/env.ts";
import { mediaQuery } from "./primitives/media-query.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* ----------------------------------------------------------- Breadcrumbs -- */

export interface Crumb {
  label: Child;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: readonly Crumb[] | Accessor<readonly Crumb[]>;
  separator?: Child;
  /** Above this many items, the middle ones collapse into "…". */
  maxItems?: number;
  label?: string;
  class?: string;
}

export function Breadcrumbs(props: BreadcrumbsProps): El {
  const all = typeof props.items === "function" ? props.items : () => props.items as readonly Crumb[];

  /** Keep the first and the last two; the rest become "…". */
  const shown = derived<Array<Crumb | null>>(() => {
    const items = all();
    const max = props.maxItems ?? 0;
    if (max <= 0 || items.length <= max) return [...items];
    return [items[0]!, null, ...items.slice(-2)];
  });

  return R.nav(
    {
      class: props.class ? "rui-breadcrumbs " + props.class : "rui-breadcrumbs",
      "aria-label": props.label ?? "Breadcrumbs",
    },
    R.ol(
      { class: "rui-breadcrumbs-list" },
      For({
        each: () => shown(),
        children: (crumb: Crumb | null, index: number) => {
          const last = index === shown().length - 1;
          return R.li(
            { class: "rui-breadcrumb" },
            index > 0
              ? R.span({ class: "rui-breadcrumb-sep", "aria-hidden": "true" }, props.separator ?? "/")
              : null,
            crumb === null
              ? R.span({ class: "rui-breadcrumb-ellipsis", "aria-hidden": "true" }, "…")
              : last
                ? // The last item is NOT a link: it's where you already are.
                  R.span({ class: "rui-breadcrumb-current", "aria-current": "page" }, crumb.label)
                : R.a(
                    {
                      class: "rui-link",
                      ...(crumb.href ? { href: crumb.href } : { role: "link", tabindex: "0" }),
                      ...(crumb.onClick
                        ? {
                            "on:click": (e: any) => {
                              if (e.metaKey || e.ctrlKey) return;
                              e.preventDefault?.();
                              crumb.onClick!();
                            },
                          }
                        : {}),
                    },
                    crumb.label,
                  ),
          );
        },
      }),
    ),
  );
}

/* ------------------------------------------------------------ Pagination -- */

export interface PaginationProps {
  /** The current page, from 1. */
  page: State<number>;
  /** The total number of pages. */
  pageCount: Accessor<number> | number;
  /** How many pages are shown on each side of the current one. Default 1. */
  siblings?: number;
  onChange?: (page: number) => void;
  label?: string;
  class?: string;
}

/**
 * Computes the pages shown: always the first and last, the neighbors of the
 * current page, and `null` (an ellipsis) everywhere else. Exported separately
 * because it's the part people get wrong and it's easy to test.
 */
export function paginationRange(page: number, pageCount: number, siblings = 1): Array<number | null> {
  if (pageCount <= 0) return [];
  // First + last + current + 2 neighbors + 2 ellipses.
  const maxVisible = siblings * 2 + 5;
  if (pageCount <= maxVisible) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const left = Math.max(2, page - siblings);
  const right = Math.min(pageCount - 1, page + siblings);
  const out: Array<number | null> = [1];

  // An ellipsis only if we skip AT LEAST two pages; otherwise show the number.
  if (left > 2) out.push(null);
  else if (left === 2) out.push(2);

  for (let p = Math.max(left, 2); p <= right; p++) {
    if (!out.includes(p)) out.push(p);
  }

  if (right < pageCount - 1) out.push(null);
  else if (right === pageCount - 1 && !out.includes(pageCount - 1)) out.push(pageCount - 1);

  out.push(pageCount);
  return out;
}

export function Pagination(props: PaginationProps): El {
  const count = (): number => (typeof props.pageCount === "function" ? props.pageCount() : props.pageCount);

  const go = (page: number): void => {
    const total = count();
    const next = Math.min(Math.max(1, page), Math.max(1, total));
    if (next === props.page.peek()) return;
    props.page.set(next);
    props.onChange?.(next);
  };

  const pages = derived(() => paginationRange(props.page(), count(), props.siblings ?? 1));

  return R.nav(
    {
      class: props.class ? "rui-pagination " + props.class : "rui-pagination",
      "aria-label": props.label ?? "Pagination",
    },
    R.button({
      type: "button",
      class: "rui-page-nav",
      "aria-label": "Previous page",
      disabled: () => props.page() <= 1,
      "on:click": () => go(props.page.peek() - 1),
    }, "‹"),
    R.ul(
      { class: "rui-pagination-list" },
      For({
        each: () => pages(),
        children: (page: number | null) =>
          R.li(
            { class: "rui-page-item" },
            page === null
              ? R.span({ class: "rui-page-ellipsis", "aria-hidden": "true" }, "…")
              : R.button({
                  type: "button",
                  class: () => "rui-page" + (props.page() === page ? " rui-active" : ""),
                  // `aria-current="page"` is how the screen reader learns where it is.
                  "aria-current": () => (props.page() === page ? "page" : undefined),
                  "aria-label": "Page " + page,
                  "on:click": () => go(page),
                }, String(page)),
          ),
      }),
    ),
    R.button({
      type: "button",
      class: "rui-page-nav",
      "aria-label": "Next page",
      disabled: () => props.page() >= count(),
      "on:click": () => go(props.page.peek() + 1),
    }, "›"),
  );
}

/* --------------------------------------------------------------- Stepper -- */

export interface Step {
  key: string;
  label: Child;
  description?: Child;
  /** Invalid step: marked with an error instead of a checkmark. */
  error?: boolean;
}

export interface StepperProps {
  steps: readonly Step[];
  /** The index of the current step, from 0. */
  current: State<number>;
  orientation?: "horizontal" | "vertical";
  /** Allow jumping to an already-visited step by clicking. */
  clickable?: boolean;
  onChange?: (index: number) => void;
  label?: string;
  class?: string;
}

export function Stepper(props: StepperProps): El {
  const go = (index: number): void => {
    if (!props.clickable) return;
    // You can't jump forward: later steps may depend on what you fill in now.
    if (index > props.current.peek()) return;
    props.current.set(index);
    props.onChange?.(index);
  };

  return R.nav(
    {
      class:
        "rui-stepper rui-" +
        (props.orientation ?? "horizontal") +
        (props.class ? " " + props.class : ""),
      "aria-label": props.label ?? "Steps",
    },
    R.ol(
      { class: "rui-stepper-list" },
      props.steps.map((step, index) =>
        R.li(
          {
            class: () => {
              const current = props.current();
              let cls = "rui-step";
              if (index < current) cls += " rui-done";
              else if (index === current) cls += " rui-current";
              if (step.error) cls += " rui-error";
              return cls;
            },
            "aria-current": () => (props.current() === index ? "step" : undefined),
          },
          R.button(
            {
              type: "button",
              class: "rui-step-button",
              disabled: () => !props.clickable || index > props.current(),
              "on:click": () => go(index),
            },
            R.span({ class: "rui-step-marker", "aria-hidden": "true" }, () =>
              step.error ? "!" : props.current() > index ? "✓" : String(index + 1),
            ),
            R.span(
              { class: "rui-step-body" },
              R.span({ class: "rui-step-label" }, step.label),
              step.description !== undefined
                ? R.span({ class: "rui-step-desc" }, step.description)
                : null,
            ),
          ),
        ),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- Anchor -- */

export interface AnchorItem {
  id: string;
  label: Child;
  /** Indentation level, from 1. */
  level?: number;
}

export interface AnchorProps {
  items: readonly AnchorItem[] | Accessor<readonly AnchorItem[]>;
  /** The top margin at which a section is considered active. Default 80px. */
  offset?: number;
  onNavigate?: (id: string) => void;
  label?: string;
  class?: string;
}

/**
 * Anchor - a table of contents with scroll-spy.
 *
 * Marks the active section by tracking the scroll. It doesn't use
 * `IntersectionObserver` with a `threshold`, which gives wrong results for
 * sections taller than the screen: it compares positions against an imaginary
 * line `offset` px from the top, and picks the last section past it.
 */
export function Anchor(props: AnchorProps): El {
  const items = typeof props.items === "function" ? props.items : () => props.items as readonly AnchorItem[];
  const active = state<string>("");
  const offset = props.offset ?? 80;

  effect(() => {
    const doc: any = (globalThis as any).document;
    if (!doc || typeof doc.addEventListener !== "function") return;

    const recompute = (): void => {
      const list = items();
      let current = "";
      for (const item of list) {
        const el = doc.getElementById?.(item.id);
        if (!el || typeof el.getBoundingClientRect !== "function") continue;
        if (el.getBoundingClientRect().top - offset <= 0) current = item.id;
      }
      if (current === "" && list.length > 0) current = list[0]!.id;
      if (current !== active.peek()) active.set(current);
    };

    recompute();
    doc.addEventListener("scroll", recompute, true);
    onCleanup(() => doc.removeEventListener("scroll", recompute, true));
  });

  const jump = (item: AnchorItem, e: any): void => {
    if (e?.metaKey || e?.ctrlKey) return;
    e?.preventDefault?.();
    active.set(item.id);
    const el = (globalThis as any).document?.getElementById?.(item.id);
    el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    props.onNavigate?.(item.id);
  };

  return R.nav(
    {
      class: props.class ? "rui-anchor " + props.class : "rui-anchor",
      "aria-label": props.label ?? "On this page",
    },
    R.ul(
      { class: "rui-anchor-list" },
      For({
        each: items,
        children: (item: AnchorItem) =>
          R.li(
            { class: "rui-anchor-item", style: "padding-left:" + ((item.level ?? 1) - 1) * 12 + "px" },
            R.a(
              {
                href: "#" + item.id,
                class: () => "rui-anchor-link" + (active() === item.id ? " rui-active" : ""),
                "aria-current": () => (active() === item.id ? "location" : undefined),
                "on:click": (e: any) => jump(item, e),
              },
              item.label,
            ),
          ),
      }),
    ),
  );
}

/* ------------------------------------------------------------- SidebarNav */

export interface NavItem {
  key: string;
  label: Child;
  href?: string;
  icon?: Child;
  badge?: Child;
  disabled?: boolean;
  children?: readonly NavItem[];
}

export interface NavGroup {
  title?: Child;
  items: readonly NavItem[];
}

export interface SidebarNavProps {
  groups: readonly NavGroup[];
  /** The key of the active item. */
  active?: Accessor<string>;
  onNavigate?: (item: NavItem) => void;
  label?: string;
  class?: string;
}

export function SidebarNav(props: SidebarNavProps): El {
  const isActive = (key: string): boolean => props.active?.() === key;

  const renderItem = (item: NavItem, depth: number): El =>
    R.li(
      { class: "rui-nav-item" },
      R.a(
        {
          class: () =>
            "rui-nav-link" +
            (isActive(item.key) ? " rui-active" : "") +
            (item.disabled ? " rui-disabled" : ""),
          style: depth > 0 ? "padding-left:" + (12 + depth * 14) + "px" : undefined,
          ...(item.href ? { href: item.href } : { role: "link", tabindex: item.disabled ? "-1" : "0" }),
          "aria-current": () => (isActive(item.key) ? "page" : undefined),
          ...(item.disabled ? { "aria-disabled": "true" } : {}),
          "on:click": (e: any) => {
            if (item.disabled) {
              e.preventDefault?.();
              return;
            }
            if (e.metaKey || e.ctrlKey) return;
            if (props.onNavigate) {
              e.preventDefault?.();
              props.onNavigate(item);
            }
          },
        },
        item.icon !== undefined ? R.span({ class: "rui-nav-icon", "aria-hidden": "true" }, item.icon) : null,
        R.span({ class: "rui-nav-label" }, item.label),
        item.badge !== undefined ? R.span({ class: "rui-nav-badge" }, item.badge) : null,
      ),
      item.children && item.children.length > 0
        ? R.ul({ class: "rui-nav-sublist" }, item.children.map((child) => renderItem(child, depth + 1)))
        : null,
    );

  return R.nav(
    {
      class: props.class ? "rui-sidebar-nav " + props.class : "rui-sidebar-nav",
      "aria-label": props.label ?? "Navigation",
    },
    props.groups.map((group) =>
      R.div(
        { class: "rui-nav-group" },
        group.title !== undefined
          ? R.div({ class: "rui-nav-group-title" }, group.title)
          : null,
        R.ul({ class: "rui-nav-list" }, group.items.map((item) => renderItem(item, 0))),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- Navbar -- */

export interface NavbarProps {
  brand?: Child;
  /** Central content (links). Hidden below the breakpoint. */
  children?: Child;
  /** Content on the right (actions, avatar). */
  actions?: Child;
  /** Below this width, `children` moves into the mobile menu. Default 768px. */
  breakpoint?: number;
  /** Content for the mobile menu; defaults to the same as `children`. */
  mobile?: Child;
  sticky?: boolean;
  label?: string;
  class?: string;
}

export function Navbar(props: NavbarProps): El {
  const wide = mediaQuery(`(min-width: ${props.breakpoint ?? 768}px)`, true);
  const menuOpen = state(false);

  // Switching to a wide screen closes the mobile menu, otherwise it stays open invisibly.
  effect(() => {
    if (wide()) menuOpen.set(false);
  });

  return R.header(
    {
      class: () =>
        "rui-navbar" + (props.sticky ? " rui-sticky" : "") + (props.class ? " " + props.class : ""),
    },
    R.nav(
      { class: "rui-navbar-inner", "aria-label": props.label ?? "Main" },
      props.brand !== undefined ? R.div({ class: "rui-navbar-brand" }, props.brand) : null,
      Show({
        when: () => wide(),
        children: R.div({ class: "rui-navbar-links" }, props.children ?? null),
      }),
      R.div({ class: "rui-navbar-actions" }, props.actions ?? null),
      Show({
        when: () => !wide(),
        children: R.button({
          type: "button",
          class: "rui-navbar-burger",
          "aria-label": () => (menuOpen() ? "Close menu" : "Open menu"),
          "aria-expanded": () => String(menuOpen()),
          "aria-controls": "rui-navbar-mobile",
          "on:click": () => menuOpen.update((v) => !v),
        }, "☰"),
      }),
    ),
    Show({
      when: () => !wide() && menuOpen(),
      children: R.div(
        { id: "rui-navbar-mobile", class: "rui-navbar-mobile" },
        props.mobile ?? props.children ?? null,
      ),
    }),
  );
}

/* -------------------------------------------------------- NavigationMenu -- */

export interface NavMenuEntry {
  key: string;
  label: Child;
  href?: string;
  /** Submenu; its presence makes the entry expandable. */
  items?: readonly NavItem[];
}

export interface NavigationMenuProps {
  entries: readonly NavMenuEntry[];
  onNavigate?: (item: NavItem | NavMenuEntry) => void;
  label?: string;
  class?: string;
}

/**
 * NavigationMenu - a navigation bar with submenus.
 *
 * The submenu opens on hover AND on focus/Enter: a hover-only menu is
 * inaccessible via keyboard and on touch. Closing on leaving the area has a
 * small delay, otherwise the mouse path from the button to the submenu closes it.
 */
export function NavigationMenu(props: NavigationMenuProps): El {
  const openKey = state<string | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelClose = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };
  onCleanup(cancelClose);

  const scheduleClose = (): void => {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      openKey.set(null);
    }, 150);
  };

  const open = (key: string): void => {
    cancelClose();
    openKey.set(key);
  };

  return R.nav(
    {
      class: props.class ? "rui-navmenu " + props.class : "rui-navmenu",
      "aria-label": props.label ?? "Navigation",
      "on:keydown": (e: any) => {
        if (e.key === "Escape") openKey.set(null);
      },
    },
    R.ul(
      { class: "rui-navmenu-list" },
      props.entries.map((entry) => {
        const id = "rui-nm-" + ++idSeq;
        const hasMenu = entry.items !== undefined && entry.items.length > 0;
        return R.li(
          {
            class: "rui-navmenu-item",
            ...(hasMenu
              ? { "on:pointerenter": () => open(entry.key), "on:pointerleave": scheduleClose }
              : {}),
          },
          hasMenu
            ? R.button({
                type: "button",
                class: () => "rui-navmenu-trigger" + (openKey() === entry.key ? " rui-open" : ""),
                "aria-haspopup": "true",
                "aria-expanded": () => String(openKey() === entry.key),
                "aria-controls": id,
                "on:click": () => openKey.update((k) => (k === entry.key ? null : entry.key)),
                "on:focus": () => open(entry.key),
              }, entry.label)
            : R.a(
                {
                  class: "rui-navmenu-link",
                  ...(entry.href ? { href: entry.href } : { role: "link", tabindex: "0" }),
                  "on:click": (e: any) => {
                    if (e.metaKey || e.ctrlKey) return;
                    if (props.onNavigate) {
                      e.preventDefault?.();
                      props.onNavigate(entry);
                    }
                  },
                },
                entry.label,
              ),
          hasMenu
            ? Show({
                when: () => openKey() === entry.key,
                children: R.ul(
                  { id, class: "rui-navmenu-sub", "on:pointerenter": cancelClose, "on:pointerleave": scheduleClose },
                  entry.items!.map((item) =>
                    R.li(
                      { class: "rui-navmenu-subitem" },
                      R.a(
                        {
                          class: "rui-navmenu-sublink",
                          ...(item.href ? { href: item.href } : { role: "link", tabindex: "0" }),
                          "on:click": (e: any) => {
                            if (e.metaKey || e.ctrlKey) return;
                            if (props.onNavigate) {
                              e.preventDefault?.();
                              props.onNavigate(item);
                            }
                            openKey.set(null);
                          },
                        },
                        item.label,
                      ),
                    ),
                  ),
                ),
              })
            : null,
        );
      }),
    ),
  );
}

/* --------------------------------------------------- Sidebar si AppShell -- */

export interface SidebarProps {
  children: Child;
  /** Open signal; on a narrow screen it becomes a panel over the content. */
  open?: State<boolean>;
  /** Below this width, the sidebar is overlaid, not docked. Default 1024px. */
  breakpoint?: number;
  width?: string;
  side?: "left" | "right";
  label?: string;
  class?: string;
}

export function Sidebar(props: SidebarProps): El {
  const wide = mediaQuery(`(min-width: ${props.breakpoint ?? 1024}px)`, true);
  const open = props.open ?? state(true);

  return R.aside(
    {
      class: () =>
        "rui-sidebar rui-side-" +
        (props.side ?? "left") +
        (wide() ? " rui-docked" : " rui-overlay") +
        (open() ? " rui-open" : " rui-closed") +
        (props.class ? " " + props.class : ""),
      style: "width:" + (props.width ?? "260px"),
      "aria-label": props.label ?? "Side panel",
      // Hidden from the screen reader when closed and overlaid; when docked and
      // closed, it stays in the flow but with zero width.
      "aria-hidden": () => String(!wide() && !open()),
    },
    props.children,
  );
}

export interface AppShellProps {
  header?: Child;
  sidebar?: Child;
  children: Child;
  footer?: Child;
  sidebarWidth?: string;
  class?: string;
}

/**
 * AppShell - the skeleton of an application: header, sidebar, content, footer.
 *
 * The main content is a `<main>` with an `id`, so you can add a "skip to
 * content" link - the first accessibility requirement of any application with
 * long navigation.
 */
export function AppShell(props: AppShellProps): El {
  return R.div(
    {
      class: props.class ? "rui-shell " + props.class : "rui-shell",
      style: props.sidebarWidth ? "--rui-shell-side:" + props.sidebarWidth : undefined,
    },
    props.header !== undefined ? R.div({ class: "rui-shell-header" }, props.header) : null,
    R.div(
      { class: "rui-shell-body" },
      props.sidebar !== undefined ? R.div({ class: "rui-shell-side" }, props.sidebar) : null,
      R.main({ id: "rui-main", class: "rui-shell-main", tabindex: "-1" }, props.children),
    ),
    props.footer !== undefined ? R.div({ class: "rui-shell-footer" }, props.footer) : null,
  );
}
