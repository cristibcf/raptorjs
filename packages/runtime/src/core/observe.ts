/**
 * Telemetry core (spec section 5): structured logs, spans and metrics from day
 * one. There is no "ad-hoc print" in the host - every event goes through this
 * recorder, so that `raptor-runtime trace` can emit an OpenTelemetry-compatible
 * stream without instrumenting the code retroactively.
 */

export type Severity = "debug" | "info" | "warn" | "error";

export interface RuntimeEvent {
  /** Milliseconds since the recorder started; monotonic, hence reproducible in tests. */
  readonly at: number;
  readonly kind: "log" | "span" | "metric" | "capability";
  readonly name: string;
  readonly severity: Severity;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly durationMs?: number;
}

export interface Span {
  readonly id: string;
  setAttribute(key: string, value: unknown): void;
  end(attributes?: Record<string, unknown>): void;
}

export interface Observer {
  log(severity: Severity, name: string, attributes?: Record<string, unknown>): void;
  startSpan(name: string, attributes?: Record<string, unknown>): Span;
  metric(name: string, value: number, attributes?: Record<string, unknown>): void;
  record(event: RuntimeEvent): void;
  events(): readonly RuntimeEvent[];
  /** A stream of JSON lines, one line per event (the format read by `trace`). */
  toJsonLines(): string;
  child(scope: string): Observer;
}

export interface ObserverOptions {
  /** Injectable for deterministic tests. */
  readonly now?: () => number;
  readonly sink?: (event: RuntimeEvent) => void;
  readonly minSeverity?: Severity;
}

const SEVERITY_ORDER: Record<Severity, number> = { debug: 10, info: 20, warn: 30, error: 40 };

class Recorder implements Observer {
  readonly #events: RuntimeEvent[] = [];
  readonly #now: () => number;
  readonly #origin: number;
  readonly #sink: ((event: RuntimeEvent) => void) | null;
  readonly #min: number;
  readonly #scope: string;
  #spanCounter = 0;
  #activeSpan: string | undefined;

  constructor(options: ObserverOptions, scope: string, shared?: Recorder) {
    this.#now = options.now ?? (() => Date.now());
    this.#origin = shared ? shared.#origin : this.#now();
    this.#sink = options.sink ?? null;
    this.#min = SEVERITY_ORDER[options.minSeverity ?? "debug"];
    this.#scope = scope;
    if (shared) this.#events = shared.#events;
  }

  #stamp(): number {
    return this.#now() - this.#origin;
  }

  #name(name: string): string {
    return this.#scope ? `${this.#scope}.${name}` : name;
  }

  record(event: RuntimeEvent): void {
    if (SEVERITY_ORDER[event.severity] < this.#min) return;
    this.#events.push(event);
    if (this.#sink) this.#sink(event);
  }

  log(severity: Severity, name: string, attributes: Record<string, unknown> = {}): void {
    const event: RuntimeEvent = {
      at: this.#stamp(),
      kind: "log",
      name: this.#name(name),
      severity,
      attributes: Object.freeze({ ...attributes }),
    };
    this.record(this.#activeSpan ? { ...event, parentSpanId: this.#activeSpan } : event);
  }

  metric(name: string, value: number, attributes: Record<string, unknown> = {}): void {
    this.record({
      at: this.#stamp(),
      kind: "metric",
      name: this.#name(name),
      severity: "info",
      attributes: Object.freeze({ ...attributes, value }),
    });
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
    const id = `${this.#scope || "root"}-${++this.#spanCounter}`;
    const parent = this.#activeSpan;
    const started = this.#stamp();
    const bag: Record<string, unknown> = { ...attributes };
    this.#activeSpan = id;
    let ended = false;
    const recorder = this;

    return {
      id,
      setAttribute(key: string, value: unknown): void {
        bag[key] = value;
      },
      end(extra: Record<string, unknown> = {}): void {
        if (ended) return;
        ended = true;
        Object.assign(bag, extra);
        const event: RuntimeEvent = {
          at: started,
          kind: "span",
          name: recorder.#name(name),
          severity: bag["error"] ? "error" : "info",
          attributes: Object.freeze({ ...bag }),
          spanId: id,
          durationMs: recorder.#stamp() - started,
        };
        recorder.record(parent ? { ...event, parentSpanId: parent } : event);
        recorder.#activeSpan = parent;
      },
    };
  }

  events(): readonly RuntimeEvent[] {
    return this.#events;
  }

  toJsonLines(): string {
    return this.#events.map((event) => JSON.stringify(event)).join("\n");
  }

  child(scope: string): Observer {
    const options: ObserverOptions = { now: this.#now };
    const next = new Recorder(this.#sink ? { ...options, sink: this.#sink } : options, this.#scope ? `${this.#scope}.${scope}` : scope, this);
    return next;
  }
}

export function createObserver(options: ObserverOptions = {}): Observer {
  return new Recorder(options, "");
}

/** Inert observer, for paths where telemetry is not required. */
export function silentObserver(): Observer {
  return createObserver({ minSeverity: "error", now: () => 0 });
}
