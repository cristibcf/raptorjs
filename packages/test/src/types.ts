/**
 * Shared RaptorTest types. See whitepaper §6-§9, §20.
 */
import { type VirtualClock } from "./clock.ts";

// --- Semantic UI Model (§8) ------------------------------------------------
/** An interactive node identified semantically, not by CSS selector. */
export interface SemanticNode {
  role: string; // button, link, input, form...
  name: string; // accessible name / text
  context: string[]; // e.g. ["ProductCard", "SKU:ABC-42"]
  actionEffect?: string; // e.g. "POST /cart/items"
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
  /** delay until Twin processes the request (reads/writes the DB) */
  processDelay: number;
  /** delay from processing until the response is delivered to the client */
  deliverDelay: number;
  /** inject an error (status) instead of a normal response */
  faultStatus?: number;
}

export interface NetworkSchedule {
  /** default timing */
  default: RouteTiming;
  /** override per "METHOD path" */
  routes: Record<string, RouteTiming>;
}

// --- Application harness (the application under test) -----------------------
/** The observable state of the application at a given moment. */
export interface AppState {
  route: string;
  /** observable facts from the UI (e.g. { "cart.count": 1 }) */
  facts: Record<string, unknown>;
  /** actions available right now */
  actions: SemanticNode[];
}

/**
 * The contract the application under test implements so RaptorTest can drive it
 * deterministically (the equivalent of a Playwright/RaptorJS adapter, §23).
 */
export interface AppHarness {
  reset(): void;
  currentState(): AppState;
  /** Perform an action (may emit requests via `net`, using `clock`). */
  perform(actionId: string, ctx: HarnessContext): void;
  /** Snapshot for copy-on-write state forking (§13). */
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
  /** the invariant that failed */
  failedOracle?: string;
  detail?: string;
}
