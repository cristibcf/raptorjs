/**
 * Toast / Toaster - temporary notifications, with a queue.
 *
 * `createToaster()` returns a store you own; `Toaster` only renders it. This
 * means you can announce something from outside the component tree (from a
 * network handler, from a worker) without looking up a context.
 *
 * The timers pause on hover: otherwise a half-read message disappears exactly
 * when the user reaches for the action button.
 */
import { state, onCleanup, type Accessor } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { Portal } from "./primitives/portal.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title?: Child;
  message: Child;
  kind?: ToastKind;
  /** Ms until it disappears. `0` = stays until manually closed. */
  duration?: number;
  /** Action button (e.g. "Cancel"). */
  action?: { label: Child; onClick: () => void };
  /** Dedup key: a second toast with the same key replaces it. */
  key?: string;
}

export interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  duration: number;
}

export interface Toaster {
  toasts: Accessor<readonly ToastItem[]>;
  /** Adds a toast. Returns the id, for programmatic dismissal. */
  push: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
  /** Shortcuts. */
  info: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  success: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  warning: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  error: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  /** Pause/resume for all timers (used by hover). */
  pause: () => void;
  resume: () => void;
}

export interface ToasterOptions {
  /** Default duration in ms. Default 4000. */
  duration?: number;
  /** How many are shown at once; the old ones leave first. Default 5. */
  max?: number;
}

export function createToaster(options?: ToasterOptions): Toaster {
  const defaultDuration = options?.duration ?? 4000;
  const max = options?.max ?? 5;
  const toasts = state<readonly ToastItem[]>([]);

  /** A timer per toast, with the remaining time preserved on pause. */
  interface Timer {
    handle: ReturnType<typeof setTimeout> | null;
    remaining: number;
    startedAt: number;
  }
  const timers = new Map<number, Timer>();
  let seq = 0;
  let paused = false;

  const dismiss = (id: number): void => {
    const timer = timers.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    timers.delete(id);
    toasts.update((prev) => prev.filter((t) => t.id !== id));
  };

  const arm = (id: number, ms: number): void => {
    if (ms <= 0) return;
    const timer: Timer = { handle: null, remaining: ms, startedAt: Date.now() };
    timers.set(id, timer);
    if (paused) return;
    timer.handle = setTimeout(() => dismiss(id), ms);
  };

  const push = (opts: ToastOptions): number => {
    const id = ++seq;
    const item: ToastItem = {
      ...opts,
      id,
      kind: opts.kind ?? "info",
      duration: opts.duration ?? defaultDuration,
    };

    toasts.update((prev) => {
      // Dedup by key: we replace instead of stacking the same message.
      let next = opts.key ? prev.filter((t) => t.key !== opts.key) : prev.slice();
      if (opts.key) {
        for (const old of prev) {
          if (old.key === opts.key) {
            const timer = timers.get(old.id);
            if (timer?.handle) clearTimeout(timer.handle);
            timers.delete(old.id);
          }
        }
      }
      next = [...next, item];
      // Over the limit: the oldest ones leave.
      while (next.length > max) {
        const removed = next.shift();
        if (removed) {
          const timer = timers.get(removed.id);
          if (timer?.handle) clearTimeout(timer.handle);
          timers.delete(removed.id);
        }
      }
      return next;
    });

    arm(id, item.duration);
    return id;
  };

  const pause = (): void => {
    if (paused) return;
    paused = true;
    for (const timer of timers.values()) {
      if (!timer.handle) continue;
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
    }
  };

  const resume = (): void => {
    if (!paused) return;
    paused = false;
    for (const [id, timer] of timers) {
      if (timer.handle || timer.remaining <= 0) continue;
      timer.startedAt = Date.now();
      timer.handle = setTimeout(() => dismiss(id), timer.remaining);
    }
  };

  const clear = (): void => {
    for (const timer of timers.values()) if (timer.handle) clearTimeout(timer.handle);
    timers.clear();
    toasts.set([]);
  };

  onCleanup(clear);

  const shortcut =
    (kind: ToastKind) =>
    (message: Child, opts?: Omit<ToastOptions, "message" | "kind">): number =>
      push({ ...opts, message, kind });

  return {
    toasts: () => toasts(),
    push,
    dismiss,
    clear,
    pause,
    resume,
    info: shortcut("info"),
    success: shortcut("success"),
    warning: shortcut("warning"),
    error: shortcut("error"),
  };
}

export interface ToasterProps {
  toaster: Toaster;
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  class?: string;
}

export function Toaster(props: ToasterProps): Child {
  const t = props.toaster;

  return Portal({
    children: R.div(
      {
        class: () =>
          "rui-toaster rui-toaster-" + (props.position ?? "bottom-right") + (props.class ? " " + props.class : ""),
        // `polite`, not `assertive`: a toast shouldn't interrupt the reader
        // mid-sentence. Critical errors go in a Dialog, not a toast.
        role: "region",
        "aria-live": "polite",
        "aria-label": "Notifications",
        "on:pointerenter": () => t.pause(),
        "on:pointerleave": () => t.resume(),
      },
      For({
        each: () => t.toasts(),
        children: (item: ToastItem) =>
          R.div(
            {
              class: "rui-toast rui-toast-" + item.kind,
              role: item.kind === "error" ? "alert" : "status",
            },
            R.div(
              { class: "rui-toast-body" },
              item.title !== undefined ? R.div({ class: "rui-toast-title" }, item.title) : null,
              R.div({ class: "rui-toast-message" }, item.message),
            ),
            Show({
              when: () => item.action !== undefined,
              children: R.button(
                {
                  type: "button",
                  class: "rui-toast-action",
                  "on:click": () => {
                    item.action!.onClick();
                    t.dismiss(item.id);
                  },
                },
                item.action?.label ?? "",
              ),
            }),
            R.button({
              type: "button",
              class: "rui-toast-close",
              "aria-label": "Close notification",
              "on:click": () => t.dismiss(item.id),
            }, "✕"),
          ),
      }),
    ),
  });
}
