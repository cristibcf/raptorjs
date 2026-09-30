/**
 * Masonry, Affix, SafeArea, SkipNav, BottomNavigation, Dock, SplitButton, FAB.
 *
 * Bits of layout and actions that come up often enough to be worth writing
 * once, but not so often that they belong in the core.
 */
import { state, derived, effect, onCleanup, type Accessor } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";
import { mediaQuery } from "./primitives/media-query.ts";
import { DropdownMenu, type MenuEntry } from "./menu.ts";
import { type Space, SPACE } from "./layout.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------------------------------------------- Masonry -- */

export interface MasonryProps {
  items: readonly Child[] | Accessor<readonly Child[]>;
  /** The number of columns. Default 3. */
  columns?: number | Accessor<number>;
  gap?: Space;
  class?: string;
}

/**
 * Masonry - columns of unequal heights.
 *
 * Distributes items across columns in round-robin order (1,2,3,1,2,3...), NOT
 * by measured height. Measuring would require real layout and would cause jumps
 * as each image loads; round-robin order is stable, predictable and preserves
 * the logical order vertically. If you need perfect balancing, CSS `columns`
 * does it natively - at the cost of reading down columns, not across rows.
 */
export function Masonry(props: MasonryProps): El {
  const items = typeof props.items === "function" ? props.items : () => props.items as readonly Child[];
  const columnCount = (): number =>
    typeof props.columns === "function" ? props.columns() : (props.columns ?? 3);

  const buckets = derived<Child[][]>(() => {
    const n = Math.max(1, columnCount());
    const out: Child[][] = Array.from({ length: n }, () => []);
    const list = items();
    for (let i = 0; i < list.length; i++) out[i % n]!.push(list[i]!);
    return out;
  });

  const gap = SPACE[props.gap ?? 4] + "px";

  return R.div(
    {
      class: props.class ? "rui-masonry " + props.class : "rui-masonry",
      style: () => `display:grid;gap:${gap};grid-template-columns:repeat(${columnCount()}, minmax(0, 1fr))`,
    },
    For({
      each: () => buckets().map((_, i) => i),
      children: (index: number) =>
        R.div(
          { class: "rui-masonry-col", style: `display:flex;flex-direction:column;gap:${gap}` },
          () => buckets()[index] ?? [],
        ),
    }),
  );
}

/* ----------------------------------------------------------------- Affix -- */

export interface AffixProps {
  children: Child;
  /** The distance from the top at which it sticks. Default 0. */
  offsetTop?: number;
  /** Or from the bottom, if you want it to stick to the base. */
  offsetBottom?: number;
  onChange?: (affixed: boolean) => void;
  class?: string;
}

/**
 * Affix - element that sticks on scroll.
 *
 * Uses `position: sticky`, not scroll calculations: the browser does it better
 * and without jumps. The `affixed` signal is only for styling (a shadow when
 * stuck), not for positioning.
 */
export function Affix(props: AffixProps): El {
  const affixed = state(false);
  let el: El = null;

  effect(() => {
    const doc: any = (globalThis as any).document;
    if (!doc || typeof doc.addEventListener !== "function") return;

    const check = (): void => {
      if (!el || typeof el.getBoundingClientRect !== "function") return;
      const rect = el.getBoundingClientRect();
      const next =
        props.offsetBottom !== undefined
          ? rect.bottom >= ((globalThis as any).innerHeight ?? 0) - props.offsetBottom
          : rect.top <= (props.offsetTop ?? 0);
      if (next !== affixed.peek()) {
        affixed.set(next);
        props.onChange?.(next);
      }
    };

    doc.addEventListener("scroll", check, true);
    onCleanup(() => doc.removeEventListener("scroll", check, true));
  });

  return R.div(
    {
      class: () => "rui-affix" + (affixed() ? " rui-affixed" : "") + (props.class ? " " + props.class : ""),
      style:
        props.offsetBottom !== undefined
          ? "position:sticky;bottom:" + props.offsetBottom + "px"
          : "position:sticky;top:" + (props.offsetTop ?? 0) + "px",
      ref: (node: El) => {
        el = node;
      },
    },
    props.children,
  );
}

/* -------------------------------------------------------------- SafeArea -- */

export interface SafeAreaProps {
  children: Child;
  /** Which edges get padding. Default all. */
  edges?: ReadonlyArray<"top" | "right" | "bottom" | "left">;
  /** Minimum padding, even without a notch. */
  minimum?: Space;
  class?: string;
}

/**
 * SafeArea - padding that avoids the notch and the gesture bar.
 *
 * `env(safe-area-inset-*)` is zero on desktop, so the component is harmless
 * there. `max()` guarantees a minimum padding even without a notch.
 */
export function SafeArea(props: SafeAreaProps): El {
  const edges = props.edges ?? (["top", "right", "bottom", "left"] as const);
  const min = SPACE[props.minimum ?? 0] + "px";
  const style = edges
    .map((edge) => `padding-${edge}:max(${min}, env(safe-area-inset-${edge}, 0px))`)
    .join(";");

  return R.div(
    { class: props.class ? "rui-safe-area " + props.class : "rui-safe-area", style },
    props.children,
  );
}

/* --------------------------------------------------------------- SkipNav -- */

export interface SkipNavProps {
  /** The target element's `id`. Default `rui-main` (the one from `AppShell`). */
  target?: string;
  children?: Child;
  class?: string;
}

/**
 * SkipNav - "skip to content".
 *
 * It must be the **first focusable element on the page** and must become
 * visible on focus. Without it, anyone navigating by keyboard goes through the
 * whole menu on every page.
 */
export function SkipNav(props: SkipNavProps): El {
  const target = props.target ?? "rui-main";
  return R.a(
    {
      href: "#" + target,
      class: props.class ? "rui-skipnav " + props.class : "rui-skipnav",
      "on:click": (e: any) => {
        const el = (globalThis as any).document?.getElementById?.(target);
        if (!el) return;
        e.preventDefault?.();
        // `focus()` besides scroll: otherwise Tab continues from the old place.
        if (typeof el.focus === "function") el.focus();
        el.scrollIntoView?.({ block: "start" });
      },
    },
    props.children ?? "Skip to content",
  );
}

/* ----------------------------------------------- BottomNavigation / Dock -- */

export interface BottomNavItem {
  key: string;
  label: Child;
  icon?: Child;
  badge?: Child;
  disabled?: boolean;
}

export interface BottomNavigationProps {
  items: readonly BottomNavItem[];
  active: Accessor<string>;
  onSelect: (key: string) => void;
  /** Above this width it is no longer shown. Default 768px. */
  breakpoint?: number;
  label?: string;
  class?: string;
}

/** Mobile navigation, stuck at the bottom. Hides itself on wide screens. */
export function BottomNavigation(props: BottomNavigationProps): Child {
  const narrow = mediaQuery(`(max-width: ${(props.breakpoint ?? 768) - 1}px)`, false);

  return Show({
    when: () => narrow(),
    children: R.nav(
      {
        class: props.class ? "rui-bottomnav " + props.class : "rui-bottomnav",
        "aria-label": props.label ?? "Main navigation",
      },
      props.items.map((item) =>
        R.button({
          type: "button",
          class: () => "rui-bottomnav-item" + (props.active() === item.key ? " rui-active" : ""),
          "aria-current": () => (props.active() === item.key ? "page" : undefined),
          disabled: item.disabled === true,
          "on:click": () => props.onSelect(item.key),
        },
        item.icon !== undefined ? R.span({ class: "rui-bottomnav-icon", "aria-hidden": "true" }, item.icon) : null,
        R.span({ class: "rui-bottomnav-label" }, item.label),
        item.badge !== undefined ? R.span({ class: "rui-bottomnav-badge" }, item.badge) : null,
        ),
      ),
    ),
  });
}

export interface DockItem {
  key: string;
  label: string;
  icon: Child;
  onClick: () => void;
  disabled?: boolean;
  active?: Accessor<boolean>;
}

export interface DockProps {
  items: readonly DockItem[];
  position?: "bottom" | "left" | "right";
  label?: string;
  class?: string;
}

/** Floating action bar. Each button has a name, being icon-only. */
export function Dock(props: DockProps): El {
  return R.div(
    {
      class: "rui-dock rui-dock-" + (props.position ?? "bottom") + (props.class ? " " + props.class : ""),
      role: "toolbar",
      "aria-label": props.label ?? "Actions",
    },
    props.items.map((item) =>
      R.button({
        type: "button",
        class: () => "rui-dock-item" + (item.active?.() ? " rui-active" : ""),
        "aria-label": item.label,
        ...(item.active ? { "aria-pressed": () => String(item.active!()) } : {}),
        disabled: item.disabled === true,
        "on:click": item.onClick,
      }, item.icon),
    ),
  );
}

/* --------------------------------------------- SplitButton / FAB --------- */

export interface SplitButtonProps {
  /** The primary action. */
  children: Child;
  onClick: () => void;
  /** The dropdown options. */
  entries: readonly MenuEntry[];
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: Accessor<boolean> | boolean;
  menuLabel?: string;
  class?: string;
}

/**
 * SplitButton - primary action + menu.
 *
 * Two buttons, not one: otherwise you can't press the default action without
 * opening the menu. The arrow has its own accessible name.
 */
export function SplitButton(props: SplitButtonProps): El {
  const off = (): boolean =>
    typeof props.disabled === "function" ? props.disabled() : props.disabled === true;
  const variant = props.variant ?? "primary";
  const size = props.size ?? "md";

  return R.div(
    { class: props.class ? "rui-splitbutton " + props.class : "rui-splitbutton" },
    R.button({
      type: "button",
      class: `rui-btn rui-btn-${variant} rui-btn-${size} rui-split-main`,
      disabled: () => off(),
      "on:click": () => props.onClick(),
    }, props.children),
    DropdownMenu({
      trigger: R.span({ "aria-hidden": "true" }, "▾"),
      label: props.menuLabel ?? "More actions",
      entries: props.entries,
      placement: "bottom-end",
      class: "rui-split-menu",
    }),
  );
}

export interface FloatingActionButtonProps {
  icon: Child;
  label: string;
  onClick: () => void;
  position?: "bottom-right" | "bottom-left" | "bottom-center";
  /** Label shown next to the icon (extended FAB). */
  extended?: Child;
  class?: string;
}

export function FloatingActionButton(props: FloatingActionButtonProps): El {
  return R.button(
    {
      type: "button",
      class:
        "rui-fab rui-fab-" +
        (props.position ?? "bottom-right") +
        (props.extended !== undefined ? " rui-fab-extended" : "") +
        (props.class ? " " + props.class : ""),
      "aria-label": props.label,
      "on:click": props.onClick,
    },
    R.span({ class: "rui-fab-icon", "aria-hidden": "true" }, props.icon),
    props.extended !== undefined ? R.span({ class: "rui-fab-label" }, props.extended) : null,
  );
}
