/**
 * Nucleul reactiv Raptor - graf fine-grained, glitch-free, pull-based pentru
 * memo-uri (lazy) si push/eager pentru effects.
 *
 * Algoritmul foloseste trei stari per nod (CLEAN / CHECK / DIRTY) si propaga
 * "staleness" in aval cand un semnal se schimba. Memo-urile recalculeaza doar
 * la citire (updateIfNecessary), iar effects sunt programate intr-o coada
 * flush-uita la finalul unui batch. Vezi whitepaper sectiunile 6.3 si 7.
 */

// --- Stari nod -------------------------------------------------------------
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

export type Cleanup = () => void;

/** Un "owner" detine computatii copil si cleanup-uri (sectiunea 10). */
export interface Owner {
  owned: Node<any>[] | null;
  cleanups: Cleanup[] | null;
}

/** Nod reactiv unic folosit pentru signal, memo si effect. */
export class Node<T> implements Owner {
  value: T | undefined;
  /** null pentru un signal-sursa; setat pentru memo/effect. */
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
  /** Buffer de dependente colectate in rularea curenta (null cand nu ruleaza). */
  collect: Node<any>[] | null = null;
  /**
   * Buffer de colectare reutilizat intre rulari. Nu se micsoreaza niciodata:
   * `collectCount` spune cate intrari sunt valide, restul raman ca rezerva.
   * Un `length = 0` ar parea echivalent, dar face V8 sa elibereze backing
   * store-ul si sa realoce la urmatorul push - masurat ~25% mai lent decat
   * varianta cu contor, si chiar mai lent decat un array nou per rulare.
   */
  scratch: Node<any>[] = [];
  /** Cate intrari din `scratch` sunt valide in rularea curenta. */
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

// --- Context global de executie -------------------------------------------
let currentObserver: Node<any> | null = null;
let currentOwner: Owner | null = null;
let batchDepth = 0;
const effectQueue: Node<any>[] = [];
let flushScheduled = false;

export const defaultEquals = <T>(a: T, b: T): boolean => a === b;

// --- Legare dependente -----------------------------------------------------
// Colectam dependentele in buffer-ul persistent al observatorului (dedup O(n) pe
// dep-set-uri mici) si abonam efectiv abia la reconciliere (`reconcileSources`).
// Astfel, cand setul de dependente nu se schimba intre rulari — cazul comun
// pentru lanturi statice — NU atingem deloc listele de observatori (fara churn)
// si nu alocam nimic: scriem peste intrarile vechi, prin index.
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

/** true daca primele `count` surse colectate sunt identice (ca ordine) cu cele curente. */
function sameSources(old: Node<any>[] | null, next: Node<any>[], count: number): boolean {
  if (old === null) return count === 0;
  if (old.length !== count) return false;
  for (let i = 0; i < count; i++) if (old[i] !== next[i]) return false;
  return true;
}

/**
 * Aplica dependentele colectate. Daca sunt identice cu cele existente, nu face
 * nimic (fast path). Altfel dezaboneaza vechile surse si le aboneaza pe cele noi.
 */
function reconcileSources(node: Node<any>, collected: Node<any>[], count: number): void {
  if (sameSources(node.sources, collected, count)) return;
  unlinkSources(node);
  if (count > 0) {
    // Copiem doar cand dependentele chiar s-au schimbat (rar): `collected` este
    // buffer-ul persistent al nodului si urmatoarea rulare l-ar rescrie sub
    // picioarele listei de surse.
    const sources = collected.slice(0, count);
    node.sources = sources;
    for (let i = 0; i < count; i++) subscribe(node, sources[i]!);
  } else {
    node.sources = null;
  }
}

// --- Citire / scriere ------------------------------------------------------
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
    // Evaluare fara tracking pentru a returna o valoare corecta.
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
    throw new Error("[raptor] nu se poate scrie direct intr-un derived/effect");
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

// --- Propagarea starii -----------------------------------------------------
function markStale(node: Node<any>, nextState: number): void {
  if (node.state >= nextState) return;
  const wasClean = node.state === CLEAN;
  node.state = nextState;
  if (node.isEffect && wasClean) {
    // Coada e drenata de apelant (writeNode/batch/createEffectNode).
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
  // Citit in `finally`, ca reconcilierea sa vada cate surse au apucat sa fie
  // colectate chiar si daca `fn` a aruncat, fara sa tinem starea de colectare
  // deschisa dupa iesire.
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
  // Abonare/dezabonare doar daca setul de dependente s-a schimbat.
  reconcileSources(node, collected, collectedCount);

  // Daca valoarea memo-ului s-a schimbat, observatorii devin DIRTY (nu doar CHECK).
  if (!node.isEffect && !node.equals(oldValue as never, node.value as never)) {
    const observers = node.observers;
    if (observers) {
      for (let i = 0; i < observers.length; i++) {
        observers[i]!.state = DIRTY;
      }
    }
  }
}

// --- Scheduler effects -----------------------------------------------------
export function flushEffects(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  try {
    // Coada poate creste in timpul rularii; procesam pana se goleste.
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

// --- Ownership / cleanup ---------------------------------------------------
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

/** Adauga o computatie noua la owner-ul curent pentru dispose in cascada. */
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
 * Creeaza un scope-radacina detinut, izolat de tracking. Intoarce rezultatul
 * lui fn si un dispose care distruge tot ce a fost creat inauntru.
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

// --- Factory-uri de noduri -------------------------------------------------
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
