/**
 * @raptor/core - public reactivity API (whitepaper section 32.1).
 *
 * Primitives: state, derived, effect, batch, untracked + ownership.
 * Signals are callable accessors: `count()` reads, `count.set(v)` writes.
 */
import {
  type Cleanup,
  type Owner,
  createSignalNode,
  createMemoNode,
  createEffectNode,
  readNode,
  peekNode,
  writeNode,
  disposeNode,
  batch as batchImpl,
  untracked as untrackedImpl,
  createRoot as createRootImpl,
  onCleanup as onCleanupImpl,
  getOwner as getOwnerImpl,
  runWithOwner as runWithOwnerImpl,
  defaultEquals,
} from "./reactive.ts";

export type { Cleanup, Owner };

export interface StateOptions<T> {
  /** Equality comparator; `false` always forces a notification. */
  equal?: ((a: T, b: T) => boolean) | false;
}

/** A mutable signal (whitepaper: state<T>). */
export interface State<T> {
  (): T;
  set(value: T): void;
  update(fn: (prev: T) => T): void;
  /** Read without registering a dependency. */
  peek(): T;
}

/** A read-only derived value (whitepaper: derived<T>). */
export interface Derived<T> {
  (): T;
  peek(): T;
}

export type Accessor<T> = () => T;
export type Dispose = () => void;

function resolveEquals<T>(equal: StateOptions<T>["equal"]): (a: T, b: T) => boolean {
  if (equal === false) return () => false;
  return equal ?? (defaultEquals as (a: T, b: T) => boolean);
}

/** Create a mutable local-state signal. */
export function state<T>(initial: T, options?: StateOptions<T>): State<T> {
  const node = createSignalNode(initial, resolveEquals(options?.equal));
  const accessor = (() => readNode(node)) as State<T>;
  accessor.set = (value: T) => writeNode(node, value);
  accessor.update = (fn: (prev: T) => T) => writeNode(node, fn(node.value as T));
  accessor.peek = () => node.value as T;
  return accessor;
}

/** Create a lazy, memoized derived value. */
export function derived<T>(compute: () => T, options?: StateOptions<T>): Derived<T> {
  const node = createMemoNode(compute, resolveEquals(options?.equal));
  const accessor = (() => readNode(node)) as Derived<T>;
  accessor.peek = () => peekNode(node);
  return accessor;
}

/** Idiomatic alias for derived (memo). */
export const memo = derived;

/** Run a side-effect that re-executes when its dependencies change. */
export function effect(fn: () => void): Dispose {
  const node = createEffectNode(fn);
  return () => disposeNode(node);
}

/** Group writes: effects run only once at the end. */
export function batch<T>(fn: () => T): T {
  return batchImpl(fn);
}

/** Read signals without registering dependencies. */
export function untracked<T>(fn: () => T): T {
  return untrackedImpl(fn);
}

/** Create a root scope with manual dispose (useful for mount). */
export function createRoot<T>(fn: (dispose: Dispose) => T): T {
  return createRootImpl(fn);
}

/** Register a cleanup on the current owner. */
export function onCleanup(fn: Cleanup): void {
  onCleanupImpl(fn);
}

export function getOwner(): Owner | null {
  return getOwnerImpl();
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  return runWithOwnerImpl(owner, fn);
}
