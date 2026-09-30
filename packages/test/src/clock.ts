/**
 * VirtualClock - a discrete event scheduler for controlled virtual time
 * (whitepaper §14 "Temporal testing"). Deterministic: the same callbacks at the
 * same times produce the same order, regardless of the wall clock. Supports
 * freeze/advance, response reordering and identical reproduction in replay.
 */

interface ScheduledEvent {
  at: number;
  seq: number;
  fn: () => void;
}

export class VirtualClock {
  now = 0;
  private queue: ScheduledEvent[] = [];
  private seq = 0;

  /** Schedule `fn` at `now + delay`. Order at equal times = insertion order. */
  at(delay: number, fn: () => void): void {
    this.schedule(this.now + Math.max(0, delay), fn);
  }

  schedule(absTime: number, fn: () => void): void {
    this.queue.push({ at: absTime, seq: this.seq++, fn });
  }

  private popEarliest(): ScheduledEvent | undefined {
    if (this.queue.length === 0) return undefined;
    let bestIndex = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const e = this.queue[i]!;
      const b = this.queue[bestIndex]!;
      if (e.at < b.at || (e.at === b.at && e.seq < b.seq)) bestIndex = i;
    }
    return this.queue.splice(bestIndex, 1)[0];
  }

  /** Run all events until the queue is empty (the system stabilizes). */
  runUntilIdle(maxSteps = 100_000): void {
    let steps = 0;
    let event = this.popEarliest();
    while (event) {
      if (++steps > maxSteps) throw new Error("[raptor-test] runUntilIdle: suspected infinite loop");
      this.now = event.at;
      event.fn();
      event = this.popEarliest();
    }
  }

  /** Advance time by `ms`, running the due events in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    while (this.queue.length > 0) {
      let bestIndex = -1;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i]!.at <= target) {
          if (bestIndex === -1) bestIndex = i;
          else {
            const e = this.queue[i]!;
            const b = this.queue[bestIndex]!;
            if (e.at < b.at || (e.at === b.at && e.seq < b.seq)) bestIndex = i;
          }
        }
      }
      if (bestIndex === -1) break;
      const event = this.queue.splice(bestIndex, 1)[0]!;
      this.now = event.at;
      event.fn();
    }
    this.now = target;
  }

  get pending(): number {
    return this.queue.length;
  }

  reset(): void {
    this.now = 0;
    this.queue.length = 0;
    this.seq = 0;
  }
}
