/**
 * Toast / Toaster - notificari temporare, cu coada.
 *
 * `createToaster()` intoarce un magazin pe care il detii tu; `Toaster` doar il
 * randeaza. Asta inseamna ca poti anunta ceva din afara arborelui de componente
 * (dintr-un handler de retea, dintr-un worker) fara sa cauti un context.
 *
 * Cronometrele se pun in pauza la hover: altfel un mesaj citit pe jumatate
 * dispare exact cand utilizatorul intinde mana dupa butonul de actiune.
 */
import { state, onCleanup, type Accessor } from "@raptor/core";
import { R, For, Show, type Child } from "@raptor/dom";
import { Portal } from "./primitives/portal.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title?: Child;
  message: Child;
  kind?: ToastKind;
  /** Ms pana la disparitie. `0` = ramane pana la inchidere manuala. */
  duration?: number;
  /** Buton de actiune (ex. "Anulează"). */
  action?: { label: Child; onClick: () => void };
  /** Cheie de deduplicare: un al doilea toast cu aceeasi cheie il inlocuieste. */
  key?: string;
}

export interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  duration: number;
}

export interface Toaster {
  toasts: Accessor<readonly ToastItem[]>;
  /** Adauga un toast. Intoarce id-ul, pentru inchidere programatica. */
  push: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
  /** Scurtaturi. */
  info: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  success: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  warning: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  error: (message: Child, options?: Omit<ToastOptions, "message" | "kind">) => number;
  /** Pauza/reluare pentru toate cronometrele (folosit de hover). */
  pause: () => void;
  resume: () => void;
}

export interface ToasterOptions {
  /** Durata implicita in ms. Implicit 4000. */
  duration?: number;
  /** Cate se afiseaza simultan; cele vechi ies primele. Implicit 5. */
  max?: number;
}

export function createToaster(options?: ToasterOptions): Toaster {
  const defaultDuration = options?.duration ?? 4000;
  const max = options?.max ?? 5;
  const toasts = state<readonly ToastItem[]>([]);

  /** Cronometru per toast, cu timpul ramas pastrat la pauza. */
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
      // Deduplicare pe cheie: inlocuim in loc sa stivuim acelasi mesaj.
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
      // Peste limita: ies cele mai vechi.
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
        // `polite`, nu `assertive`: un toast nu trebuie sa intrerupa cititorul
        // in mijlocul propozitiei. Erorile critice merg in Dialog, nu in toast.
        role: "region",
        "aria-live": "polite",
        "aria-label": "Notificări",
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
              "aria-label": "Închide notificarea",
              "on:click": () => t.dismiss(item.id),
            }, "✕"),
          ),
      }),
    ),
  });
}
