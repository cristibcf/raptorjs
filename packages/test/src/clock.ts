/**
 * VirtualClock - scheduler discret de evenimente pentru timp virtual controlat
 * (whitepaper §14 "Temporal testing"). Determinist: aceleasi callback-uri la
 * aceleasi timpuri produc aceeasi ordine, indiferent de wall-clock. Permite
 * freeze/advance, reordonare de raspunsuri si reproducere identica in replay.
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

  /** Programeaza `fn` la `now + delay`. Ordinea la timp egal = ordinea inserarii. */
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

  /** Ruleaza toate evenimentele pana cand coada e goala (sistemul se stabilizeaza). */
  runUntilIdle(maxSteps = 100_000): void {
    let steps = 0;
    let event = this.popEarliest();
    while (event) {
      if (++steps > maxSteps) throw new Error("[raptor-test] runUntilIdle: bucla infinita suspectata");
      this.now = event.at;
      event.fn();
      event = this.popEarliest();
    }
  }

  /** Avanseaza timpul cu `ms`, ruland evenimentele scadente in ordine. */
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
