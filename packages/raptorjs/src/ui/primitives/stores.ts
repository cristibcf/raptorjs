/**
 * State primitives: persistedState, undoRedo, selectionState, idle, networkStatus.
 *
 * They render nothing; they are signals with behavior. They're here because
 * every app rewrites them, and every time with the same three bugs: localStorage
 * that throws in private mode, an undo history that grows without bound, and a
 * Shift selection that breaks when the list is filtered.
 */
import { state, derived, onCleanup, untracked, type Accessor, type State } from "raptorjs";
import { onDoc } from "./env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------------------------------------- persistedState */

export interface PersistOptions<T> {
  /** Custom serialization. Defaults to JSON. */
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
  /** `localStorage` (default) or `sessionStorage`. */
  session?: boolean;
  /** Sync across tabs. Defaults to `true`. */
  syncTabs?: boolean;
}

function storage(session: boolean): any | null {
  try {
    // The access itself can throw: private mode, blocked cookies, sandboxed iframe.
    return (globalThis as any)[session ? "sessionStorage" : "localStorage"] ?? null;
  } catch {
    return null;
  }
}

/**
 * A signal that saves itself.
 *
 * If storage isn't available or the saved value is corrupt, it falls back
 * cleanly to `initial` - an app must not crash because someone edited
 * localStorage by hand or is browsing in private mode.
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
      start = initial; // corrupt value: we ignore it, we don't throw
    }
  }

  const signal = state<T>(start);
  if (!store) return signal;

  const write = (value: T): void => {
    try {
      store.setItem(key, serialize(value));
    } catch {
      /* quota exceeded or read-only storage */
    }
  };

  // We intercept writes instead of using an effect: that way we don't write to
  // storage on mount, when the value comes from there in the first place.
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
        /* another tab wrote something we can't read */
      }
    };
    (globalThis as any).addEventListener("storage", onStorage);
    onCleanup(() => (globalThis as any).removeEventListener?.("storage", onStorage));
  }

  return signal;
}

/* ---------------------------------------------------------------- undoRedo */

export interface UndoRedoOptions {
  /** How many states are kept. Defaults to 100. */
  limit?: number;
}

export interface UndoRedo<T> {
  value: Accessor<T>;
  /** Writes a new state into the history. */
  set: (value: T) => void;
  /** Modify without creating a new entry (e.g. during a drag). */
  replace: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  clear: () => void;
  /** How many entries are behind and ahead. */
  size: Accessor<{ past: number; future: number }>;
}

/**
 * Undo/redo history.
 *
 * The limit is mandatory, not optional: an editor left open for a day with an
 * unbounded history keeps every intermediate state in memory. When it is
 * exceeded, the oldest entries are forgotten.
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
    // A new action invalidates redo: the old branch is no longer reachable.
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
  /** The current list, in display order. Needed for Shift+click. */
  items: Accessor<readonly T[]>;
  multiple?: boolean;
}

export interface SelectionState<T> {
  selected: Accessor<ReadonlySet<T>>;
  isSelected: (item: T) => boolean;
  /**
   * Click with modifiers, like in a file manager:
   * plain = only it, Ctrl/Cmd = toggle, Shift = range from the anchor.
   */
  click: (item: T, modifiers?: { shift?: boolean; meta?: boolean }) => void;
  toggle: (item: T) => void;
  selectAll: () => void;
  clear: () => void;
  /** `true` if all items in the current list are selected. */
  allSelected: Accessor<boolean>;
  count: Accessor<number>;
}

export function selectionState<T>(options: SelectionOptions<T>): SelectionState<T> {
  const selected = state<ReadonlySet<T>>(new Set());
  const multiple = options.multiple !== false;
  /** The last item clicked without Shift; the fixed end of the range. */
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
      // The anchor may no longer be in the list after a filter: in that case we
      // treat the click as a plain one, instead of selecting a nonsensical range.
      if (from === -1 || to === -1) {
        selected.set(new Set([item]));
        anchor = item;
        return;
      }
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      selected.set(new Set(list.slice(lo, hi + 1)));
      return; // Shift does NOT move the anchor
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
  /** Ms of inactivity after which the user is considered idle. */
  timeout?: number;
  /** Events that reset the timer. */
  events?: readonly string[];
}

/**
 * `idle()` - `true` when the user hasn't done anything for `timeout` ms.
 *
 * Useful for auto-logout or to stop polling when no one is looking. The reset
 * happens on a small set of events; listening to absolutely everything would
 * mean running code on every scroll pixel.
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
  /** The moment of the last change, or `null`. */
  since: Accessor<number | null>;
}

/**
 * `networkStatus()` - the connection state as a signal.
 *
 * `navigator.onLine` only tells you whether there is an active network
 * interface, not whether your server responds: `true` guarantees nothing, but
 * `false` is reliable. Use it to show a banner, not to decide whether a request
 * is worth attempting.
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
