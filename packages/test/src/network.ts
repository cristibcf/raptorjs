/**
 * NetworkController - ties the application to RaptorTwin through virtual time.
 * Each request has a PROCESSING moment (when Twin reads/writes the DB) and a
 * DELIVERY moment (when the response reaches the client). Separating them allows
 * deterministic reproduction of races, reorderings and delays (whitepaper §14,
 * §15) - e.g. a GET processed before a POST but delivered after it.
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

    // Processing: Twin applies the effect on the state (or fault injection).
    this.clock.at(timing.processDelay, () => {
      captured = timing.faultStatus
        ? { status: timing.faultStatus, body: { error: "fault-injected" } }
        : this.twin.handle(method, path, body);
    });

    // Delivery: the response reaches the client (may be much later -> reordering).
    this.clock.at(timing.processDelay + timing.deliverDelay, () => {
      this.emit?.("response", method, path, { id, deliverAt: this.clock.now, status: captured.status });
      onResponse({ status: captured.status, body: captured.body });
    });
  }
}
