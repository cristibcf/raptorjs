/**
 * Tipuri partajate RaptorTest. Vezi whitepaper §6-§9, §20.
 */
import { type VirtualClock } from "./clock.ts";

// --- Semantic UI Model (§8) ------------------------------------------------
/** Un nod interactiv identificat semantic, nu prin selector CSS. */
export interface SemanticNode {
  role: string; // button, link, input, form...
  name: string; // accessible name / text
  context: string[]; // ex. ["ProductCard", "SKU:ABC-42"]
  actionEffect?: string; // ex. "POST /cart/items"
  stability?: number; // 0..1
}

// --- Probe / Event log (§6) ------------------------------------------------
export type ProbeEventType =
  | "action"
  | "request"
  | "response"
  | "navigation"
  | "console-error"
  | "exception"
  | "ui-snapshot";

export interface ProbeEvent {
  id: string;
  virtualTime: number;
  type: ProbeEventType;
  correlation: string[];
  payload: Record<string, unknown>;
}

// --- Contract / requests ---------------------------------------------------
export interface ObservedRequest {
  method: string;
  path: string;
  body: unknown;
}
export interface ObservedResponse {
  status: number;
  body: unknown;
}

// --- Network schedule (chaos / temporal, §14/§15) --------------------------
export interface RouteTiming {
  /** intarziere pana cand Twin proceseaza cererea (citeste/scrie DB) */
  processDelay: number;
  /** intarziere de la procesare pana la livrarea raspunsului la client */
  deliverDelay: number;
  /** injecteaza o eroare (status) in loc de raspuns normal */
  faultStatus?: number;
}

export interface NetworkSchedule {
  /** timing implicit */
  default: RouteTiming;
  /** override per "METHOD path" */
  routes: Record<string, RouteTiming>;
}

// --- Application harness (aplicatia testata) --------------------------------
/** Starea observabila a aplicatiei la un moment dat. */
export interface AppState {
  route: string;
  /** fapte observabile din UI (ex. { "cart.count": 1 }) */
  facts: Record<string, unknown>;
  /** actiuni disponibile acum */
  actions: SemanticNode[];
}

/**
 * Contract pe care aplicatia testata il implementeaza ca RaptorTest sa o poata
 * conduce determinist (echivalentul unui adapter Playwright/RaptorJS, §23).
 */
export interface AppHarness {
  reset(): void;
  currentState(): AppState;
  /** Executa o actiune (poate emite requests prin `net`, folosind `clock`). */
  perform(actionId: string, ctx: HarnessContext): void;
  /** Snapshot pentru state forking copy-on-write (§13). */
  snapshot(): unknown;
  restore(snap: unknown): void;
}

export interface HarnessContext {
  clock: VirtualClock;
  request: (
    method: string,
    path: string,
    body: unknown,
    onResponse: (res: ObservedResponse) => void,
  ) => void;
  emit: (event: Omit<ProbeEvent, "id" | "virtualTime">) => void;
}

// --- Execution capsule (§20) ----------------------------------------------
export interface Capsule {
  id: string;
  buildFingerprint: string;
  actionLog: string[];
  networkSchedule: NetworkSchedule;
  seed: number;
  /** invariantul care a esuat */
  failedOracle?: string;
  detail?: string;
}
