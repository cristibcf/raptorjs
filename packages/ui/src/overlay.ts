/**
 * Dialog / ConfirmDialog / Popover / Tooltip - overlay-uri.
 *
 * Toate se sprijina pe primitivele din valul 1: `Portal` (ca sa nu fie taiate de
 * `overflow` sau `z-index`-ul unui parinte), `focusTrap`, `clickOutside` si
 * `positioner` (flip + shift, ca sa nu iasa din ecran).
 *
 * Cand sunt inchise NU exista noduri pentru ele - sunt montate prin `Show`.
 */
import { state, effect, onCleanup, type Accessor, type State } from "@raptor/core";
import { R, Show, type Child } from "@raptor/dom";
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
 * Blochează scroll-ul paginii cat timp un overlay modal e deschis.
 *
 * Contorul e global si NU per-dialog: cu doua dialoguri suprapuse, inchiderea
 * celui de deasupra nu trebuie sa redea scroll-ul cat timp cel de dedesubt e
 * inca deschis. Fara contor, exact asta se intampla.
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
  /** Inchide la Escape. Implicit `true`. */
  closeOnEscape?: boolean;
  /** Inchide la click pe fundal. Implicit `true`. */
  closeOnBackdrop?: boolean;
  /** Ascunde butonul ✕ din colt. */
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

  // Scroll lock si Escape traiesc doar cat e deschis.
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
                  // Doar clickul PE fundal, nu cel scapat din panou.
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
                      "aria-label": "Închide",
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
  /** `danger` pentru actiuni distructive. Implicit `primary`. */
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
    title: props.title ?? "Confirmare",
    size: "sm",
    onClose: props.onCancel,
    children: R.p({ class: "rui-confirm-message" }, props.message),
    footer: R.div(
      { class: "rui-confirm-actions" },
      Button({ variant: "ghost", onClick: cancel, children: props.cancelLabel ?? "Anulează" }),
      Button({
        variant: props.variant ?? "primary",
        onClick: confirm,
        children: props.confirmLabel ?? "Confirmă",
      }),
    ),
  });
}

export interface PopoverProps {
  /** Elementul declansator. Primeste props de trigger. */
  trigger: (props: Record<string, unknown>) => El;
  children: Child;
  open?: State<boolean>;
  placement?: Placement;
  offset?: number;
  /** Inchide la click in afara. Implicit `true`. */
  closeOnOutside?: boolean;
  label?: string;
  class?: string;
}

export function Popover(props: PopoverProps): El {
  // Constructia nu aboneaza computatia apelantului; vezi `isolate`.
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
  /** Elementul care primeste tooltipul. */
  trigger: (props: Record<string, unknown>) => El;
  content: Child;
  placement?: Placement;
  /** Intarziere la afisare, in ms. Implicit 400. */
  delay?: number;
  class?: string;
}

/**
 * Tooltip - text ajutator la hover SAU la focus.
 *
 * Focusul conteaza: un tooltip doar pe hover e invizibil pentru cine navigheaza
 * la tastatura. Continutul e legat prin `aria-describedby`, nu `aria-label` -
 * un tooltip descrie, nu inlocuieste numele elementului.
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

  // Escape ascunde tooltipul chiar daca mouse-ul e inca deasupra (cerinta WCAG).
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
