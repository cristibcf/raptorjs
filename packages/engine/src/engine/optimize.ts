/**
 * RaptorBuild semantic optimizer (RaptorEngine whitepaper 13, 14).
 *
 * Two semantic-aware passes that a generic bundler cannot do without the
 * reactive graph:
 *   - Dead Signal Elimination (14.1): eliminates signals/deriveds with no path
 *     to an observable output (not just textually unused variables).
 *   - Dependency Fusion (14.2): collapses a derived that has a single consumer
 *     into that consumer, reducing closures/subscriptions. Blocked at debug
 *     boundaries (14.2, 24: adaptive strategies, not adaptive correctness).
 *
 * Every decision produces a trace entry (inspect: "what was eliminated/fused
 * and why", 27).
 */
import {
  buildGraph,
  countIdent,
  substituteIdent,
  type IRModule,
  type IRComponent,
  type IRDerived,
  type IRElement,
  type IRChild,
  type Expr,
} from "@raptor/engine/compiler";

export interface OptEntry {
  pass: "DSE" | "Fusion";
  action: "eliminate" | "fuse" | "blocked";
  target: string;
  detail: string;
}

export interface OptimizeResult {
  module: IRModule;
  trace: OptEntry[];
  metrics: { eliminated: number; fused: number };
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}

// --- Dead Signal Elimination ----------------------------------------------

function runDSE(module: IRModule, trace: OptEntry[]): number {
  let eliminated = 0;
  let changed = true;
  while (changed) {
    changed = false;
    const graph = buildGraph(module);
    const dead = new Set(graph.deadReactive());
    if (dead.size === 0) break;
    for (const comp of module.components) {
      const before = comp.signals.length + comp.deriveds.length + comp.serverSignals.length;
      comp.signals = comp.signals.filter((s) => !dead.has(s.id));
      comp.deriveds = comp.deriveds.filter((d) => !dead.has(d.id));
      comp.serverSignals = comp.serverSignals.filter((ss) => !dead.has(ss.id));
      const removed = before - (comp.signals.length + comp.deriveds.length + comp.serverSignals.length);
      if (removed > 0) changed = true;
    }
    for (const id of dead) {
      trace.push({
        pass: "DSE",
        action: "eliminate",
        target: id,
        detail: "no observable consumer (no path to DOM/effect)",
      });
      eliminated++;
    }
  }
  return eliminated;
}

// --- Dependency Fusion -----------------------------------------------------

interface ReaderSlot {
  id: string;
  reads: string[];
  getExpr(): Expr;
  setExpr(e: Expr): void;
  setReads(r: string[]): void;
}

function elementSlots(el: IRElement, out: ReaderSlot[]): void {
  for (const a of el.attrs) {
    if (!a.expr) continue;
    out.push({
      id: a.id,
      reads: a.reads,
      getExpr: () => a.expr!,
      setExpr: (e) => (a.expr = e),
      setReads: (r) => (a.reads = r),
    });
  }
  for (const ev of el.events) {
    out.push({
      id: ev.id,
      reads: ev.reads,
      getExpr: () => ev.handler,
      setExpr: (e) => (ev.handler = e),
      setReads: (r) => (ev.reads = r),
    });
  }
  for (const c of el.children as IRChild[]) {
    if (c.kind === "Element") elementSlots(c, out);
    else if (c.expr) {
      out.push({
        id: c.id,
        reads: c.reads,
        getExpr: () => c.expr!,
        setExpr: (e) => (c.expr = e),
        setReads: (r) => (c.reads = r),
      });
    }
  }
}

function collectReaderSlots(comp: IRComponent): ReaderSlot[] {
  const slots: ReaderSlot[] = [];
  for (const d of comp.deriveds) {
    slots.push({
      id: d.id,
      reads: d.reads,
      getExpr: () => d.expr,
      setExpr: (e) => (d.expr = e),
      setReads: (r) => (d.reads = r),
    });
  }
  for (const ef of comp.effects) {
    slots.push({
      id: ef.id,
      reads: ef.reads,
      getExpr: () => ef.expr,
      setExpr: (e) => (ef.expr = e),
      setReads: (r) => (ef.reads = r),
    });
  }
  elementSlots(comp.root, slots);
  return slots;
}

function fuseComponent(comp: IRComponent, trace: OptEntry[]): number {
  let fused = 0;
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const slots = collectReaderSlots(comp);
    for (const d of comp.deriveds) {
      if (d.debugBoundary) {
        if (!blocked.has(d.id)) {
          trace.push({
            pass: "Fusion",
            action: "blocked",
            target: d.id,
            detail: "debug boundary (@debug) - fusion would alter observability",
          });
          blocked.add(d.id);
        }
        continue;
      }
      const readers = slots.filter((s) => s.id !== d.id && s.reads.includes(d.name));
      if (readers.length !== 1) continue;
      const r = readers[0]!;

      // A single consumer does not mean a single USE. `scump + scump` has a
      // single consumer, but substitution would compute the expression twice
      // and delete the very memo that computed it once: an "optimization" that
      // slows things down. Audit round 3, U2.
      const folosiri = countIdent(r.getExpr(), d.name);
      if (folosiri > 1) {
        trace.push({
          pass: "Fusion",
          action: "blocked",
          target: d.id,
          detail: `used ${folosiri} times in ${r.id} - fusion would duplicate work`,
        });
        blocked.add(d.id);
        continue;
      }

      const fuzionat = substituteIdent(r.getExpr(), d.name, d.expr);
      if (fuzionat === null) {
        // Substitution would capture a variable bound at the use site, so it
        // would change the meaning of the program. Audit round 3, U1.
        trace.push({
          pass: "Fusion",
          action: "blocked",
          target: d.id,
          detail: `fusion in ${r.id} would capture a variable bound there`,
        });
        blocked.add(d.id);
        continue;
      }

      r.setExpr(fuzionat);
      r.setReads(unique([...r.reads.filter((n) => n !== d.name), ...d.reads]));
      comp.deriveds = comp.deriveds.filter((x: IRDerived) => x.id !== d.id);
      trace.push({
        pass: "Fusion",
        action: "fuse",
        target: d.id,
        detail: `fused in ${r.id} (single consumer)`,
      });
      fused++;
      changed = true;
      break; // restart with fresh slots
    }
  }
  return fused;
}

/** Runs the semantic passes on a copy of the IR; does not mutate the input. */
export function optimize(module: IRModule, options: { fusion: boolean } = { fusion: true }): OptimizeResult {
  const clone: IRModule = structuredClone(module);
  const trace: OptEntry[] = [];
  const eliminated = runDSE(clone, trace);
  let fused = 0;
  if (options.fusion) {
    for (const comp of clone.components) fused += fuseComponent(comp, trace);
    // Fusion can create dead nodes (an intermediate derived left with no reads) -
    // run DSE once more to clean up.
    runDSE(clone, trace);
  }
  return { module: clone, trace, metrics: { eliminated, fused } };
}
