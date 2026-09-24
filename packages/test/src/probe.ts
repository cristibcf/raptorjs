/**
 * RaptorProbe - stratul de observabilitate (whitepaper §6). Produce evenimente
 * normalizate cu timp virtual si corelatie, nu doar loguri. Un click e legat de
 * request-urile provocate, de schimbarile de UI si de tranzitia de stare.
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
