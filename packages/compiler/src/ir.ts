/**
 * Raptor IR - reprezentarea intermediara semantica (whitepaper RaptorEngine 7,
 * Appendix C). Componenta nu mai e "doar o functie": e descompusa in noduri,
 * bindings, dependente, effects, queries si transitions. Pe aceasta structura
 * lucreaza graph-ul semantic (8) si pass-urile de optimizare (13, 14).
 *
 * Proprietati dorite (7.1): typed acolo unde stim, stable IDs pentru graph diff
 * si HMR, serializabil pentru caching si inspect, extensibil pentru server
 * queries si wire schema nodes.
 */
import type { Expr } from "./expr.ts";

/**
 * Taxonomia completa de noduri IR (Appendix C). In v0.1 construim subsetul
 * produs de DSL-ul .raptor; restul sunt rezervate pentru evolutia IR-ului.
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

/** Span in sursa (SourceSpan din metadata Appendix C), pentru source maps si diagnostics. */
export interface SourceSpan {
  start: number;
  end: number;
}

/** Un semnal mutabil local (state). */
export interface IRSignal {
  kind: "Signal";
  id: string;
  name: string;
  /** Expresia de initializare (ex. `0`). */
  init: Expr;
  span: SourceSpan;
}

/** O valoare derivata (memo). `expr` este corpul functiei pure. */
export interface IRDerived {
  kind: "Derived";
  id: string;
  name: string;
  expr: Expr;
  /** Nume reactive citite direct (dependente de nivel 1). */
  reads: string[];
  span: SourceSpan;
  /**
   * Daca e marcat cu `@debug`, fusion nu are voie sa-l colapseze (14.2:
   * "blocata cand exista debugging boundaries").
   */
  debugBoundary: boolean;
}

/** Un semnal server-side legat de o adresa RaptorWire (server signal). */
export interface IRServerSignal {
  kind: "ServerSignal";
  id: string;
  name: string;
  /** Adresa logica, ex. "BTC.price". */
  address: string;
  /** Referinta la schema wire (nume field schema), daca e declarata. */
  schema: string | null;
  span: SourceSpan;
}

/** Un effect explicit (side-effect reactiv). */
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
  /** Text static (property `text`) SAU expresie dinamica (`expr`). */
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
  /** Semnale scrise de handler (pentru edge-uri write in graph). */
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
  /** Stable ID (Appendix C metadata) - stabil intre recompilari pentru HMR. */
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
 * ID stabil derivat din structura semantica, nu din pozitie textuala. Doua
 * compilari ale aceleiasi componente produc acelasi ID pentru acelasi semnal,
 * chiar daca liniile s-au mutat - baza pentru graph diff si HMR (7.1, 11).
 */
export function stableId(parts: (string | number)[]): string {
  return parts.join(":");
}

// --- Serializare deterministica -------------------------------------------

/** Chei sortate recursiv, pentru hash-uri de cache stabile (21.1). */
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

/** JSON canonic (chei sortate) - input pentru content hashing. */
export function serializeIR(module: IRModule): string {
  return JSON.stringify(canonicalize(module));
}
