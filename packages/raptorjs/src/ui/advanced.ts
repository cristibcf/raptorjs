/**
 * Composite components: Kanban, Wizard, Menubar, HoverCard, Tour.
 *
 * Each one combines several primitives and base components into a
 * self-contained flow. They live apart because they are large and rarely all
 * used at once - import them through `@raptorstack/raptorjs/ui/advanced` so you don't pull
 * them in when you don't need them.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { Portal } from "./primitives/portal.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { focusTrap } from "./primitives/focus-trap.ts";
import { onDoc, focus, type El } from "./primitives/env.ts";
import { Button } from "./button.ts";
import { DropdownMenu, type MenuEntry } from "./menu.ts";
import { type FormGroup } from "./form.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* ---------------------------------------------------------------- Kanban -- */

export interface KanbanCard {
  key: string;
  title: Child;
  description?: Child;
  badge?: Child;
}

export interface KanbanColumn {
  key: string;
  title: Child;
  /** WIP limit; above it the column is flagged. */
  limit?: number;
}

export interface KanbanProps {
  columns: readonly KanbanColumn[];
  /** Cards per column. */
  cards: State<Readonly<Record<string, readonly KanbanCard[]>>>;
  onMove?: (card: KanbanCard, from: string, to: string, index: number) => void;
  label?: string;
  class?: string;
}

export interface KanbanHandle {
  el: El;
  /** Programmatic move (also used for the keyboard). */
  move: (cardKey: string, toColumn: string, index?: number) => void;
}

/**
 * Kanban - columns with movable cards.
 *
 * Moving also works from the keyboard: each card has a "Move to…" menu.
 * Drag & drop alone would make the board unusable without a mouse, which is a
 * classic accessibility failure of this component.
 */
export function kanban(props: KanbanProps): KanbanHandle {
  const dragging = state<{ card: KanbanCard; from: string } | null>(null);
  const over = state<string | null>(null);

  const move = (cardKey: string, toColumn: string, index?: number): void => {
    props.cards.update((prev) => {
      let card: KanbanCard | null = null;
      let from = "";
      for (const [column, list] of Object.entries(prev)) {
        const found = list.find((c) => c.key === cardKey);
        if (found) {
          card = found;
          from = column;
          break;
        }
      }
      if (!card) return prev;

      const next: Record<string, readonly KanbanCard[]> = { ...prev };
      next[from] = (prev[from] ?? []).filter((c) => c.key !== cardKey);
      const target = [...(next[toColumn] ?? [])];
      target.splice(index ?? target.length, 0, card);
      next[toColumn] = target;
      props.onMove?.(card, from, toColumn, index ?? target.length - 1);
      return next;
    });
  };

  const moveEntries = (card: KanbanCard, from: string): readonly MenuEntry[] =>
    props.columns
      .filter((c) => c.key !== from)
      .map((column) => ({
        kind: "item" as const,
        label: column.title,
        onSelect: () => move(card.key, column.key),
      }));

  const el = R.div(
    {
      class: props.class ? "rui-kanban " + props.class : "rui-kanban",
      role: "group",
      "aria-label": props.label ?? "Kanban board",
    },
    props.columns.map((column) => {
      const cards = (): readonly KanbanCard[] => props.cards()[column.key] ?? [];
      const overLimit = (): boolean => column.limit !== undefined && cards().length > column.limit;

      return R.section(
        {
          class: () =>
            "rui-kanban-col" +
            (over() === column.key ? " rui-over" : "") +
            (overLimit() ? " rui-over-limit" : ""),
          "aria-label": undefined,
          "on:pointerenter": () => {
            if (dragging()) over.set(column.key);
          },
          "on:pointerup": () => {
            const current = dragging.peek();
            if (current && over.peek() === column.key && current.from !== column.key) {
              move(current.card.key, column.key);
            }
            dragging.set(null);
            over.set(null);
          },
        },
        R.header(
          { class: "rui-kanban-head" },
          R.h3({ class: "rui-kanban-title" }, column.title),
          R.span(
            { class: "rui-kanban-count" },
            () => cards().length + (column.limit !== undefined ? " / " + column.limit : ""),
          ),
        ),
        R.ul(
          { class: "rui-kanban-list", role: "list" },
          For({
            each: cards,
            children: (card: KanbanCard) =>
              R.li(
                {
                  class: () =>
                    "rui-kanban-card" + (dragging()?.card.key === card.key ? " rui-dragging" : ""),
                  "on:pointerdown": () => dragging.set({ card, from: column.key }),
                },
                R.div({ class: "rui-kanban-card-title" }, card.title),
                card.description !== undefined
                  ? R.div({ class: "rui-kanban-card-desc" }, card.description)
                  : null,
                R.div(
                  { class: "rui-kanban-card-foot" },
                  card.badge !== undefined ? R.span({ class: "rui-kanban-badge" }, card.badge) : null,
                  DropdownMenu({
                    trigger: R.span({ "aria-hidden": "true" }, "⋯"),
                    label: "Move card",
                    entries: moveEntries(card, column.key),
                    placement: "bottom-end",
                  }),
                ),
              ),
          }),
        ),
      );
    }),
  );

  return { el, move };
}

export function Kanban(props: KanbanProps): El {
  return kanban(props).el;
}

/* ---------------------------------------------------------------- Wizard -- */

export interface WizardStep {
  key: string;
  title: Child;
  content: Child | (() => Child);
  /** The field group validated before moving on. */
  group?: FormGroup;
  /** Custom validation; `false` blocks advancing. */
  canAdvance?: () => boolean;
  optional?: boolean;
}

export interface WizardProps {
  steps: readonly WizardStep[];
  current?: State<number>;
  onFinish?: () => void | Promise<unknown>;
  nextLabel?: Child;
  backLabel?: Child;
  finishLabel?: Child;
  label?: string;
  class?: string;
}

export interface WizardHandle {
  el: El;
  current: Accessor<number>;
  next: () => void;
  back: () => void;
  goTo: (index: number) => void;
}

/**
 * Wizard - multi-step flow with validation between steps.
 *
 * Back always works; forward only if the current step is valid. When blocked,
 * the group's fields are marked as touched so the errors become visible -
 * otherwise the button just looks broken.
 */
export function wizard(props: WizardProps): WizardHandle {
  const id = "rui-wiz-" + ++idSeq;
  const current = props.current ?? state(0);
  const last = props.steps.length - 1;

  const step = (): WizardStep | undefined => props.steps[current()];

  const canAdvance = (): boolean => {
    const s = step();
    if (!s) return false;
    if (s.optional) return true;
    if (s.group && !s.group.valid()) return false;
    return s.canAdvance?.() !== false;
  };

  const next = (): void => {
    const s = step();
    if (!s) return;
    if (!canAdvance()) {
      s.group?.touchAll();
      return;
    }
    if (current.peek() >= last) {
      props.onFinish?.();
      return;
    }
    current.set(current.peek() + 1);
  };

  const back = (): void => current.set(Math.max(0, current.peek() - 1));
  const goTo = (index: number): void => {
    // Only jump backward: later steps may depend on ones not yet validated.
    if (index <= current.peek()) current.set(Math.max(0, index));
  };

  const el = R.div(
    {
      class: props.class ? "rui-wizard " + props.class : "rui-wizard",
      role: "group",
      "aria-label": props.label ?? "Wizard",
    },
    R.ol(
      { class: "rui-wizard-steps" },
      props.steps.map((s, index) =>
        R.li(
          {
            class: () => {
              let cls = "rui-wizard-step";
              if (index < current()) cls += " rui-done";
              else if (index === current()) cls += " rui-current";
              return cls;
            },
            "aria-current": () => (current() === index ? "step" : undefined),
          },
          R.button(
            {
              type: "button",
              class: "rui-wizard-steplabel",
              disabled: () => index > current(),
              "on:click": () => goTo(index),
            },
            R.span({ class: "rui-wizard-marker", "aria-hidden": "true" }, () =>
              current() > index ? "✓" : String(index + 1),
            ),
            s.title,
            s.optional ? R.span({ class: "rui-wizard-optional" }, " (optional)") : null,
          ),
        ),
      ),
    ),
    R.div(
      {
        id: id + "-panel",
        class: "rui-wizard-panel",
        role: "group",
        "aria-live": "polite",
      },
      () => {
        const s = step();
        if (!s) return null;
        return typeof s.content === "function" ? s.content() : s.content;
      },
    ),
    R.div(
      { class: "rui-wizard-actions" },
      Button({
        variant: "ghost",
        disabled: () => current() === 0,
        onClick: back,
        children: props.backLabel ?? "Back",
      }),
      Button({
        variant: "primary",
        // We do NOT disable the button when the step is invalid: pressing it is
        // how the user finds out WHAT is missing.
        onClick: next,
        children: () => (current() >= last ? (props.finishLabel ?? "Finish") : (props.nextLabel ?? "Continue")),
      }),
    ),
  );

  return { el, current: () => current(), next, back, goTo };
}

export function Wizard(props: WizardProps): El {
  return wizard(props).el;
}

/* --------------------------------------------------------------- Menubar -- */

export interface MenubarMenu {
  key: string;
  label: Child;
  entries: readonly MenuEntry[];
}

export interface MenubarProps {
  menus: readonly MenubarMenu[];
  label?: string;
  class?: string;
}

/**
 * Menubar - desktop-style menu bar (File, Edit, …).
 *
 * Left/right arrows move between menus; once one is open, arrowing to the next
 * opens it directly, without a click - that's how a native menu bar behaves.
 */
export function Menubar(props: MenubarProps): El {
  // Construction does not subscribe the caller's computation; see `isolate`.
  return isolate(() => MenubarImpl(props));
}

function MenubarImpl(props: MenubarProps): El {
  /** One signal per menu; only one can be open at a time. */
  const opens = new Map<string, State<boolean>>();
  for (const menu of props.menus) opens.set(menu.key, state(false));

  const closeAll = (except?: string): void => {
    for (const [key, signal] of opens) if (key !== except && signal.peek()) signal.set(false);
  };

  // Opening one closes the others, as in a native menu bar.
  for (const [key, signal] of opens) {
    effect(() => {
      if (signal()) closeAll(key);
    });
  }

  const openIndex = (): number => props.menus.findIndex((m) => opens.get(m.key)?.() === true);

  const moveFocus = (delta: number): void => {
    const count = props.menus.length;
    if (count === 0) return;
    const at = openIndex();
    const from = at === -1 ? focusedIndex.peek() : at;
    const next = (from + delta + count) % count;
    focusedIndex.set(next);
    const menu = props.menus[next]!;
    focus(triggers.get(menu.key));
    // If a menu was open, arrowing to the next opens it directly.
    if (at !== -1) opens.get(menu.key)?.set(true);
  };

  const focusedIndex = state(0);
  const triggers = new Map<string, El>();

  return R.div(
    {
      class: props.class ? "rui-menubar " + props.class : "rui-menubar",
      role: "menubar",
      "aria-label": props.label ?? "Main menu",
      "on:keydown": (e: any) => {
        if (e.key === "ArrowRight") {
          e.preventDefault?.();
          moveFocus(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault?.();
          moveFocus(-1);
        } else if (e.key === "Escape") {
          closeAll();
        }
      },
    },
    props.menus.map((menu, index) =>
      R.div(
        {
          class: "rui-menubar-item",
          role: "none",
          ref: (el: El) => {
            // The trigger is the button inside the DropdownMenu.
            const button = el?.querySelector?.("button");
            if (button) triggers.set(menu.key, button);
          },
          "on:focusin": () => focusedIndex.set(index),
        },
        DropdownMenu({
          trigger: menu.label,
          entries: menu.entries,
          open: opens.get(menu.key)!,
          class: "rui-menubar-menu",
        }),
      ),
    ),
  );
}

/* ------------------------------------------------------------- HoverCard -- */

export interface HoverCardProps {
  trigger: (props: Record<string, unknown>) => El;
  children: Child;
  /** Ms until opening. Default 500. */
  openDelay?: number;
  /** Ms until closing after the pointer leaves. Default 200. */
  closeDelay?: number;
  placement?: Placement;
  class?: string;
}

/**
 * HoverCard - rich card on hover (profile preview, link preview).
 *
 * Unlike `Tooltip`: it holds interactive content, so you must be able to reach
 * it with the mouse - hence the close delay. It also opens on focus, with
 * `role="dialog"`, not `tooltip`.
 */
export function HoverCard(props: HoverCardProps): El {
  const id = "rui-hc-" + ++idSeq;
  const open = state(false);
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  };
  onCleanup(clearTimers);

  const pos = positioner({ placement: props.placement ?? "bottom-start", offset: 8, enabled: () => open() });

  const show = (): void => {
    clearTimers();
    openTimer = setTimeout(() => {
      openTimer = null;
      open.set(true);
    }, props.openDelay ?? 500);
  };

  const hide = (): void => {
    clearTimers();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      open.set(false);
    }, props.closeDelay ?? 200);
  };

  effect(() => {
    if (!open()) return;
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") {
        clearTimers();
        open.set(false);
      }
    });
    onCleanup(unbind);
  });

  return R.span(
    { class: "rui-hovercard-host" },
    props.trigger({
      ref: pos.reference,
      "aria-expanded": () => String(open()),
      "aria-controls": id,
      "on:pointerenter": show,
      "on:pointerleave": hide,
      "on:focus": show,
      "on:blur": hide,
    }),
    Show({
      when: () => open(),
      children: Portal({
        children: R.div(
          {
            id,
            class: props.class ? "rui-hovercard " + props.class : "rui-hovercard",
            role: "dialog",
            style: () => pos.style(),
            ref: pos.floating,
            "on:pointerenter": clearTimers,
            "on:pointerleave": hide,
          },
          props.children,
        ),
      }),
    }),
  );
}

/* ------------------------------------------------------------------ Tour -- */

export interface TourStep {
  /** The `id` of the highlighted element. Without it the step is centered on screen. */
  target?: string;
  title: Child;
  content: Child;
  placement?: Placement;
}

export interface TourProps {
  steps: readonly TourStep[];
  open: State<boolean>;
  index?: State<number>;
  onFinish?: () => void;
  onSkip?: () => void;
  class?: string;
}

export interface TourHandle {
  el: Child;
  index: Accessor<number>;
  next: () => void;
  back: () => void;
}

/**
 * Tour - step-by-step guide over the interface.
 *
 * The highlight is done with a huge `box-shadow` on a transparent rectangle,
 * not a cut-out overlay: it needs no SVG, doesn't block clicks on the element,
 * and works over any content.
 */
export function tour(props: TourProps): TourHandle {
  const index = props.index ?? state(0);
  const rect = state<{ x: number; y: number; width: number; height: number } | null>(null);
  const pos = positioner({ placement: "bottom-start", offset: 12, enabled: () => props.open() });

  const step = (): TourStep | undefined => props.steps[index()];

  const measure = (): void => {
    const current = step();
    if (!current?.target) {
      rect.set(null);
      return;
    }
    const el = (globalThis as any).document?.getElementById?.(current.target);
    if (!el || typeof el.getBoundingClientRect !== "function") {
      rect.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const box = { x: r.x ?? r.left ?? 0, y: r.y ?? r.top ?? 0, width: r.width ?? 0, height: r.height ?? 0 };
    rect.set(box);
    pos.update({
      reference: box,
      floating: { x: 0, y: 0, width: 300, height: 160 },
    });
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  effect(() => {
    if (!props.open()) return;
    void index();
    measure();
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") finish(true);
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    });
    onCleanup(unbind);
  });

  const finish = (skipped: boolean): void => {
    props.open.set(false);
    index.set(0);
    if (skipped) props.onSkip?.();
    else props.onFinish?.();
  };

  const next = (): void => {
    if (index.peek() >= props.steps.length - 1) finish(false);
    else index.set(index.peek() + 1);
  };
  const back = (): void => index.set(Math.max(0, index.peek() - 1));

  const el = Show({
    when: () => props.open(),
    children: Portal({
      children: R.div(
        { class: props.class ? "rui-tour " + props.class : "rui-tour" },
        // The spotlight hole over the targeted element.
        Show({
          when: () => rect() !== null,
          children: R.div({
            class: "rui-tour-spot",
            style: () => {
              const r = rect();
              if (!r) return "display:none";
              return `left:${r.x - 6}px;top:${r.y - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
            },
          }),
          fallback: R.div({ class: "rui-tour-dim" }),
        }),
        R.div(
          {
            class: "rui-tour-pop",
            role: "dialog",
            "aria-modal": "false",
            "aria-label": "Guide",
            ref: (node: El) => {
              pos.floating(node);
              focusTrap()(node);
            },
            style: () => (rect() === null ? "left:50%;top:50%;transform:translate(-50%,-50%);position:fixed" : pos.style()),
          },
          R.h3({ class: "rui-tour-title" }, () => step()?.title ?? ""),
          R.div({ class: "rui-tour-body" }, () => step()?.content ?? ""),
          R.div(
            { class: "rui-tour-foot" },
            R.span({ class: "rui-tour-counter" }, () => index() + 1 + " / " + props.steps.length),
            Button({ variant: "ghost", size: "sm", onClick: () => finish(true), children: "Skip" }),
            Button({
              variant: "secondary",
              size: "sm",
              disabled: () => index() === 0,
              onClick: back,
              children: "Back",
            }),
            Button({
              variant: "primary",
              size: "sm",
              onClick: next,
              children: () => (index() >= props.steps.length - 1 ? "Done" : "Continue"),
            }),
          ),
        ),
      ),
    }),
  });

  return { el, index: () => index(), next, back };
}

export function Tour(props: TourProps): Child {
  // Construction does not subscribe the caller's computation; see `isolate`.
  return isolate(() => TourImpl(props));
}

function TourImpl(props: TourProps): Child {
  return tour(props).el;
}
