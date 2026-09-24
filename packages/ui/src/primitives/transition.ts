/**
 * Transition - monteaza/demonteaza continut cu faze de enter/exit.
 *
 * Diferenta fata de `Show`: la inchidere nodul NU dispare imediat, ci primeste
 * clasa de exit si e scos dupa `duration`. Fara asta orice animatie de iesire
 * e imposibila - nodul nu mai exista cand ar trebui sa se animeze.
 *
 * Daca `duration` e 0 se comporta exact ca `Show` (fara timere, deci sigur in
 * teste si pe server).
 */
import { state, effect, onCleanup, type Accessor } from "@raptor/core";
import { Show, type Block, type Child } from "@raptor/dom";
import { isolate } from "./isolate.ts";

export interface TransitionProps {
  when: Accessor<unknown>;
  children: Child;
  fallback?: Child;
  /** Prefix de clase: `<name>-enter` / `<name>-exit`. Implicit `rui`. */
  name?: string;
  /** Milisecunde cat ramane montat dupa inchidere. Implicit 0. */
  duration?: number;
}

export function Transition(props: TransitionProps): Block {
  // Constructia nu aboneaza computatia apelantului; vezi `isolate`.
  return isolate(() => TransitionImpl(props));
}

function TransitionImpl(props: TransitionProps): Block {
  const duration = props.duration ?? 0;
  if (duration <= 0) {
    return Show({ when: () => props.when(), children: props.children, fallback: props.fallback });
  }

  // `visible` urmeaza `when` la deschidere, dar ramane `true` pe durata iesirii.
  const visible = state(Boolean(props.when()));
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  effect(() => {
    const open = Boolean(props.when());
    clear();
    if (open) {
      visible.set(true);
      return;
    }
    if (!visible.peek()) return;
    timer = setTimeout(() => {
      timer = null;
      visible.set(false);
    }, duration);
  });

  onCleanup(clear);

  return Show({ when: () => visible(), children: props.children, fallback: props.fallback });
}

/** Clasa de stare pentru un element aflat in tranzitie. */
export function transitionClass(base: string, open: Accessor<unknown>, name = "rui"): Accessor<string> {
  return () => `${base} ${name}-${open() ? "enter" : "exit"}`;
}
