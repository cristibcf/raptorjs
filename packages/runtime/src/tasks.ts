/**
 * Task fabric (spec sectiunea 5): planificare asincrona deterministica, cu
 * anulare, deadline-uri si cote de resurse - fara stare globala mutabila.
 *
 * `raptor:tasks` expune exact acest obiect. Oprirea curata ceruta de spike
 * (sectiunea 14) se obtine prin `shutdown()`: nu mai accepta lucru nou, anuleaza
 * ce este in zbor si asteapta drenarea.
 */
import { RaptorError } from "./errors.ts";
import type { Observer } from "./observe.ts";
import { silentObserver } from "./observe.ts";

export interface TaskContext {
  readonly signal: AbortSignal;
  /** Milisecunde ramase pana la deadline, sau `null` daca nu exista. */
  readonly remainingMs: number | null;
  throwIfCancelled(): void;
}

export interface SpawnOptions {
  readonly name?: string;
  readonly deadlineMs?: number;
  /** Semnal extern (ex: cererea HTTP a fost abandonata de client). */
  readonly signal?: AbortSignal;
}

export interface TaskStats {
  readonly spawned: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly active: number;
  readonly peakActive: number;
}

export interface TaskFabric {
  spawn<T>(body: (context: TaskContext) => Promise<T> | T, options?: SpawnOptions): Promise<T>;
  /** Asteapta terminarea lucrului in zbor, fara sa anuleze. */
  drain(): Promise<void>;
  /** Anuleaza tot si dreneaza; idempotent. */
  shutdown(reason?: string): Promise<void>;
  readonly closed: boolean;
  stats(): TaskStats;
}

export interface TaskFabricOptions {
  readonly maxConcurrent?: number;
  readonly defaultDeadlineMs?: number | null;
  readonly observer?: Observer;
}

class Fabric implements TaskFabric {
  readonly #max: number;
  readonly #defaultDeadline: number | null;
  readonly #observer: Observer;
  readonly #root = new AbortController();
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #queue: Array<() => void> = [];
  #active = 0;
  #counter = 0;
  #spawned = 0;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #peakActive = 0;
  #closed = false;

  constructor(options: TaskFabricOptions = {}) {
    this.#max = options.maxConcurrent ?? 64;
    this.#defaultDeadline = options.defaultDeadlineMs ?? null;
    this.#observer = options.observer ?? silentObserver();
  }

  get closed(): boolean {
    return this.#closed;
  }

  #acquire(): Promise<void> {
    if (this.#active < this.#max) {
      this.#active += 1;
      if (this.#active > this.#peakActive) this.#peakActive = this.#active;
      return Promise.resolve();
    }
    return new Promise<void>((release) => {
      this.#queue.push(() => {
        this.#active += 1;
        if (this.#active > this.#peakActive) this.#peakActive = this.#active;
        release();
      });
    });
  }

  #release(): void {
    this.#active -= 1;
    const next = this.#queue.shift();
    if (next) next();
  }

  spawn<T>(body: (context: TaskContext) => Promise<T> | T, options: SpawnOptions = {}): Promise<T> {
    if (this.#closed) {
      return Promise.reject(
        new RaptorError("raptor:task/quota", "task fabric este inchis; nu mai accepta lucru nou", {
          name: options.name ?? "anonymous",
        }),
      );
    }

    const name = options.name ?? `task-${++this.#counter}`;
    this.#spawned += 1;

    const promise = this.#run(name, body, options);
    this.#inFlight.add(promise);
    // Ramura de urmarire consuma respingerea, ca un task lansat si neasteptat
    // sa nu produca un "unhandled rejection"; apelantul primeste `promise`.
    void promise.then(
      () => this.#inFlight.delete(promise),
      () => this.#inFlight.delete(promise),
    );
    return promise;
  }

  async #run<T>(name: string, body: (context: TaskContext) => Promise<T> | T, options: SpawnOptions): Promise<T> {
    await this.#acquire();
    const span = this.#observer.startSpan(`task.${name}`);
    const controller = new AbortController();
    const deadlineMs = options.deadlineMs ?? this.#defaultDeadline;
    const startedAt = Date.now();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadlineHit = false;

    const abortFromParent = (): void => controller.abort(this.#root.signal.reason);
    const abortFromCaller = (): void => controller.abort(options.signal?.reason);

    if (this.#root.signal.aborted) abortFromParent();
    else this.#root.signal.addEventListener("abort", abortFromParent, { once: true });
    if (options.signal) {
      if (options.signal.aborted) abortFromCaller();
      else options.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
    if (deadlineMs !== null && deadlineMs !== undefined) {
      timer = setTimeout(() => {
        deadlineHit = true;
        controller.abort(new RaptorError("raptor:task/deadline", `task '${name}' a depasit deadline-ul`, { name, deadlineMs }));
      }, deadlineMs);
      // Un deadline nu trebuie sa tina procesul in viata de unul singur.
      if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    }

    const context: TaskContext = {
      signal: controller.signal,
      get remainingMs(): number | null {
        if (deadlineMs === null || deadlineMs === undefined) return null;
        return Math.max(0, deadlineMs - (Date.now() - startedAt));
      },
      throwIfCancelled(): void {
        if (!controller.signal.aborted) return;
        const reason = controller.signal.reason;
        if (reason instanceof RaptorError) throw reason;
        throw new RaptorError("raptor:task/cancelled", `task '${name}' a fost anulat`, { name });
      },
    };

    try {
      context.throwIfCancelled();
      const value = await body(context);
      this.#completed += 1;
      span.end({ outcome: "completed" });
      return value;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (cancelled) this.#cancelled += 1;
      else this.#failed += 1;
      span.end({ outcome: cancelled ? (deadlineHit ? "deadline" : "cancelled") : "failed", error: String(error) });
      if (cancelled && !(error instanceof RaptorError)) {
        throw new RaptorError(
          deadlineHit ? "raptor:task/deadline" : "raptor:task/cancelled",
          `task '${name}' ${deadlineHit ? "a depasit deadline-ul" : "a fost anulat"}`,
          { name, cause: String(error) },
        );
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.#root.signal.removeEventListener("abort", abortFromParent);
      options.signal?.removeEventListener("abort", abortFromCaller);
      this.#release();
    }
  }

  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#observer.log("info", "tasks.shutdown", { reason, active: this.#active });
      this.#root.abort(new RaptorError("raptor:task/cancelled", `runtime se opreste: ${reason}`, { reason }));
    }
    await this.drain();
  }

  stats(): TaskStats {
    return {
      spawned: this.#spawned,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
      active: this.#active,
      peakActive: this.#peakActive,
    };
  }
}

export function createTaskFabric(options: TaskFabricOptions = {}): TaskFabric {
  return new Fabric(options);
}
