/**
 * Ciclul de viata al aplicatiei native (roadmap sectiunea 6).
 *
 * Desktop-ul si mobilul au acelasi vocabular de stari, dar nu aceleasi drumuri:
 * un telefon poate suspenda aplicatia fara sa o inchida, un desktop de obicei nu.
 * Masina de mai jos este comuna, iar adaptoarele spun ce tranzitii folosesc -
 * asa aplicatia scrie o singura data logica de lifecycle.
 */
import { HostError } from "./errors.ts";

export const LIFECYCLE_STATES = ["launching", "ready", "foreground", "background", "suspended", "stopped"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Tranzitiile legale; orice alt salt este o eroare de host, nu o stare noua. */
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
 * Drumul legal cel mai scurt intre doua stari, sau `null` daca nu exista.
 *
 * Adaptoarele au nevoie de asta pentru ca evenimentele reale nu vin in ordinea
 * din diagrama: o placheta poate primi cererea de somn si dupa prima citire, si
 * dupa a zecea, iar un serviciu poate fi drenat inainte sa fi inceput sa serveasca.
 * Fara un drum calculat, fiecare adaptor ar ghici secventa de tranzitii - si ar
 * gresi-o exact in cazurile mai rare.
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
  /** Aplica tranzitia sau arunca `raptor:host/lifecycle`. */
  to(next: LifecycleState, reason?: string): LifecycleState;
  /** `true` daca tranzitia a fost aplicata; `false` daca era deja acolo. */
  settle(next: LifecycleState, reason?: string): boolean;
  /**
   * Merge pana la `target` pe drumul legal, oricare ar fi starea curenta.
   * Intoarce starile prin care a trecut; arunca daca `target` este de neatins.
   */
  advanceTo(target: LifecycleState, reason?: string): readonly LifecycleState[];
  onChange(listener: (state: LifecycleState, reason: string) => void): void;
}

export function createLifecycle(initial: LifecycleState = "launching"): LifecycleMachine {
  let state: LifecycleState = initial;
  const history: LifecycleState[] = [initial];
  const listeners: Array<(state: LifecycleState, reason: string) => void> = [];

  // Functie locala, nu metoda: `settle` o foloseste fara sa depinda de `this`,
  // deci masina ramane corecta si destructurata.
  const to = (next: LifecycleState, reason: string): LifecycleState => {
    if (!canTransition(state, next)) {
      throw new HostError("raptor:host/lifecycle", `tranzitie invalida: ${state} -> ${next}`, {
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
        throw new HostError("raptor:host/lifecycle", `nu exista drum de la ${state} la ${target}`, {
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
