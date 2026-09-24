/**
 * @raptor/core - API public de reactivitate (whitepaper sectiunea 32.1).
 *
 * Primitive: state, derived, effect, batch, untracked + ownership.
 * Semnalele sunt accesori apelabili: `count()` citeste, `count.set(v)` scrie.
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
  /** Comparator de egalitate; `false` forteaza notificare mereu. */
  equal?: ((a: T, b: T) => boolean) | false;
}

/** Un semnal mutabil (whitepaper: state<T>). */
export interface State<T> {
  (): T;
  set(value: T): void;
  update(fn: (prev: T) => T): void;
  /** Citeste fara a inregistra dependenta. */
  peek(): T;
}

/** O valoare derivata read-only (whitepaper: derived<T>). */
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

/** Creeaza un semnal de stare locala mutabila. */
export function state<T>(initial: T, options?: StateOptions<T>): State<T> {
  const node = createSignalNode(initial, resolveEquals(options?.equal));
  const accessor = (() => readNode(node)) as State<T>;
  accessor.set = (value: T) => writeNode(node, value);
  accessor.update = (fn: (prev: T) => T) => writeNode(node, fn(node.value as T));
  accessor.peek = () => node.value as T;
  return accessor;
}

/** Creeaza o valoare derivata lazy si memoizata. */
export function derived<T>(compute: () => T, options?: StateOptions<T>): Derived<T> {
  const node = createMemoNode(compute, resolveEquals(options?.equal));
  const accessor = (() => readNode(node)) as Derived<T>;
  accessor.peek = () => peekNode(node);
  return accessor;
}

/** Alias idiomatic pentru derived (memo). */
export const memo = derived;

/** Ruleaza un side-effect care se re-executa cand dependentele se schimba. */
export function effect(fn: () => void): Dispose {
  const node = createEffectNode(fn);
  return () => disposeNode(node);
}

/** Grupeaza scrieri: effects ruleaza o singura data la final. */
export function batch<T>(fn: () => T): T {
  return batchImpl(fn);
}

/** Citeste semnale fara a inregistra dependente. */
export function untracked<T>(fn: () => T): T {
  return untrackedImpl(fn);
}

/** Creeaza un scope-radacina cu dispose manual (util pentru mount). */
export function createRoot<T>(fn: (dispose: Dispose) => T): T {
  return createRootImpl(fn);
}

/** Inregistreaza un cleanup pe owner-ul curent. */
export function onCleanup(fn: Cleanup): void {
  onCleanupImpl(fn);
}

export function getOwner(): Owner | null {
  return getOwnerImpl();
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  return runWithOwnerImpl(owner, fn);
}
