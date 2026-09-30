/**
 * The Raptor reactive core - a fine-grained, glitch-free, pull-based graph for
 * memos (lazy) and push/eager for effects.
 *
 * The algorithm uses three states per node (CLEAN / CHECK / DIRTY) and
 * propagates "staleness" downstream when a signal changes. Memos recompute only
 * on read (updateIfNecessary), while effects are scheduled into a queue that is
 * flushed at the end of a batch. See whitepaper sections 6.3 and 7.
 */

// --- Node states -----------------------------------------------------------
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

export type Cleanup = () => void;

/** An "owner" holds child computations and cleanups (section 10). */
export interface Owner {
  owned: Node<any>[] | null;
  cleanups: Cleanup[] | null;
}

/** A single reactive node used for signal, memo and effect. */
export class Node<T> implements Owner {
  value: T | undefined;
  /** null for a source signal; set for memo/effect. */
  fn: (() => T) | null;
  state: number;
  sources: Node<any>[] | null = null;
  observers: Node<any>[] | null = null;
  equals: (a: T, b: T) => boolean;
  isEffect: boolean;
  // Owner
  owned: Node<any>[] | null = null;
  cleanups: Cleanup[] | null = null;
  owner: Owner | null;
  disposed = false;
  /** Buffer of dependencies collected in the current run (null when not running). */
  collect: Node<any>[] | null = null;
  /**
   * Collection buffer reused across runs. It never shrinks: `collectCount`
   * says how many entries are valid, the rest stay as reserve. A `length = 0`
   * would look equivalent, but it makes V8 release the backing store and
   * reallocate on the next push - measured ~25% slower than the counter
   * variant, and even slower than a fresh array per run.
   */
  scratch: Node<any>[] = [];
  /** How many entries in `scratch` are valid in the current run. */
  collectCount = 0;

  constructor(
    value: T | undefined,
    fn: (() => T) | null,
    isEffect: boolean,
    equals: (a: T, b: T) => boolean,
    owner: Owner | null,
  ) {
    this.value = value;
    this.fn = fn;
    this.isEffect = isEffect;
    this.equals = equals;
    this.owner = owner;
    this.state = fn === null ? CLEAN : DIRTY;
  }
}

// --- Global execution context ---------------------------------------------
let currentObserver: Node<any> | null = null;
let currentOwner: Owner | null = null;
let batchDepth = 0;
const effectQueue: Node<any>[] = [];
let flushScheduled = false;

export const defaultEquals = <T>(a: T, b: T): boolean => a === b;

// --- Dependency linking ----------------------------------------------------
// We collect dependencies into the observer's persistent buffer (O(n) dedup on
// small dep-sets) and only actually subscribe at reconciliation
// (`reconcileSources`). This way, when the dependency set does not change
// between runs — the common case for static chains — we do NOT touch the
// observer lists at all (no churn) and allocate nothing: we overwrite the old
// entries by index.
function link(observer: Node<any>, source: Node<any>): void {
  if (observer.collect === null) return;
  const buffer = observer.scratch;
  const count = observer.collectCount;
  for (let i = 0; i < count; i++) if (buffer[i] === source) return;
  if (count < buffer.length) buffer[count] = source;
  else buffer.push(source);
  observer.collectCount = count + 1;
}

function subscribe(observer: Node<any>, source: Node<any>): void {
  (source.observers ?? (source.observers = [])).push(observer);
}

function unlinkSources(node: Node<any>): void {
  const sources = node.sources;
  if (!sources) return;
  for (const source of sources) {
    const obs = source.observers;
    if (!obs) continue;
    const i = obs.indexOf(node);
    if (i !== -1) {
      obs[i] = obs[obs.length - 1]!;
      obs.pop();
    }
  }
  sources.length = 0;
}

/** true if the first `count` collected sources are identical (in order) to the current ones. */
function sameSources(old: Node<any>[] | null, next: Node<any>[], count: number): boolean {
  if (old === null) return count === 0;
  if (old.length !== count) return false;
  for (let i = 0; i < count; i++) if (old[i] !== next[i]) return false;
  return true;
}

/**
 * Apply the collected dependencies. If they are identical to the existing ones,
 * do nothing (fast path). Otherwise unsubscribe the old sources and subscribe
 * the new ones.
 */
function reconcileSources(node: Node<any>, collected: Node<any>[], count: number): void {
  if (sameSources(node.sources, collected, count)) return;
  unlinkSources(node);
  if (count > 0) {
    // Copy only when the dependencies really did change (rare): `collected` is
    // the node's persistent buffer and the next run would rewrite it out from
    // under the sources list.
    const sources = collected.slice(0, count);
    node.sources = sources;
    for (let i = 0; i < count; i++) subscribe(node, sources[i]!);
  } else {
    node.sources = null;
  }
}

// --- Read / write ----------------------------------------------------------
export function readNode<T>(node: Node<T>): T {
  if (currentObserver !== null) {
    link(currentObserver, node as Node<any>);
  }
  if (node.fn !== null) {
    updateIfNecessary(node);
  }
  return node.value as T;
}

export function peekNode<T>(node: Node<T>): T {
  if (node.fn !== null) {
    // Untracked evaluation so we return a correct value.
    const prev = currentObserver;
    currentObserver = null;
    try {
      updateIfNecessary(node);
    } finally {
      currentObserver = prev;
    }
  }
  return node.value as T;
}

export function writeNode<T>(node: Node<T>, next: T): void {
  if (node.fn !== null) {
    throw new Error("[raptor] cannot write directly into a derived/effect");
  }
  if (node.equals(node.value as T, next)) return;
  node.value = next;
  const observers = node.observers;
  if (observers) {
    for (let i = 0; i < observers.length; i++) {
      markStale(observers[i]!, DIRTY);
    }
  }
  if (batchDepth === 0) flushEffects();
}

// --- State propagation ------------------------------------------------------
function markStale(node: Node<any>, nextState: number): void {
  if (node.state >= nextState) return;
  const wasClean = node.state === CLEAN;
  node.state = nextState;
  if (node.isEffect && wasClean) {
    // The queue is drained by the caller (writeNode/batch/createEffectNode).
    effectQueue.push(node);
  }
  const observers = node.observers;
  if (observers) {
    for (let i = 0; i < observers.length; i++) {
      markStale(observers[i]!, CHECK);
    }
  }
}

function updateIfNecessary(node: Node<any>): void {
  if (node.state === CHECK) {
    const sources = node.sources;
    if (sources) {
      for (let i = 0; i < sources.length; i++) {
        updateIfNecessary(sources[i]!);
        if ((node.state as number) === DIRTY) break;
      }
    }
  }
  if (node.state === DIRTY) {
    update(node);
  }
  node.state = CLEAN;
}

function update(node: Node<any>): void {
  const oldValue = node.value;
  disposeOwned(node);

  const prevObserver = currentObserver;
  const prevOwner = currentOwner;
  const prevCollect = node.collect;
  const prevCount = node.collectCount;
  const collected = node.scratch;
  node.collect = collected;
  node.collectCount = 0;
  currentObserver = node;
  currentOwner = node;
  // Read in `finally`, so reconciliation sees how many sources managed to be
  // collected even if `fn` threw, without keeping the collection state open
  // after exit.
  let collectedCount = 0;
  try {
    node.value = node.fn!();
  } finally {
    collectedCount = node.collectCount;
    node.collect = prevCollect;
    node.collectCount = prevCount;
    currentObserver = prevObserver;
    currentOwner = prevOwner;
  }
  // Subscribe/unsubscribe only if the dependency set changed.
  reconcileSources(node, collected, collectedCount);

  // If the memo's value changed, its observers become DIRTY (not just CHECK).
  if (!node.isEffect && !node.equals(oldValue as never, node.value as never)) {
    const observers = node.observers;
    if (observers) {
      for (let i = 0; i < observers.length; i++) {
        observers[i]!.state = DIRTY;
      }
    }
  }
}

// --- Effect scheduler -------------------------------------------------------
export function flushEffects(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  try {
    // The queue can grow during the run; we process until it empties.
    for (let i = 0; i < effectQueue.length; i++) {
      const effect = effectQueue[i]!;
      if (!effect.disposed && effect.state !== CLEAN) {
        updateIfNecessary(effect);
      }
    }
    effectQueue.length = 0;
  } finally {
    flushScheduled = false;
  }
}

// --- Batch / untracked -----------------------------------------------------
export function batch<T>(fn: () => T): T {
  if (batchDepth > 0) return fn();
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flushEffects();
  }
}

export function untracked<T>(fn: () => T): T {
  const prev = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = prev;
  }
}

// --- Ownership / cleanup ----------------------------------------------------
export function getOwner(): Owner | null {
  return currentOwner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prevOwner = currentOwner;
  const prevObserver = currentObserver;
  currentOwner = owner;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentOwner = prevOwner;
    currentObserver = prevObserver;
  }
}

export function onCleanup(fn: Cleanup): void {
  const owner = currentOwner;
  if (owner) {
    (owner.cleanups ?? (owner.cleanups = [])).push(fn);
  }
}

/** Add a new computation to the current owner for cascading dispose. */
export function adopt(node: Node<any>): void {
  const owner = currentOwner;
  if (owner) {
    (owner.owned ?? (owner.owned = [])).push(node);
  }
}

function disposeOwned(owner: Owner): void {
  const owned = owner.owned;
  if (owned) {
    for (let i = owned.length - 1; i >= 0; i--) {
      disposeNode(owned[i]!);
    }
    owned.length = 0;
  }
  const cleanups = owner.cleanups;
  if (cleanups) {
    for (let i = cleanups.length - 1; i >= 0; i--) {
      cleanups[i]!();
    }
    cleanups.length = 0;
  }
}

export function disposeNode(node: Node<any>): void {
  if (node.disposed) return;
  disposeOwned(node);
  unlinkSources(node);
  node.observers = null;
  node.disposed = true;
  node.state = CLEAN;
}

/**
 * Create an owned root scope, isolated from tracking. Returns the result of fn
 * and a dispose that destroys everything created inside.
 */
export function createRoot<T>(fn: (dispose: Cleanup) => T): T {
  const root: Owner = { owned: null, cleanups: null };
  const dispose: Cleanup = () => disposeOwned(root);
  const prevOwner = currentOwner;
  const prevObserver = currentObserver;
  currentOwner = root;
  currentObserver = null;
  try {
    return fn(dispose);
  } finally {
    currentOwner = prevOwner;
    currentObserver = prevObserver;
  }
}

// --- Node factories ---------------------------------------------------------
export function createSignalNode<T>(value: T, equals: (a: T, b: T) => boolean): Node<T> {
  return new Node<T>(value, null, false, equals, currentOwner);
}

export function createMemoNode<T>(fn: () => T, equals: (a: T, b: T) => boolean): Node<T> {
  const node = new Node<T>(undefined, fn, false, equals, currentOwner);
  adopt(node as Node<any>);
  return node;
}

export function createEffectNode(fn: () => void): Node<void> {
  const node = new Node<void>(undefined, fn, true, defaultEquals, currentOwner);
  adopt(node as Node<any>);
  effectQueue.push(node as Node<any>);
  if (batchDepth === 0) flushEffects();
  return node;
}
