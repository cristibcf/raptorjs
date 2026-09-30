/**
 * Raptor IR - the intermediate semantic representation (RaptorEngine whitepaper 7,
 * Appendix C). A component is no longer "just a function": it is decomposed into
 * nodes, bindings, dependencies, effects, queries and transitions. The semantic
 * graph (8) and the optimization passes (13, 14) work on this structure.
 *
 * Desired properties (7.1): typed where we know it, stable IDs for graph diff
 * and HMR, serializable for caching and inspection, extensible for server
 * queries and wire schema nodes.
 */
import type { Expr } from "./expr.ts";

/**
 * The complete taxonomy of IR nodes (Appendix C). In v0.1 we build the subset
 * produced by the .raptor DSL; the rest are reserved for the IR's evolution.
 */
export const IRNodeKind = {
  // Values
  Const: "Const",
  Param: "Param",
  Local: "Local",
  Import: "Import",
  ServerValue: "ServerValue",
  // Reactive
  Signal: "Signal",
  Derived: "Derived",
  Effect: "Effect",
  Resource: "Resource",
  StoreSlot: "StoreSlot",
  // UI
  Element: "Element",
  TextBinding: "TextBinding",
  AttrBinding: "AttrBinding",
  EventBinding: "EventBinding",
  ListBinding: "ListBinding",
  Conditional: "Conditional",
  // Server
  ServerFunction: "ServerFunction",
  ServerQuery: "ServerQuery",
  ServerSignal: "ServerSignal",
  RouteHandler: "RouteHandler",
  // Wire
  Schema: "Schema",
  Field: "Field",
  Codec: "Codec",
  Address: "Address",
  Subscription: "Subscription",
  Transaction: "Transaction",
} as const;

export type IRNodeKindValue = (typeof IRNodeKind)[keyof typeof IRNodeKind];

/** Span in the source (SourceSpan from Appendix C metadata), for source maps and diagnostics. */
export interface SourceSpan {
  start: number;
  end: number;
}

/** A local mutable signal (state). */
export interface IRSignal {
  kind: "Signal";
  id: string;
  name: string;
  /** The initialization expression (e.g. `0`). */
  init: Expr;
  span: SourceSpan;
}

/** A derived value (memo). `expr` is the body of the pure function. */
export interface IRDerived {
  kind: "Derived";
  id: string;
  name: string;
  expr: Expr;
  /** Reactive names read directly (level-1 dependencies). */
  reads: string[];
  span: SourceSpan;
  /**
   * If marked with `@debug`, fusion is not allowed to collapse it (14.2:
   * "blocked when debugging boundaries exist").
   */
  debugBoundary: boolean;
}

/** A server-side signal bound to a RaptorWire address (server signal). */
export interface IRServerSignal {
  kind: "ServerSignal";
  id: string;
  name: string;
  /** The logical address, e.g. "BTC.price". */
  address: string;
  /** Reference to the wire schema (schema field name), if declared. */
  schema: string | null;
  span: SourceSpan;
}

/** An explicit effect (reactive side-effect). */
export interface IREffect {
  kind: "Effect";
  id: string;
  expr: Expr;
  reads: string[];
  span: SourceSpan;
}

export interface IRTextBinding {
  kind: "TextBinding";
  id: string;
  /** Static text (property `text`) OR dynamic expression (`expr`). */
  text: string | null;
  expr: Expr | null;
  reads: string[];
}

export interface IRAttrBinding {
  kind: "AttrBinding";
  id: string;
  name: string;
  value: string | null;
  expr: Expr | null;
  reads: string[];
}

export interface IREventBinding {
  kind: "EventBinding";
  id: string;
  event: string;
  handler: Expr;
  /** Signals written by the handler (for write edges in the graph). */
  writes: string[];
  reads: string[];
}

export interface IRElement {
  kind: "Element";
  id: string;
  tag: string;
  attrs: IRAttrBinding[];
  events: IREventBinding[];
  children: IRChild[];
}

export type IRChild = IRElement | IRTextBinding;

export interface IRComponent {
  id: string;
  name: string;
  /** Stable ID (Appendix C metadata) - stable across recompilations for HMR. */
  stableId: string;
  signals: IRSignal[];
  deriveds: IRDerived[];
  serverSignals: IRServerSignal[];
  effects: IREffect[];
  root: IRElement;
  span: SourceSpan;
}

export interface IRModule {
  path: string;
  name: string;
  components: IRComponent[];
}

// --- Stable IDs ------------------------------------------------------------

/**
 * A stable ID derived from the semantic structure, not from textual position.
 * Two compilations of the same component produce the same ID for the same
 * signal, even if the lines moved - the basis for graph diff and HMR (7.1, 11).
 */
export function stableId(parts: (string | number)[]): string {
  return parts.join(":");
}

// --- Deterministic serialization ------------------------------------------

/** Recursively sorted keys, for stable cache hashes (21.1). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON (sorted keys) - input for content hashing. */
export function serializeIR(module: IRModule): string {
  return JSON.stringify(canonicalize(module));
}
