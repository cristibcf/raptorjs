/**
 * NetworkController - leaga aplicatia de RaptorTwin prin timp virtual. Fiecare
 * cerere are un moment de PROCESARE (cand Twin citeste/scrie DB) si unul de
 * LIVRARE (cand raspunsul ajunge la client). Separarea lor permite reproducerea
 * deterministica a race-urilor, reordonarilor si intarzierilor (whitepaper §14,
 * §15) - de ex. un GET procesat inainte de un POST dar livrat dupa el.
 */
import { type VirtualClock } from "./clock.ts";
import { type RaptorTwin, type TwinResponse } from "./twin.ts";
import { type NetworkSchedule, type RouteTiming, type ObservedResponse } from "./types.ts";

export const DEFAULT_TIMING: RouteTiming = { processDelay: 10, deliverDelay: 10 };

export function defaultSchedule(): NetworkSchedule {
  return { default: { ...DEFAULT_TIMING }, routes: {} };
}

function timingFor(schedule: NetworkSchedule, method: string, path: string): RouteTiming {
  return schedule.routes[`${method.toUpperCase()} ${path}`] ?? schedule.default;
}

export interface NetworkControllerOptions {
  emit?: (kind: "request" | "response", method: string, path: string, info: Record<string, unknown>) => void;
}

export class NetworkController {
  private readonly twin: RaptorTwin;
  private readonly clock: VirtualClock;
  private readonly schedule: NetworkSchedule;
  private readonly emit: NetworkControllerOptions["emit"];
  private reqSeq = 0;

  constructor(
    twin: RaptorTwin,
    clock: VirtualClock,
    schedule: NetworkSchedule,
    options: NetworkControllerOptions = {},
  ) {
    this.twin = twin;
    this.clock = clock;
    this.schedule = schedule;
    this.emit = options.emit;
  }

  request(
    method: string,
    path: string,
    body: unknown,
    onResponse: (res: ObservedResponse) => void,
  ): void {
    const timing = timingFor(this.schedule, method, path);
    const id = ++this.reqSeq;
    this.emit?.("request", method, path, { id, issueAt: this.clock.now });

    let captured: TwinResponse = { status: 0, body: null };

    // Procesare: Twin aplica efectul asupra starii (sau fault injection).
    this.clock.at(timing.processDelay, () => {
      captured = timing.faultStatus
        ? { status: timing.faultStatus, body: { error: "fault-injected" } }
        : this.twin.handle(method, path, body);
    });

    // Livrare: raspunsul ajunge la client (poate fi mult mai tarziu -> reordonare).
    this.clock.at(timing.processDelay + timing.deliverDelay, () => {
      this.emit?.("response", method, path, { id, deliverAt: this.clock.now, status: captured.status });
      onResponse({ status: captured.status, body: captured.body });
    });
  }
}
