/**
 * Dialog / ConfirmDialog / Popover / Tooltip - overlays.
 *
 * They all rely on the wave 1 primitives: `Portal` (so they aren't clipped by a
 * parent's `overflow` or `z-index`), `focusTrap`, `clickOutside` and
 * `positioner` (flip + shift, so they don't go off screen).
 *
 * When closed there are NO nodes for them - they're mounted via `Show`.
 */
import { state, effect, onCleanup, type Accessor, type State } from "raptorjs";
import { R, Show, type Child } from "raptorjs/dom";
import { Portal } from "./primitives/portal.ts";
import { focusTrap } from "./primitives/focus-trap.ts";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { onDoc, focus, type El } from "./primitives/env.ts";
import { Button, type ButtonVariant } from "./button.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/**
 * Locks page scroll while a modal overlay is open.
 *
 * The counter is global and NOT per-dialog: with two stacked dialogs, closing
 * the top one must not restore scroll while the one underneath is still open.
 * Without a counter, that's exactly what happens.
 */
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

export interface DialogProps {
  open: State<boolean>;
  title?: Child;
  children: Child;
  footer?: Child;
  /** Close on Escape. Defaults to `true`. */
  closeOnEscape?: boolean;
  /** Close on backdrop click. Defaults to `true`. */
  closeOnBackdrop?: boolean;
  /** Hides the ✕ button in the corner. */
  hideClose?: boolean;
  size?: "sm" | "md" | "lg" | "full";
  onClose?: () => void;
  label?: string;
  class?: string;
}

export function Dialog(props: DialogProps): Child {
  const id = "rui-dlg-" + ++idSeq;

  const close = (): void => {
    props.open.set(false);
    props.onClose?.();
  };

  // Scroll lock and Escape live only while it's open.
  effect(() => {
    if (!props.open()) return;
    const unlock = lockScroll();
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

  return Show({
    when: () => props.open(),
    children: Portal({
      children: R.div(
        {
          class: "rui-dialog-backdrop",
          ...(props.closeOnBackdrop === false
            ? {}
            : {
                "on:click": (e: any) => {
                  // Only the click ON the backdrop, not one leaking from the panel.
                  if (e.target === e.currentTarget) close();
                },
              }),
        },
        R.div(
          {
            class: () =>
              "rui-dialog rui-dialog-" + (props.size ?? "md") + (props.class ? " " + props.class : ""),
            role: "dialog",
            "aria-modal": "true",
            ...(props.title !== undefined ? { "aria-labelledby": id + "-title" } : {}),
            ...(props.label ? { "aria-label": props.label } : {}),
            ref: focusTrap(),
          },
          props.title !== undefined || !props.hideClose
            ? R.div(
                { class: "rui-dialog-head" },
                props.title !== undefined
                  ? R.h2({ id: id + "-title", class: "rui-dialog-title" }, props.title)
                  : null,
                props.hideClose
                  ? null
                  : R.button({
                      type: "button",
                      class: "rui-dialog-close",
                      "aria-label": "Close",
                      "on:click": close,
                    }, "✕"),
              )
            : null,
          R.div({ class: "rui-dialog-body" }, props.children),
          props.footer !== undefined ? R.div({ class: "rui-dialog-foot" }, props.footer) : null,
        ),
      ),
    }),
  });
}

export interface ConfirmDialogProps {
  open: State<boolean>;
  title?: Child;
  message: Child;
  confirmLabel?: Child;
  cancelLabel?: Child;
  /** `danger` for destructive actions. Defaults to `primary`. */
  variant?: ButtonVariant;
  onConfirm: () => void | Promise<unknown>;
  onCancel?: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): Child {
  const cancel = (): void => {
    props.open.set(false);
    props.onCancel?.();
  };

  const confirm = (): void | Promise<unknown> => {
    const result = props.onConfirm();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(() => props.open.set(false));
    }
    props.open.set(false);
    return undefined;
  };

  return Dialog({
    open: props.open,
    title: props.title ?? "Confirm",
    size: "sm",
    onClose: props.onCancel,
    children: R.p({ class: "rui-confirm-message" }, props.message),
    footer: R.div(
      { class: "rui-confirm-actions" },
      Button({ variant: "ghost", onClick: cancel, children: props.cancelLabel ?? "Cancel" }),
      Button({
        variant: props.variant ?? "primary",
        onClick: confirm,
        children: props.confirmLabel ?? "Confirm",
      }),
    ),
  });
}

export interface PopoverProps {
  /** The trigger element. Receives trigger props. */
  trigger: (props: Record<string, unknown>) => El;
  children: Child;
  open?: State<boolean>;
  placement?: Placement;
  offset?: number;
  /** Close on click outside. Defaults to `true`. */
  closeOnOutside?: boolean;
  label?: string;
  class?: string;
}

export function Popover(props: PopoverProps): El {
  // Construction doesn't subscribe the caller's computation; see `isolate`.
  return isolate(() => PopoverImpl(props));
}

function PopoverImpl(props: PopoverProps): El {
  const id = "rui-pop-" + ++idSeq;
  const open = props.open ?? state(false);
  let triggerEl: El = null;

  const pos = positioner({
    placement: props.placement ?? "bottom-start",
    offset: props.offset ?? 6,
    enabled: () => open(),
  });

  const close = (refocus: boolean): void => {
    open.set(false);
    if (refocus) focus(triggerEl);
  };

  effect(() => {
    if (!open()) return;
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") close(true);
    });
    onCleanup(unbind);
  });

  const trigger = props.trigger({
    ref: (el: El) => {
      triggerEl = el;
      pos.reference(el);
    },
    "aria-haspopup": "dialog",
    "aria-expanded": () => String(open()),
    "aria-controls": id,
    "on:click": (e: any) => {
      e.stopPropagation?.();
      open.set(!open.peek());
    },
  });

  return R.span(
    { class: "rui-popover-root" },
    trigger,
    Show({
      when: () => open(),
      children: Portal({
        children: R.div(
          {
            id,
            class: props.class ? "rui-popover " + props.class : "rui-popover",
            role: "dialog",
            ...(props.label ? { "aria-label": props.label } : {}),
            style: () => pos.style(),
            ref: (el: El) => {
              pos.floating(el);
              if (props.closeOnOutside !== false) {
                clickOutside(() => close(false), {
                  ignore: () => (triggerEl ? [triggerEl] : []),
                  enabled: () => open(),
                })(el);
              }
            },
          },
          props.children,
        ),
      }),
    }),
  );
}

export interface TooltipProps {
  /** The element that receives the tooltip. */
  trigger: (props: Record<string, unknown>) => El;
  content: Child;
  placement?: Placement;
  /** Show delay, in ms. Defaults to 400. */
  delay?: number;
  class?: string;
}

/**
 * Tooltip - helper text on hover OR on focus.
 *
 * Focus matters: a hover-only tooltip is invisible to keyboard users. The
 * content is linked via `aria-describedby`, not `aria-label` - a tooltip
 * describes, it doesn't replace the element's name.
 */
export function Tooltip(props: TooltipProps): El {
  const id = "rui-tip-" + ++idSeq;
  const open = state(false);
  const delay = props.delay ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pos = positioner({
    placement: props.placement ?? "top",
    offset: 6,
    enabled: () => open(),
  });

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  onCleanup(clear);

  const show = (): void => {
    clear();
    if (delay <= 0) {
      open.set(true);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      open.set(true);
    }, delay);
  };

  const hide = (): void => {
    clear();
    open.set(false);
  };

  // Escape hides the tooltip even if the mouse is still over it (WCAG requirement).
  effect(() => {
    if (!open()) return;
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") hide();
    });
    onCleanup(unbind);
  });

  const trigger = props.trigger({
    ref: pos.reference,
    "aria-describedby": () => (open() ? id : ""),
    "on:pointerenter": show,
    "on:pointerleave": hide,
    "on:focus": show,
    "on:blur": hide,
  });

  return R.span(
    { class: "rui-tooltip-root" },
    trigger,
    Show({
      when: () => open(),
      children: Portal({
        children: R.div(
          {
            id,
            class: props.class ? "rui-tooltip " + props.class : "rui-tooltip",
            role: "tooltip",
            style: () => pos.style(),
            ref: pos.floating,
          },
          props.content,
        ),
      }),
    }),
  );
}
