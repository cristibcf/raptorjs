/**
 * Primitive de stare: persistedState, undoRedo, selectionState, idle, networkStatus.
 *
 * Nu randeaza nimic; sunt semnale cu comportament. Sunt aici fiindca fiecare
 * aplicatie le rescrie, si de fiecare data cu aceleasi trei bug-uri:
 * localStorage care arunca in mod privat, un istoric de undo care creste la
 * infinit, si o selectie cu Shift care se strica atunci cand lista se filtreaza.
 */
import { state, derived, onCleanup, untracked, type Accessor, type State } from "raptorjs";
import { onDoc } from "./env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------------------------------------- persistedState */

export interface PersistOptions<T> {
  /** Serializare proprie. Implicit JSON. */
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
  /** `localStorage` (implicit) sau `sessionStorage`. */
  session?: boolean;
  /** Sincronizeaza intre file. Implicit `true`. */
  syncTabs?: boolean;
}

function storage(session: boolean): any | null {
  try {
    // Accesul insusi poate arunca: mod privat, cookies blocate, iframe sandbox.
    return (globalThis as any)[session ? "sessionStorage" : "localStorage"] ?? null;
  } catch {
    return null;
  }
}

/**
 * Un semnal care se salveaza singur.
 *
 * Daca stocarea nu e disponibila sau valoarea salvata e coruptă, cade curat pe
 * `initial` - o aplicatie nu trebuie sa pice fiindca cineva a editat manual
 * localStorage sau navigheaza in mod privat.
 */
export function persistedState<T>(key: string, initial: T, options?: PersistOptions<T>): State<T> {
  const store = storage(options?.session ?? false);
  const serialize = options?.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize = options?.deserialize ?? ((raw: string) => JSON.parse(raw) as T);

  let start = initial;
  if (store) {
    try {
      const raw = store.getItem(key);
      if (raw !== null) start = deserialize(raw);
    } catch {
      start = initial; // valoare coruptă: o ignoram, nu aruncam
    }
  }

  const signal = state<T>(start);
  if (!store) return signal;

  const write = (value: T): void => {
    try {
      store.setItem(key, serialize(value));
    } catch {
      /* cota depasita sau stocare read-only */
    }
  };

  // Interceptam scrierile in loc sa folosim un effect: asa nu scriem in
  // storage la montare, cand valoarea vine chiar de acolo.
  const set = signal.set;
  const update = signal.update;
  signal.set = (value: T) => {
    set(value);
    write(value);
  };
  signal.update = (fn: (prev: T) => T) => {
    update(fn);
    write(untracked(() => signal()));
  };

  if (options?.syncTabs !== false && typeof (globalThis as any).addEventListener === "function") {
    const onStorage = (e: any): void => {
      if (e.key !== key) return;
      try {
        set(e.newValue === null ? initial : deserialize(e.newValue));
      } catch {
        /* alta filă a scris ceva ce nu putem citi */
      }
    };
    (globalThis as any).addEventListener("storage", onStorage);
    onCleanup(() => (globalThis as any).removeEventListener?.("storage", onStorage));
  }

  return signal;
}

/* ---------------------------------------------------------------- undoRedo */

export interface UndoRedoOptions {
  /** Cate stari se pastreaza. Implicit 100. */
  limit?: number;
}

export interface UndoRedo<T> {
  value: Accessor<T>;
  /** Scrie o stare noua in istoric. */
  set: (value: T) => void;
  /** Modifica fara sa creeze intrare noua (ex. in timpul unui drag). */
  replace: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  clear: () => void;
  /** Cate intrari sunt in urma si in fata. */
  size: Accessor<{ past: number; future: number }>;
}

/**
 * Istoric cu undo/redo.
 *
 * Limita e obligatorie, nu optionala: un editor lasat deschis o zi cu istoric
 * nelimitat tine in memorie fiecare stare intermediara. Cand se depaseste,
 * cele mai vechi intrari sunt uitate.
 */
export function undoRedo<T>(initial: T, options?: UndoRedoOptions): UndoRedo<T> {
  const limit = Math.max(1, options?.limit ?? 100);
  const past = state<readonly T[]>([]);
  const present = state<T>(initial);
  const future = state<readonly T[]>([]);

  const set = (value: T): void => {
    const current = present.peek();
    if (value === current) return;
    past.update((prev) => {
      const next = [...prev, current];
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
    present.set(value);
    // O actiune noua invalideaza redo-ul: ramura veche nu mai e accesibila.
    future.set([]);
  };

  const replace = (value: T): void => present.set(value);

  const undo = (): void => {
    const prev = past.peek();
    if (prev.length === 0) return;
    const last = prev[prev.length - 1]!;
    past.set(prev.slice(0, -1));
    future.update((f) => [present.peek(), ...f]);
    present.set(last);
  };

  const redo = (): void => {
    const next = future.peek();
    if (next.length === 0) return;
    const first = next[0]!;
    future.set(next.slice(1));
    past.update((p) => [...p, present.peek()]);
    present.set(first);
  };

  const clear = (): void => {
    past.set([]);
    future.set([]);
  };

  return {
    value: () => present(),
    set,
    replace,
    undo,
    redo,
    canUndo: derived(() => past().length > 0),
    canRedo: derived(() => future().length > 0),
    clear,
    size: derived(() => ({ past: past().length, future: future().length })),
  };
}

/* ---------------------------------------------------------- selectionState */

export interface SelectionOptions<T> {
  /** Lista curenta, in ordinea afisata. Necesara pentru Shift+click. */
  items: Accessor<readonly T[]>;
  multiple?: boolean;
}

export interface SelectionState<T> {
  selected: Accessor<ReadonlySet<T>>;
  isSelected: (item: T) => boolean;
  /**
   * Click cu modificatori, ca intr-un manager de fisiere:
   * simplu = doar el, Ctrl/Cmd = comuta, Shift = interval de la ancora.
   */
  click: (item: T, modifiers?: { shift?: boolean; meta?: boolean }) => void;
  toggle: (item: T) => void;
  selectAll: () => void;
  clear: () => void;
  /** `true` daca toate elementele din lista curenta sunt selectate. */
  allSelected: Accessor<boolean>;
  count: Accessor<number>;
}

export function selectionState<T>(options: SelectionOptions<T>): SelectionState<T> {
  const selected = state<ReadonlySet<T>>(new Set());
  const multiple = options.multiple !== false;
  /** Ultimul element clicat fara Shift; capatul fix al intervalului. */
  let anchor: T | null = null;

  const isSelected = (item: T): boolean => selected().has(item);

  const toggle = (item: T): void => {
    selected.update((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
    anchor = item;
  };

  const click = (item: T, modifiers?: { shift?: boolean; meta?: boolean }): void => {
    if (!multiple) {
      selected.set(new Set([item]));
      anchor = item;
      return;
    }

    if (modifiers?.shift && anchor !== null) {
      const list = options.items();
      const from = list.indexOf(anchor);
      const to = list.indexOf(item);
      // Ancora poate sa nu mai fie in lista dupa o filtrare: atunci tratam
      // clickul ca unul simplu, in loc sa selectam un interval aiurea.
      if (from === -1 || to === -1) {
        selected.set(new Set([item]));
        anchor = item;
        return;
      }
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      selected.set(new Set(list.slice(lo, hi + 1)));
      return; // Shift NU muta ancora
    }

    if (modifiers?.meta) {
      toggle(item);
      return;
    }

    selected.set(new Set([item]));
    anchor = item;
  };

  const selectAll = (): void => {
    if (!multiple) return;
    selected.set(new Set(options.items()));
  };

  const clear = (): void => {
    selected.set(new Set());
    anchor = null;
  };

  const allSelected = derived(() => {
    const list = options.items();
    const current = selected();
    return list.length > 0 && list.every((item) => current.has(item));
  });

  return {
    selected: () => selected(),
    isSelected,
    click,
    toggle,
    selectAll,
    clear,
    allSelected,
    count: derived(() => selected().size),
  };
}

/* ------------------------------------------------------------------ idle -- */

export interface IdleOptions {
  /** Ms de inactivitate dupa care utilizatorul e considerat inactiv. */
  timeout?: number;
  /** Evenimente care resetează cronometrul. */
  events?: readonly string[];
}

/**
 * `idle()` - `true` cand utilizatorul n-a mai facut nimic de `timeout` ms.
 *
 * Util pentru auto-logout sau pentru a opri polling-ul cand nimeni nu se uita.
 * Resetarea se face pe un set mic de evenimente; a asculta absolut tot ar
 * insemna sa rulezi cod la fiecare pixel de scroll.
 */
export function idle(options?: IdleOptions): Accessor<boolean> {
  const timeout = options?.timeout ?? 60_000;
  const isIdle = state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reset = (): void => {
    if (timer !== null) clearTimeout(timer);
    if (isIdle.peek()) isIdle.set(false);
    timer = setTimeout(() => {
      timer = null;
      isIdle.set(true);
    }, timeout);
  };

  const events = options?.events ?? ["pointerdown", "keydown", "scroll", "focus"];
  for (const type of events) onCleanup(onDoc(type, reset));
  onCleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });
  reset();

  return () => isIdle();
}

/* --------------------------------------------------------- networkStatus -- */

export interface NetworkStatus {
  online: Accessor<boolean>;
  /** Momentul ultimei schimbari, sau `null`. */
  since: Accessor<number | null>;
}

/**
 * `networkStatus()` - starea conexiunii ca semnal.
 *
 * `navigator.onLine` spune doar daca exista o interfata de retea activa, nu
 * daca serverul tau raspunde: `true` nu garanteaza nimic, dar `false` e de
 * incredere. Foloseste-l ca sa afisezi un banner, nu ca sa decizi daca merita
 * sa incerci o cerere.
 */
export function networkStatus(): NetworkStatus {
  const nav: any = (globalThis as any).navigator;
  const online = state<boolean>(typeof nav?.onLine === "boolean" ? nav.onLine : true);
  const since = state<number | null>(null);

  const target: any = globalThis as any;
  if (typeof target.addEventListener === "function") {
    const up = (): void => {
      online.set(true);
      since.set(Date.now());
    };
    const down = (): void => {
      online.set(false);
      since.set(Date.now());
    };
    target.addEventListener("online", up);
    target.addEventListener("offline", down);
    onCleanup(() => {
      target.removeEventListener?.("online", up);
      target.removeEventListener?.("offline", down);
    });
  }

  return { online: () => online(), since: () => since() };
}
