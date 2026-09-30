/**
 * RaptorProbe - the observability layer (whitepaper §6). Produces normalized
 * events with virtual time and correlation, not just logs. A click is tied to
 * the requests it triggered, the UI changes and the state transition.
 */
import { type VirtualClock } from "./clock.ts";
import { type ProbeEvent, type ProbeEventType } from "./types.ts";

export class EventLog {
  private readonly events: ProbeEvent[] = [];
  private seq = 0;
  private readonly clock: VirtualClock;

  constructor(clock: VirtualClock) {
    this.clock = clock;
  }

  append(type: ProbeEventType, payload: Record<string, unknown>, correlation: string[] = []): ProbeEvent {
    const event: ProbeEvent = {
      id: `evt_${++this.seq}`,
      virtualTime: this.clock.now,
      type,
      correlation,
      payload,
    };
    this.events.push(event);
    return event;
  }

  all(): readonly ProbeEvent[] {
    return this.events;
  }

  byType(type: ProbeEventType): ProbeEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}
