/**
 * Drawer / ContextMenu / Notification / Backdrop / ErrorBoundary.
 *
 * Rounds out the overlay set from wave 3. All of them reuse `Portal`,
 * `focusTrap`, `clickOutside` and `positioner`.
 */
import { state, effect, onCleanup, type Accessor, type State } from "raptorjs";
import { R, For, Show, block, mountChild, type Block, type Child } from "raptorjs/dom";
import { Portal } from "./primitives/portal.ts";
import { focusTrap } from "./primitives/focus-trap.ts";
import { positioner } from "./primitives/positioner.ts";
import { onDoc, type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* -------------------------------------------------------------- Backdrop -- */

export interface BackdropProps {
  visible: Accessor<boolean>;
  onClick?: () => void;
  /** Applies `backdrop-filter: blur`. */
  blur?: boolean;
  /** `z-index`. Default 90. */
  level?: number;
  children?: Child;
  class?: string;
}

/** Background for your own overlays. Decorative: `aria-hidden`. */
export function Backdrop(props: BackdropProps): Child {
  return Show({
    when: () => props.visible(),
    children: R.div(
      {
        class:
          "rui-backdrop" + (props.blur ? " rui-blur" : "") + (props.class ? " " + props.class : ""),
        style: "z-index:" + (props.level ?? 90),
        "aria-hidden": "true",
        ...(props.onClick
          ? {
              "on:click": (e: any) => {
                if (e.target === e.currentTarget) props.onClick!();
              },
            }
          : {}),
      },
      props.children ?? null,
    ),
  });
}

/* ---------------------------------------------------------------- Drawer -- */

/** Global scroll-lock counter, shared with `Dialog` (see overlay.ts). */
let scrollLocks = 0;
let savedOverflow = "";

function lockScroll(): () => void {
  const body = (globalThis as any).document?.body;
  if (!body?.style) return () => {};
  if (scrollLocks === 0) {
    savedOverflow = body.style.overflow ?? "";
    body.style.overflow = "hidden";
  }
  scrollLocks++;
  return () => {
    scrollLocks--;
    if (scrollLocks === 0) body.style.overflow = savedOverflow;
  };
}

export interface DrawerProps {
  open: State<boolean>;
  children: Child;
  title?: Child;
  footer?: Child;
  /** Which side it enters from. Default `right`. */
  side?: "left" | "right" | "top" | "bottom";
  size?: string;
  /** Panel that does NOT block the page underneath (no focus trap, no lock). */
  modeless?: boolean;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  onClose?: () => void;
  label?: string;
  class?: string;
}

/**
 * Drawer - side panel.
 *
 * `modeless: true` makes it an ordinary panel (filters, details): no focus
 * trap, no scroll lock, no `aria-modal`. A filter drawer that blocks the rest
 * of the page is a frequent and annoying mistake.
 */
export function Drawer(props: DrawerProps): Child {
  const id = "rui-drw-" + ++idSeq;
  const modal = props.modeless !== true;

  const close = (): void => {
    props.open.set(false);
    props.onClose?.();
  };

  effect(() => {
    if (!props.open()) return;
    const unlock = modal ? lockScroll() : () => {};
    const unbind =
      props.closeOnEscape === false
        ? () => {}
        : onDoc("keydown", (e: any) => {
            if (e.key === "Escape") close();
          });
    onCleanup(() => {
      unlock();
      unbind();
    });
  });

  const panel = R.div(
    {
      class: () =>
        "rui-drawer rui-drawer-" + (props.side ?? "right") + (props.class ? " " + props.class : ""),
      style:
        (props.side === "top" || props.side === "bottom" ? "height:" : "width:") +
        (props.size ?? "360px"),
      role: modal ? "dialog" : "complementary",
      ...(modal ? { "aria-modal": "true" } : {}),
      ...(props.title !== undefined ? { "aria-labelledby": id + "-title" } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
      ...(modal ? { ref: focusTrap() } : {}),
    },
    props.title !== undefined
      ? R.div(
          { class: "rui-drawer-head" },
          R.h2({ id: id + "-title", class: "rui-drawer-title" }, props.title),
          R.button({
            type: "button",
            class: "rui-drawer-close",
            "aria-label": "Close",
            "on:click": close,
          }, "✕"),
        )
      : null,
    R.div({ class: "rui-drawer-body" }, props.children),
    props.footer !== undefined ? R.div({ class: "rui-drawer-foot" }, props.footer) : null,
  );

  return Show({
    when: () => props.open(),
    children: Portal({
      children: modal
        ? R.div(
            {
              class: "rui-drawer-backdrop",
              ...(props.closeOnBackdrop === false
                ? {}
                : {
                    "on:click": (e: any) => {
                      if (e.target === e.currentTarget) close();
                    },
                  }),
            },
            panel,
          )
        : panel,
    }),
  });
}

/* ----------------------------------------------------------- ContextMenu -- */

export interface ContextMenuEntry {
  key: string;
  label: Child;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export type ContextMenuItem = ContextMenuEntry | { key: string; separator: true };

export interface ContextMenuProps {
  entries: readonly ContextMenuItem[] | Accessor<readonly ContextMenuItem[]>;
  /** The content that is right-clicked. Receives zone props. */
  children: (props: Record<string, unknown>) => El;
  label?: string;
  class?: string;
}

function isEntry(item: ContextMenuItem): item is ContextMenuEntry {
  return (item as { separator?: true }).separator !== true;
}

/**
 * ContextMenu - right-click menu.
 *
 * Also opened by the Menu key / Shift+F10, not just the mouse: otherwise it is
 * inaccessible from the keyboard. The position comes from `positioner`, fed a
 * one-pixel rectangle at the cursor's location - that way flip and shift work
 * the same as for any other overlay.
 */
export function ContextMenu(props: ContextMenuProps): El {
  const id = "rui-ctx-" + ++idSeq;
  const open = state(false);
  const active = state(-1);
  const entries = typeof props.entries === "function" ? props.entries : () => props.entries as readonly ContextMenuItem[];

  const pos = positioner({ placement: "bottom-start", offset: 0, enabled: () => open() });

  const selectable = (): number[] => {
    const list = entries();
    const out: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      if (isEntry(item) && !item.disabled) out.push(i);
    }
    return out;
  };

  const openAt = (x: number, y: number): void => {
    open.set(true);
    active.set(selectable()[0] ?? -1);
    // The cursor is a 1x1 rectangle: the rest of the logic is the `positioner`'s.
    pos.update({
      reference: { x, y, width: 1, height: 1 },
      floating: { x: 0, y: 0, width: 200, height: Math.max(40, entries().length * 32) },
    });
  };

  const close = (): void => {
    open.set(false);
    active.set(-1);
  };

  const run = (index: number): void => {
    const item = entries()[index];
    if (!item || !isEntry(item) || item.disabled) return;
    close();
    item.onSelect();
  };

  const move = (delta: number): void => {
    const idx = selectable();
    if (idx.length === 0) return;
    const at = idx.indexOf(active());
    const next = at === -1 ? (delta > 0 ? 0 : idx.length - 1) : (at + delta + idx.length) % idx.length;
    active.set(idx[next]!);
  };

  effect(() => {
    if (!open()) return;
    const unKey = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") close();
    });
    const unClick = onDoc("click", () => close());
    onCleanup(() => {
      unKey();
      unClick();
    });
  });

  const zone = props.children({
    "on:contextmenu": (e: any) => {
      e.preventDefault?.();
      openAt(Number(e.clientX ?? 0), Number(e.clientY ?? 0));
    },
    "on:keydown": (e: any) => {
      // The Menu key or Shift+F10: the same action, without a mouse.
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault?.();
        openAt(0, 0);
      }
    },
  });

  return R.span(
    { class: "rui-ctx-host" },
    zone,
    Show({
      when: () => open(),
      children: Portal({
        children: R.ul(
          {
            id,
            class: props.class ? "rui-ctx-menu " + props.class : "rui-ctx-menu",
            role: "menu",
            ...(props.label ? { "aria-label": props.label } : {}),
            style: () => pos.style(),
            "on:click": (e: any) => e.stopPropagation?.(),
            "on:keydown": (e: any) => {
              if (e.key === "ArrowDown") {
                e.preventDefault?.();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault?.();
                move(-1);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault?.();
                run(active());
              }
            },
          },
          For({
            each: entries,
            children: (item: ContextMenuItem, index: number) =>
              isEntry(item)
                ? R.li(
                    {
                      class: () =>
                        "rui-ctx-item" +
                        (active() === index ? " rui-active" : "") +
                        (item.disabled ? " rui-disabled" : ""),
                      role: "menuitem",
                      ...(item.disabled ? { "aria-disabled": "true" } : {}),
                      "on:click": () => run(index),
                      "on:mouseenter": () => {
                        if (!item.disabled) active.set(index);
                      },
                    },
                    R.span({ class: "rui-ctx-label" }, item.label),
                    item.hint !== undefined ? R.span({ class: "rui-ctx-hint" }, item.hint) : null,
                  )
                : R.li({ class: "rui-ctx-sep", role: "separator" }),
          }),
        ),
      }),
    }),
  );
}

/* ---------------------------------------------------------- Notification -- */

export interface NotificationProps {
  title?: Child;
  children: Child;
  tone?: "info" | "success" | "warning" | "danger";
  /** Actions at the bottom of the notification. */
  actions?: Child;
  onDismiss?: () => void;
  /** Date/time shown discreetly. */
  timestamp?: Child;
  /** Marks it as unread (colored dot). */
  unread?: Accessor<boolean>;
  class?: string;
}

/**
 * Notification - persistent notification, unlike `Toast`.
 *
 * It doesn't disappear on its own and has no `aria-live`: its place is a list
 * of notifications the user opens. An `aria-live` on each element of a list of
 * 40 would make the screen reader read everything on every open.
 */
export function Notification(props: NotificationProps): El {
  return R.article(
    {
      class: () =>
        "rui-notification rui-tone-" +
        (props.tone ?? "info") +
        (props.unread?.() ? " rui-unread" : "") +
        (props.class ? " " + props.class : ""),
    },
    Show({
      when: () => props.unread?.() === true,
      children: R.span({ class: "rui-notification-dot", "aria-label": "Unread" }),
    }),
    R.div(
      { class: "rui-notification-body" },
      props.title !== undefined ? R.h3({ class: "rui-notification-title" }, props.title) : null,
      R.div({ class: "rui-notification-message" }, props.children),
      props.timestamp !== undefined
        ? R.div({ class: "rui-notification-time" }, props.timestamp)
        : null,
      props.actions !== undefined
        ? R.div({ class: "rui-notification-actions" }, props.actions)
        : null,
    ),
    props.onDismiss
      ? R.button(
          {
            type: "button",
            class: "rui-notification-close",
            "aria-label": "Close notification",
            "on:click": props.onDismiss,
          },
          "✕",
        )
      : null,
  );
}

/* --------------------------------------------------------- ErrorBoundary -- */

export interface ErrorBoundaryProps {
  /** Builds the content. Called inside a `try`. */
  children: () => Child;
  /** What is shown on error. Receives the error and a retry function. */
  fallback: (error: unknown, retry: () => void) => Child;
  onError?: (error: unknown) => void;
}

/**
 * ErrorBoundary - catches errors while BUILDING a subtree.
 *
 * **What it catches:** exceptions thrown synchronously when `children()` builds
 * its nodes, including on a rebuild after `retry()`.
 *
 * **What it does NOT catch**, and cannot:
 * - errors from event handlers (`on:click`) - catch them there;
 * - errors from rejected promises - handle them with `.catch`;
 * - errors that appear later in an `effect` of an already-mounted binding.
 *
 * In a fine-grained runtime there is no render phase that can be replayed:
 * after mounting, each binding has its own lifecycle. We only promise what we
 * can keep.
 */
export function ErrorBoundary(props: ErrorBoundaryProps): Block {
  return block((parent, anchor) => {
    const failure = state<{ error: unknown } | null>(null);
    const attempt = state(0);

    const region = (): Child => {
      const failed = failure();
      if (failed) {
        return props.fallback(failed.error, () => {
          failure.set(null);
          attempt.update((n) => n + 1);
        });
      }
      // `attempt` is read to force a rebuild after `retry`.
      void attempt();
      try {
        return props.children();
      } catch (error) {
        props.onError?.(error);
        // The signal is written outside the current cycle, otherwise we'd
        // invalidate the region right while it is being evaluated.
        queueMicrotask(() => failure.set({ error }));
        return null;
      }
    };

    mountChild(parent, region, anchor);
  });
}
