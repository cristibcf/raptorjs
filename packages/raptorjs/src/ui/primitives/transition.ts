/**
 * Transition - mounts/unmounts content with enter/exit phases.
 *
 * The difference from `Show`: on close the node does NOT disappear immediately,
 * but gets the exit class and is removed after `duration`. Without this any exit
 * animation is impossible - the node no longer exists when it should animate.
 *
 * If `duration` is 0 it behaves exactly like `Show` (no timers, so safe in tests
 * and on the server).
 */
import { state, effect, onCleanup, type Accessor } from "@raptorstack/raptorjs";
import { Show, type Block, type Child } from "@raptorstack/raptorjs/dom";
import { isolate } from "./isolate.ts";

export interface TransitionProps {
  when: Accessor<unknown>;
  children: Child;
  fallback?: Child;
  /** Class prefix: `<name>-enter` / `<name>-exit`. Defaults to `rui`. */
  name?: string;
  /** Milliseconds it stays mounted after close. Defaults to 0. */
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

/** State class for an element in transition. */
export function transitionClass(base: string, open: Accessor<unknown>, name = "rui"): Accessor<string> {
  return () => `${base} ${name}-${open() ? "enter" : "exit"}`;
}
