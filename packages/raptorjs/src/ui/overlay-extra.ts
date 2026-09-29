/**
 * Drawer / ContextMenu / Notification / Backdrop / ErrorBoundary.
 *
 * Completeaza setul de overlay-uri din valul 3. Toate reutilizeaza `Portal`,
 * `focusTrap`, `clickOutside` si `positioner`.
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
  /** Aplica `backdrop-filter: blur`. */
  blur?: boolean;
  /** `z-index`. Implicit 90. */
  level?: number;
  children?: Child;
  class?: string;
}

/** Fundal pentru overlay-uri proprii. Decorativ: `aria-hidden`. */
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

/** Contor global de scroll-lock, comun cu `Dialog` (vezi overlay.ts). */
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
  /** Din ce parte intra. Implicit `right`. */
  side?: "left" | "right" | "top" | "bottom";
  size?: string;
  /** Panou care NU blocheaza pagina de dedesubt (fara focus trap, fara lock). */
  modeless?: boolean;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  onClose?: () => void;
  label?: string;
  class?: string;
}

/**
 * Drawer - panou lateral.
 *
 * `modeless: true` il face un panou obisnuit (filtre, detalii): fara focus
 * trap, fara blocarea scroll-ului, fara `aria-modal`. Un sertar de filtre care
 * blocheaza restul paginii e o greseala frecventa si enervanta.
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
            "aria-label": "Închide",
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
  /** Continutul pe care se face click dreapta. Primeste props de zona. */
  children: (props: Record<string, unknown>) => El;
  label?: string;
  class?: string;
}

function isEntry(item: ContextMenuItem): item is ContextMenuEntry {
  return (item as { separator?: true }).separator !== true;
}

/**
 * ContextMenu - meniu la click dreapta.
 *
 * Deschis si de tasta Menu / Shift+F10, nu doar de mouse: altfel e inaccesibil
 * la tastatura. Pozitia vine din `positioner`, hranit cu un dreptunghi de un
 * pixel la locul cursorului - asa flip-ul si shift-ul functioneaza la fel ca
 * pentru orice alt overlay.
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
    // Cursorul e un dreptunghi de 1x1: restul logicii e a `positioner`-ului.
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
      // Tasta Menu sau Shift+F10: aceeasi actiune, fara mouse.
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
  /** Actiuni in josul notificarii. */
  actions?: Child;
  onDismiss?: () => void;
  /** Data/ora afisata discret. */
  timestamp?: Child;
  /** Marcheaza ca necitita (punct colorat). */
  unread?: Accessor<boolean>;
  class?: string;
}

/**
 * Notification - notificare persistenta, spre deosebire de `Toast`.
 *
 * Nu dispare singura si nu are `aria-live`: locul ei e o lista de notificari pe
 * care utilizatorul o deschide. Un `aria-live` pe fiecare element dintr-o lista
 * de 40 ar face screen readerul sa citeasca tot la fiecare deschidere.
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
      children: R.span({ class: "rui-notification-dot", "aria-label": "Necitită" }),
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
            "aria-label": "Închide notificarea",
            "on:click": props.onDismiss,
          },
          "✕",
        )
      : null,
  );
}

/* --------------------------------------------------------- ErrorBoundary -- */

export interface ErrorBoundaryProps {
  /** Construieste continutul. Apelat in `try`. */
  children: () => Child;
  /** Ce se afiseaza la eroare. Primeste eroarea si o functie de reincercare. */
  fallback: (error: unknown, retry: () => void) => Child;
  onError?: (error: unknown) => void;
}

/**
 * ErrorBoundary - prinde erorile de CONSTRUIRE a unui subarbore.
 *
 * **Ce prinde:** exceptiile aruncate sincron cand `children()` isi construieste
 * nodurile, inclusiv la o reconstruire dupa `retry()`.
 *
 * **Ce NU prinde**, si nici nu poate:
 * - erori din handlere de evenimente (`on:click`) - prinde-le acolo;
 * - erori din promisiuni respinse - trateaza-le cu `.catch`;
 * - erori aparute mai tarziu intr-un `effect` dintr-un binding deja montat.
 *
 * Intr-un runtime fine-grained nu exista o faza de randare care sa poata fi
 * reluata: dupa montare, fiecare binding are propriul ciclu de viata. Promitem
 * doar ce putem tine.
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
      // `attempt` e citit ca sa forteze reconstruirea dupa `retry`.
      void attempt();
      try {
        return props.children();
      } catch (error) {
        props.onError?.(error);
        // Semnalul e scris in afara ciclului curent, altfel am invalida
        // regiunea chiar in timpul evaluarii ei.
        queueMicrotask(() => failure.set({ error }));
        return null;
      }
    };

    mountChild(parent, region, anchor);
  });
}
