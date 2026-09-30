/**
 * The native app lifecycle (roadmap section 6).
 *
 * Desktop and mobile share the same vocabulary of states, but not the same
 * paths: a phone can suspend the app without closing it, a desktop usually
 * cannot. The machine below is shared, and the adapters say which transitions
 * they use - that way the app writes its lifecycle logic only once.
 */
import { HostError } from "./errors.ts";

export const LIFECYCLE_STATES = ["launching", "ready", "foreground", "background", "suspended", "stopped"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** The legal transitions; any other jump is a host error, not a new state. */
const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  launching: ["ready", "stopped"],
  ready: ["foreground", "stopped"],
  foreground: ["background", "stopped"],
  background: ["foreground", "suspended", "stopped"],
  suspended: ["foreground", "stopped"],
  stopped: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The shortest legal path between two states, or `null` if none exists.
 *
 * The adapters need this because real events do not arrive in the order of the
 * diagram: a board may get the sleep request after the first read as well as
 * after the tenth, and a service may be drained before it ever started serving.
 * Without a computed path, every adapter would guess the sequence of
 * transitions - and get it wrong in exactly the rarer cases.
 */
export function pathTo(from: LifecycleState, to: LifecycleState): readonly LifecycleState[] | null {
  if (from === to) return [];
  const queue: Array<{ state: LifecycleState; path: LifecycleState[] }> = [{ state: from, path: [] }];
  const seen = new Set<LifecycleState>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of TRANSITIONS[current.state]) {
      if (seen.has(next)) continue;
      const path = [...current.path, next];
      if (next === to) return path;
      seen.add(next);
      queue.push({ state: next, path });
    }
  }
  return null;
}

export interface LifecycleMachine {
  readonly state: LifecycleState;
  readonly history: readonly LifecycleState[];
  /** Applies the transition or throws `raptor:host/lifecycle`. */
  to(next: LifecycleState, reason?: string): LifecycleState;
  /** `true` if the transition was applied; `false` if it was already there. */
  settle(next: LifecycleState, reason?: string): boolean;
  /**
   * Walks up to `target` along the legal path, whatever the current state is.
   * Returns the states it passed through; throws if `target` is unreachable.
   */
  advanceTo(target: LifecycleState, reason?: string): readonly LifecycleState[];
  onChange(listener: (state: LifecycleState, reason: string) => void): void;
}

export function createLifecycle(initial: LifecycleState = "launching"): LifecycleMachine {
  let state: LifecycleState = initial;
  const history: LifecycleState[] = [initial];
  const listeners: Array<(state: LifecycleState, reason: string) => void> = [];

  // A local function, not a method: `settle` uses it without depending on
  // `this`, so the machine stays correct even when destructured.
  const to = (next: LifecycleState, reason: string): LifecycleState => {
    if (!canTransition(state, next)) {
      throw new HostError("raptor:host/lifecycle", `invalid transition: ${state} -> ${next}`, {
        from: state,
        to: next,
        allowed: [...TRANSITIONS[state]],
      });
    }
    state = next;
    history.push(next);
    for (const listener of [...listeners]) listener(next, reason);
    return state;
  };

  return {
    get state(): LifecycleState {
      return state;
    },
    get history(): readonly LifecycleState[] {
      return history;
    },
    to(next: LifecycleState, reason = "host"): LifecycleState {
      return to(next, reason);
    },
    settle(next: LifecycleState, reason = "host"): boolean {
      if (state === next) return false;
      to(next, reason);
      return true;
    },
    advanceTo(target: LifecycleState, reason = "host"): readonly LifecycleState[] {
      const path = pathTo(state, target);
      if (path === null) {
        throw new HostError("raptor:host/lifecycle", `no path from ${state} to ${target}`, {
          from: state,
          to: target,
        });
      }
      for (const step of path) to(step, reason);
      return path;
    },
    onChange(listener: (state: LifecycleState, reason: string) => void): void {
      listeners.push(listener);
    },
  };
}
