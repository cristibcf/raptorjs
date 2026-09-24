/**
 * Masonry, Affix, SafeArea, SkipNav, BottomNavigation, Dock, SplitButton, FAB.
 *
 * Bucati de layout si actiuni care apar destul de des cat sa merite scrise o
 * data, dar nu atat cat sa fie in nucleu.
 */
import { state, derived, effect, onCleanup, type Accessor } from "@raptor/core";
import { R, For, Show, type Child } from "@raptor/dom";
import { type El } from "./primitives/env.ts";
import { mediaQuery } from "./primitives/media-query.ts";
import { DropdownMenu, type MenuEntry } from "./menu.ts";
import { type Space, SPACE } from "./layout.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------------------------------------------- Masonry -- */

export interface MasonryProps {
  items: readonly Child[] | Accessor<readonly Child[]>;
  /** Numarul de coloane. Implicit 3. */
  columns?: number | Accessor<number>;
  gap?: Space;
  class?: string;
}

/**
 * Masonry - coloane de inaltimi inegale.
 *
 * Distribuie itemii pe coloane in ordine ciclica (1,2,3,1,2,3...), NU dupa
 * inaltimea masurata. Masurarea ar cere layout real si ar produce salturi la
 * fiecare imagine incarcata; ordinea ciclica e stabila, previzibila si pastreaza
 * ordinea logica pe verticala. Daca ai nevoie de echilibrare perfecta, CSS
 * `columns` o face nativ - cu pretul citirii pe coloane, nu pe randuri.
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
  /** Distanta de sus la care se lipeste. Implicit 0. */
  offsetTop?: number;
  /** Sau de jos, daca vrei sa se lipeasca la baza. */
  offsetBottom?: number;
  onChange?: (affixed: boolean) => void;
  class?: string;
}

/**
 * Affix - element care se lipeste la scroll.
 *
 * Foloseste `position: sticky`, nu calcule de scroll: browserul o face mai bine
 * si fara salturi. Semnalul `affixed` e doar pentru stilizare (umbra la lipire),
 * nu pentru pozitionare.
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
  /** Ce margini primesc padding. Implicit toate. */
  edges?: ReadonlyArray<"top" | "right" | "bottom" | "left">;
  /** Padding minim, chiar si fara notch. */
  minimum?: Space;
  class?: string;
}

/**
 * SafeArea - padding care ocoleste notch-ul si bara de gesturi.
 *
 * `env(safe-area-inset-*)` e zero pe desktop, deci componenta e inofensiva
 * acolo. `max()` garanteaza un padding minim chiar si fara notch.
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
  /** `id`-ul elementului tinta. Implicit `rui-main` (cel din `AppShell`). */
  target?: string;
  children?: Child;
  class?: string;
}

/**
 * SkipNav - "sari la conținut".
 *
 * Trebuie sa fie **primul element focusabil din pagina** si sa devina vizibil la
 * focus. Fara el, cine navigheaza la tastatura trece prin tot meniul la fiecare
 * pagina.
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
        // `focus()` pe langa scroll: altfel Tab continua din locul vechi.
        if (typeof el.focus === "function") el.focus();
        el.scrollIntoView?.({ block: "start" });
      },
    },
    props.children ?? "Sari la conținut",
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
  /** Peste aceasta latime nu se mai afiseaza. Implicit 768px. */
  breakpoint?: number;
  label?: string;
  class?: string;
}

/** Navigare mobila, lipita jos. Se ascunde singura pe ecrane late. */
export function BottomNavigation(props: BottomNavigationProps): Child {
  const narrow = mediaQuery(`(max-width: ${(props.breakpoint ?? 768) - 1}px)`, false);

  return Show({
    when: () => narrow(),
    children: R.nav(
      {
        class: props.class ? "rui-bottomnav " + props.class : "rui-bottomnav",
        "aria-label": props.label ?? "Navigare principală",
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

/** Bara de actiuni flotanta. Fiecare buton are nume, fiind doar-icon. */
export function Dock(props: DockProps): El {
  return R.div(
    {
      class: "rui-dock rui-dock-" + (props.position ?? "bottom") + (props.class ? " " + props.class : ""),
      role: "toolbar",
      "aria-label": props.label ?? "Acțiuni",
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
  /** Actiunea principala. */
  children: Child;
  onClick: () => void;
  /** Optiunile din dropdown. */
  entries: readonly MenuEntry[];
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: Accessor<boolean> | boolean;
  menuLabel?: string;
  class?: string;
}

/**
 * SplitButton - actiune principala + meniu.
 *
 * Doua butoane, nu unul: altfel nu poti apasa actiunea implicita fara sa
 * deschizi meniul. Sageata are propriul nume accesibil.
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
      label: props.menuLabel ?? "Mai multe acțiuni",
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
  /** Eticheta afisata langa icon (FAB extins). */
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
