/**
 * The JS <-> native host bridge protocol (roadmap section 6).
 *
 * It is a protocol of correlated requests plus events, serialized as JSON per
 * line. The format is deliberately boring: the boundary crosses into a native
 * process written in another language, so it must be trivial to implement
 * correctly in Rust too, not just in JavaScript.
 *
 * Decoding treats the input as hostile: any frame that does not match the shape
 * is rejected with `raptor:host/protocol`, and inherited keys (`__proto__`)
 * never end up on an object we built.
 */
import { HostError } from "./errors.ts";

export const PROTOCOL_VERSION = 1;

export interface CallFrame {
  readonly kind: "call";
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ResultFrame {
  readonly kind: "result";
  readonly id: number;
  readonly value: unknown;
}

export interface FailureFrame {
  readonly kind: "failure";
  readonly id: number;
  readonly error: { readonly code: string; readonly message: string; readonly detail?: Record<string, unknown> };
}

export interface EventFrame {
  readonly kind: "event";
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type Frame = CallFrame | ResultFrame | FailureFrame | EventFrame;

/**
 * The bridge methods and the capability each one requires.
 *
 * `null` means core host functionality: the lifecycle, deep links and updates
 * are not optional modules but responsibilities of the adapter itself
 * (section 6). Everything else is tied to the matrix.
 */
export const METHOD_CAPABILITY: Readonly<Record<string, string | null>> = {
  /**
   * What the backing adapter actually implements. A granted capability only
   * says the app *is allowed*; it does not say the current host *can* - menus
   * exist on desktop and not in the browser, though both belong to the same
   * capability. Without this, an interface that shows its own options would lie.
   */
  "host.describe": null,
  "lifecycle.state": null,
  "lifecycle.requestStop": null,
  "deeplink.pending": null,
  "update.check": null,
  "update.apply": null,
  /**
   * *Reading* the current route does not mean controlling navigation: the app
   * needs to know which screen it is drawing, especially at startup and after
   * a resume from suspension, when it has seen no `navigation.changed`. Control
   * stays with the adapter - there is no method for the app to request a route.
   */
  "navigation.current": null,

  "window.open": "window.manage",
  "window.close": "window.manage",
  "window.setTitle": "window.manage",
  "window.navigate": "window.manage",
  "window.list": "window.manage",
  // Menus are a desktop responsibility (section 6) and belong to the same
  // scope as windows: on mobile they do not exist, so the method does not answer.
  "menu.set": "window.manage",

  "storage.get": "app.storage",
  "storage.set": "app.storage",
  "storage.delete": "app.storage",
  "storage.keys": "app.storage",

  /**
   * A service reports on its own whether it can take traffic. It requires no
   * capability: a host that does not know the app is no longer ready would send
   * requests into a process that is draining.
   */
  /**
   * Arguments, streams and the exit code are to a tool what the window and the
   * screen are to an app with a UI: not optional modules, but its very
   * substance. That is why they require no capability.
   */
  /**
   * The watchdog requires no capability, nor can it be turned off from the app:
   * it is the only place in the whole contract where the host **does not trust**
   * it. A capability that could be denied would turn the very mechanism that
   * saves the board into an optional one.
   */
  "watchdog.pet": null,
  "device.info": null,
  /** Confirms the new firmware booted fine; without it, a rollback follows. */
  "update.confirm": null,

  "hw.gpio.read": "hw.gpio",
  "hw.gpio.write": "hw.gpio",
  "hw.bus.transfer": "hw.bus",
  "power.sleep": "power.sleep",

  "cli.args": null,
  "cli.write": null,
  "cli.exit": null,
  "tty.info": null,
  /** *Asking* the user, however, requires an interactive terminal. */
  "cli.prompt": "tty.interact",
  "cli.confirm": "tty.interact",

  "health.set": null,
  "serve.listen": "net.listen",
  /** The app's response to a `serve.request` received as an event. */
  "serve.respond": "net.listen",
  "serve.stop": "net.listen",
  "serve.status": "net.listen",
  "config.get": "service.config",

  "notify.show": "device.notifications",
  "camera.capture": "device.camera",
  "location.current": "device.location",
  "files.pick": "device.files",
  "process.spawn": "process.spawn",
};

export const METHODS: readonly string[] = Object.keys(METHOD_CAPABILITY).sort();

export function capabilityForMethod(method: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(METHOD_CAPABILITY, method)) {
    throw new HostError("raptor:host/method-unknown", `method '${method}' does not exist in the host bridge`, {
      method,
      known: METHODS,
    });
  }
  return METHOD_CAPABILITY[method] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys that, when assigned, touch the prototype instead of becoming properties. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * How deeply a frame may be nested.
 *
 * V8's `JSON.parse` is iterative and handles tens of thousands of levels
 * without blinking; `sanitize` is recursive and fell over with `RangeError:
 * Maximum call stack size exceeded` around 5000. It was caught by the callers'
 * `try/catch`, so it took nothing down - but a frame rejected with "stack full"
 * instead of "too deep" says something broke on our side, when in fact the
 * limit is a choice.
 *
 * 64 is well above any real bridge frame and well below the stack.
 */
const MAX_FRAME_DEPTH = 64;

/**
 * RECURSIVELY strips dangerous keys from a value that came off the bridge.
 *
 * `JSON.parse` produces `__proto__` as an **own** property, so the decoded
 * object is harmless in itself. The danger appears at the first consumer that
 * does `Object.assign({}, ...)` or `target[key] = value` with it - that is
 * where the prototype setter fires.
 *
 * Cleaning only the first level would leave `{ options: { __proto__: {...} } }`
 * intact, and this file's premise is that nothing in a frame can touch the
 * prototype. So it descends everywhere (audit 2026-09-24, S9).
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_FRAME_DEPTH) {
    throw new HostError("raptor:host/protocol", `frame nested more than ${MAX_FRAME_DEPTH} levels deep`, {
      limit: MAX_FRAME_DEPTH,
    });
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = sanitize(value[key], depth + 1);
  }
  return out;
}

/** A copy without inherited keys: nothing in a frame can touch the prototype. */
function plain(value: unknown, where: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new HostError("raptor:host/protocol", `${where} must be an object`, { received: typeof value });
  }
  return sanitize(value) as Record<string, unknown>;
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(line: string): Frame {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new HostError("raptor:host/protocol", `frame that is not JSON: ${(error as Error).message}`, {});
  }
  if (!isRecord(raw)) {
    throw new HostError("raptor:host/protocol", "the frame must be a JSON object", {});
  }

  const kind = raw["kind"];
  if (kind === "call") {
    const id = raw["id"];
    const method = raw["method"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "a 'call' frame requires an integer id", { id });
    }
    if (typeof method !== "string" || method.length === 0) {
      throw new HostError("raptor:host/protocol", "a 'call' frame requires a method name", { method });
    }
    return { kind: "call", id, method, params: plain(raw["params"], "params") };
  }

  if (kind === "result") {
    const id = raw["id"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "a 'result' frame requires an integer id", { id });
    }
    return { kind: "result", id, value: raw["value"] };
  }

  if (kind === "failure") {
    const id = raw["id"];
    const error = raw["error"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "a 'failure' frame requires an integer id", { id });
    }
    if (!isRecord(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") {
      throw new HostError("raptor:host/protocol", "a 'failure' frame requires { code, message }", {});
    }
    const detail = error["detail"] === undefined ? undefined : plain(error["detail"], "error.detail");
    return {
      kind: "failure",
      id,
      error: detail === undefined ? { code: error["code"], message: error["message"] } : { code: error["code"], message: error["message"], detail },
    };
  }

  if (kind === "event") {
    const name = raw["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw new HostError("raptor:host/protocol", "an 'event' frame requires a name", { name });
    }
    return { kind: "event", name, payload: plain(raw["payload"], "payload") };
  }

  throw new HostError("raptor:host/protocol", `unknown frame type: ${String(kind)}`, { kind });
}
