/**
 * Graph diff pentru Stateful Reactive HMR (whitepaper RaptorEngine 11, 12).
 *
 * HMR clasic inlocuieste module. Raptor merge mai jos: folosind stable IDs din
 * IR, comparam graful vechi cu cel nou si producem un plan de patch care
 * pastreaza numai starea compatibila si regenereaza numai nodurile modificate.
 * Cand un contract se schimba incompatibil, facem fallback explicit la remount
 * cu motiv (11.2: predictibilitatea > preservarea agresiva).
 */
import { canonicalize } from "./ir.ts";
import type { IRModule, IRComponent, IRElement, IRChild } from "./ir.ts";

export interface WireChange {
  serverSignal: string;
  address: string;
  /** Sesiune wire pastrata (aceeasi adresa) sau pierduta (adresa schimbata). */
  sessionPreserved: boolean;
  schemaChanged: boolean;
}

export interface ComponentPatch {
  component: string;
  strategy: "patch" | "remount";
  fallbackReason: string | null;
  preservedSignals: string[];
  disposedSignals: string[];
  addedSignals: string[];
  regeneratedDeriveds: string[];
  regeneratedBindings: string[];
  wireChanges: WireChange[];
}

export interface GraphDiff {
  changedComponents: string[];
  addedComponents: string[];
  removedComponents: string[];
  patches: ComponentPatch[];
  /** Numar total de sesiuni wire pastrate (linia "preserved: … wire session"). */
  preservedWireSessions: number;
}

function exprEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/** Semnatura structurala a unui element: forma DOM, ignorand continutul expresiilor. */
function structuralSignature(el: IRElement): string {
  const attrs = el.attrs.map((a) => `${a.name}${a.expr ? "=~" : "=s"}`).sort();
  const events = el.events.map((e) => `on:${e.event}`).sort();
  const children = (el.children as IRChild[]).map((c) => {
    if (c.kind === "Element") return structuralSignature(c);
    return c.expr ? "{~}" : `t:${c.text}`;
  });
  return `<${el.tag}|${attrs.join(",")}|${events.join(",")}>[${children.join("")}]`;
}

interface BindingInfo {
  id: string;
  expr: unknown;
}

function collectBindings(el: IRElement, out: BindingInfo[]): void {
  for (const a of el.attrs) if (a.expr) out.push({ id: a.id, expr: a.expr });
  for (const e of el.events) out.push({ id: e.id, expr: e.handler });
  for (const c of el.children as IRChild[]) {
    if (c.kind === "Element") collectBindings(c, out);
    else if (c.expr) out.push({ id: c.id, expr: c.expr });
  }
}

function indexByName<T extends { name: string }>(items: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(it.name, it);
  return m;
}

function diffComponent(oldC: IRComponent, newC: IRComponent): ComponentPatch {
  const patch: ComponentPatch = {
    component: newC.name,
    strategy: "patch",
    fallbackReason: null,
    preservedSignals: [],
    disposedSignals: [],
    addedSignals: [],
    regeneratedDeriveds: [],
    regeneratedBindings: [],
    wireChanges: [],
  };

  // 1. Structura DOM. Schimbarea formei -> remount (11.2).
  if (structuralSignature(oldC.root) !== structuralSignature(newC.root)) {
    patch.strategy = "remount";
    patch.fallbackReason = "structura template s-a schimbat (boundary incompatibil)";
  }

  // 2. Signals: match dupa nume.
  const oldSignals = indexByName(oldC.signals);
  const newSignals = indexByName(newC.signals);
  for (const [name, s] of newSignals) {
    if (oldSignals.has(name)) patch.preservedSignals.push(s.id);
    else patch.addedSignals.push(s.id);
  }
  for (const [name, s] of oldSignals) {
    if (!newSignals.has(name)) {
      patch.disposedSignals.push(s.id);
      if (patch.strategy === "patch") {
        patch.strategy = "remount";
        patch.fallbackReason = `signal '${name}' eliminat (identitate pierduta)`;
      }
    }
  }

  // 3. Deriveds: expr schimbat -> regenerat.
  const oldDeriveds = indexByName(oldC.deriveds);
  const newDeriveds = indexByName(newC.deriveds);
  for (const [name, d] of newDeriveds) {
    const prev = oldDeriveds.get(name);
    if (!prev || !exprEqual(prev.expr, d.expr)) patch.regeneratedDeriveds.push(d.id);
  }

  // 4. Bindings: expr schimbat -> regenerat (doar in strategia patch;
  //    la remount tot subtree-ul se reconstruieste oricum).
  if (patch.strategy === "patch") {
    const oldB = new Map<string, unknown>();
    const newB: BindingInfo[] = [];
    const tmp: BindingInfo[] = [];
    collectBindings(oldC.root, tmp);
    for (const b of tmp) oldB.set(b.id, b.expr);
    collectBindings(newC.root, newB);
    for (const b of newB) {
      const prev = oldB.get(b.id);
      if (prev === undefined || !exprEqual(prev, b.expr)) patch.regeneratedBindings.push(b.id);
    }
  }

  // 5. Server signals / wire: schema sau address schimbate.
  const oldSS = indexByName(oldC.serverSignals);
  const newSS = indexByName(newC.serverSignals);
  for (const [name, ss] of newSS) {
    const prev = oldSS.get(name);
    if (!prev) continue;
    const addressSame = prev.address === ss.address;
    const schemaChanged = prev.schema !== ss.schema;
    if (!addressSame || schemaChanged) {
      patch.wireChanges.push({
        serverSignal: ss.id,
        address: ss.address,
        sessionPreserved: addressSame,
        schemaChanged,
      });
    }
  }

  return patch;
}

/** Compara doua compilari ale aceluiasi modul si produce planul de patch HMR. */
export function diffModules(oldM: IRModule, newM: IRModule): GraphDiff {
  const oldComps = indexByName(oldM.components);
  const newComps = indexByName(newM.components);
  const diff: GraphDiff = {
    changedComponents: [],
    addedComponents: [],
    removedComponents: [],
    patches: [],
    preservedWireSessions: 0,
  };

  for (const [name, c] of newComps) {
    const prev = oldComps.get(name);
    if (!prev) {
      diff.addedComponents.push(name);
      continue;
    }
    const patch = diffComponent(prev, c);
    const changed =
      patch.strategy === "remount" ||
      patch.regeneratedBindings.length > 0 ||
      patch.regeneratedDeriveds.length > 0 ||
      patch.addedSignals.length > 0 ||
      patch.wireChanges.length > 0;
    if (changed) {
      diff.changedComponents.push(name);
      diff.patches.push(patch);
    }
    // Sesiuni wire pastrate: server signals neschimbate + cele cu adresa aceeasi.
    for (const ss of c.serverSignals) {
      const change = patch.wireChanges.find((w) => w.serverSignal === ss.id);
      if (!change || change.sessionPreserved) diff.preservedWireSessions++;
    }
  }
  for (const [name] of oldComps) {
    if (!newComps.has(name)) diff.removedComponents.push(name);
  }

  return diff;
}
