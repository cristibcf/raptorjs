/**
 * The board host.
 *
 * The sixth form of the same contract, and the first in which the host **does
 * not trust the app**. On the other five, an app that hangs merely stays hung:
 * the window stops responding, the service stops serving, the tool hangs. On a
 * board sitting in a panel cabinet, that is not an option - which is why the
 * watchdog exists, and it is not a capability.
 *
 * What else it brings that the other five do not:
 *
 *  - **Peripherals are per instance.** Not "is allowed GPIO", but "is allowed
 *    pin 4, as output". The capability opens the door, the pin list says which.
 *    It is exactly the model desktop uses for `process.spawn`.
 *  - **Sleep is real.** `suspended` from the lifecycle machine is no longer a
 *    metaphor: the app's clock stops, and the wake comes with a reason.
 *  - **The update has rollback.** A new firmware that does not confirm it booted
 *    fine is rolled back on the next reset, not left to turn the board into a
 *    brick.
 */
import { HostError, createLifecycle, serveHost } from "@raptorstack/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptorstack/host";
import type { Board, BusDefinition, PinDefinition } from "./board.ts";

export interface DeviceHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly board: Board;
  /**
   * The pins the app can touch, with their direction. They come from the
   * product's hardware map, not from the app's code.
   */
  readonly pins?: readonly PinDefinition[];
  readonly buses?: readonly BusDefinition[];
  /** The watchdog window. Past it without `watchdog.pet`, the board resets. */
  readonly watchdogMs?: number;
  /** An injectable clock: the tests do not wait for real seconds. */
  readonly now?: () => number;
  readonly storage?: Map<string, string>;
  /** The firmware image offered by the OTA channel. */
  readonly availableFirmware?: { readonly version: string; readonly bytes: number } | null;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface DeviceHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  /** Milliseconds left until reset, or `null` when the watchdog is off. */
  readonly watchdogRemainingMs: number | null;
  readonly resets: readonly string[];
  /** The image applied but not yet confirmed, if any. */
  readonly firmware: { readonly version: string; readonly confirmed: boolean } | null;
  /** The pin state, as the app left it. */
  pinState(pin: number): boolean | undefined;
  /** Advances the board's clock and evaluates the watchdog. */
  tick(ms: number): void;
  /** Wake from the outside (a button, an interrupt). */
  wake(reason?: "timer" | "external"): void;
  close(): void;
}

function requireNumber(params: Readonly<Record<string, unknown>>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter must be a positive integer`, { key, value });
  }
  return value;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/** The same key policy as on the other hosts: a flat space, no paths. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `invalid storage key: ${key}`, {
      key,
      policy: "an NVS partition",
    });
  }
  return key;
}

export function createDeviceHost(options: DeviceHostOptions): DeviceHost {
  const manifest = options.manifest;
  if (manifest.target !== "embedded") {
    throw new HostError("raptor:host/manifest-invalid", "createDeviceHost requires a manifest with target 'embedded'", {
      target: manifest.target,
    });
  }

  const board = options.board;
  // The board's clock: `tick` advances it, so the tests do not wait for real
  // seconds and the watchdog is deterministically verifiable.
  const wallClock = options.now ?? (() => Date.now());
  let clockOffset = 0;
  const now = (): number => wallClock() + clockOffset;
  const store = options.storage ?? new Map<string, string>();
  const pins = new Map(options.pins?.map((definition) => [definition.pin, definition]) ?? []);
  const buses = new Map(options.buses?.map((definition) => [definition.bus, definition]) ?? []);
  const watchdogMs = options.watchdogMs ?? 0;
  const lifecycle = createLifecycle();
  const resets: string[] = [];
  const pinValues = new Map<number, boolean>();

  let lastPet = now();
  let asleep = false;
  let stopped = false;
  let nvsWrites = 0;
  let pendingFirmware: { version: string; confirmed: boolean } | null = null;

  const requirePin = (pin: number, direction: "in" | "out"): PinDefinition => {
    const definition = pins.get(pin);
    if (!definition) {
      throw new HostError("raptor:host/capability-undeclared", `pin ${pin} is not in the hardware map`, {
        pin,
        declared: [...pins.keys()].sort((a, b) => a - b),
      });
    }
    if (definition.direction !== direction) {
      // A write to an input pin is a wiring mistake in code: on a real board it
      // can mean a short, so it is denied before reaching the hardware.
      throw new HostError("raptor:host/capability-unavailable", `pin ${pin} is declared as '${definition.direction}'`, {
        pin,
        label: definition.label ?? null,
        direction: definition.direction,
        attempted: direction,
      });
    }
    return definition;
  };

  /** The board reset: not an exception in the app, but a reboot. */
  const reset = (reason: string): void => {
    if (stopped) return;
    stopped = true;
    resets.push(reason);
    lifecycle.settle("stopped", reason);
    board.reset(reason);
    server.emit("device.reset", { reason });
  };

  const methods: Record<string, MethodHandler> = {
    "watchdog.pet": () => {
      if (watchdogMs === 0) return { watchdogMs: null, remainingMs: null };
      lastPet = now();
      return { watchdogMs, remainingMs: watchdogMs };
    },

    "device.info": () => ({
      ...board.identity,
      freeHeap: board.freeHeap(),
      uptimeMs: now() - startedAt,
      nvsWrites,
      watchdogMs: watchdogMs === 0 ? null : watchdogMs,
    }),

    "hw.gpio.read": (params) => {
      const pin = requireNumber(params, "pin");
      requirePin(pin, "in");
      return { pin, value: board.readNextPin(pin) };
    },

    "hw.gpio.write": (params) => {
      const pin = requireNumber(params, "pin");
      const value = params["value"];
      if (typeof value !== "boolean") {
        throw new HostError("raptor:host/protocol", "hw.gpio.write requires a boolean value", { pin, value });
      }
      requirePin(pin, "out");
      board.writePin(pin, value);
      pinValues.set(pin, value);
      return { pin, value };
    },

    "hw.bus.transfer": (params) => {
      const bus = requireString(params, "bus");
      const address = requireNumber(params, "address");
      const definition = buses.get(bus);
      if (!definition) {
        throw new HostError("raptor:host/capability-undeclared", `bus '${bus}' is not declared`, {
          bus,
          declared: [...buses.keys()].sort(),
        });
      }
      if (!definition.addresses.includes(address)) {
        // The rest of the bus belongs to other peripherals - maybe even
        // critical ones. An undeclared address is not touched.
        throw new HostError("raptor:host/capability-unavailable", `address 0x${address.toString(16)} is not declared on '${bus}'`, {
          bus,
          address,
          declared: definition.addresses.map((value) => `0x${value.toString(16)}`),
        });
      }

      const write = Array.isArray(params["write"]) ? Uint8Array.from(params["write"] as number[]) : new Uint8Array();
      const readLength = params["readLength"] === undefined ? 0 : requireNumber(params, "readLength");
      return { read: [...board.transfer(bus, address, write, readLength)] };
    },

    "power.sleep": async (params) => {
      const durationMs = requireNumber(params, "durationMs");
      asleep = true;
      // Sleep can come from any working state: the path is computed, it is not
      // assumed that the app just started.
      lifecycle.advanceTo("suspended", "sleep");
      server.emit("power.sleeping", { durationMs });

      const reason = await board.sleep(durationMs);
      // The watchdog does not run during sleep: the app's clock is stopped, so
      // the window starts again from the wake.
      lastPet = now();
      asleep = false;
      lifecycle.settle("foreground", `wake (${reason})`);
      server.emit("power.wake", { reason });
      return { slept: durationMs, reason };
    },

    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      reset("the app requested a reboot");
      return { state: lifecycle.state };
    },

    "storage.get": (params) => store.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      const value = requireString(params, "value");
      if (store.get(key) === value) {
        // An identical write does not reach the flash: on NVS, every write
        // costs from the memory's lifetime.
        return { key, written: false, nvsWrites };
      }
      store.set(key, value);
      nvsWrites += 1;
      return { key, written: true, nvsWrites };
    },
    "storage.delete": (params) => {
      const key = requireKey(params);
      const existed = store.delete(key);
      if (existed) nvsWrites += 1;
      return { deleted: existed };
    },
    "storage.keys": () => [...store.keys()].sort(),

    "update.check": () =>
      options.availableFirmware
        ? { available: true, version: options.availableFirmware.version, bytes: options.availableFirmware.bytes, managedBy: "ota" }
        : { available: false, version: manifest.version, managedBy: "ota" },

    "update.confirm": () => {
      if (!pendingFirmware) {
        throw new HostError("raptor:host/unimplemented", "there is no firmware awaiting confirmation", {});
      }
      pendingFirmware = { version: pendingFirmware.version, confirmed: true };
      return { version: pendingFirmware.version, confirmed: true };
    },

    "update.apply": () => {
      if (!options.availableFirmware) {
        throw new HostError("raptor:host/unimplemented", "there is no firmware image to apply", {});
      }
      // The new image starts "unconfirmed": if it is not confirmed after the
      // reboot, the next reset rolls it back. Otherwise a broken firmware would
      // be permanent.
      pendingFirmware = { version: options.availableFirmware.version, confirmed: false };
      reset("new firmware, awaiting confirmation");
      return { applied: true, version: pendingFirmware.version, confirmed: false };
    },
  };

  const startedAt = now();

  /**
   * After a reset, the app that sent the call no longer exists: the firmware
   * rebooted. A delayed call from it gets a clear denial, not a lifecycle
   * transition error - the diagnostics stay readable, though, so someone can
   * find out *why* the board rebooted.
   */
  const READABLE_AFTER_RESET = new Set(["device.info", "lifecycle.state", "storage.get", "storage.keys"]);
  const guarded: Record<string, MethodHandler> = {};
  for (const [name, handler] of Object.entries(methods)) {
    guarded[name] = READABLE_AFTER_RESET.has(name)
      ? handler
      : (params) => {
          if (stopped) {
            throw new HostError("raptor:host/lifecycle", `the board rebooted (${resets.at(-1) ?? "reset"}); the call no longer has a recipient`, {
              method: name,
              reason: resets.at(-1) ?? null,
            });
          }
          return handler(params);
        };
  }

  const serverOptions = {
    target: "embedded" as const,
    capabilities: manifest.capabilities,
    transport: options.transport,
    methods: guarded,
  };
  const server: HostServer = serveHost(
    options.onAudit ? { ...serverOptions, onAudit: options.onAudit } : serverOptions,
  );

  lifecycle.onChange((state, reason) => {
    server.emit("lifecycle.changed", { state, reason });
  });

  return {
    server,
    lifecycle,

    get watchdogRemainingMs(): number | null {
      if (watchdogMs === 0 || stopped) return null;
      return Math.max(0, watchdogMs - (now() - lastPet));
    },

    get resets(): readonly string[] {
      return resets;
    },

    get firmware(): { readonly version: string; readonly confirmed: boolean } | null {
      return pendingFirmware ? { ...pendingFirmware } : null;
    },

    pinState(pin: number): boolean | undefined {
      return pinValues.get(pin);
    },

    tick(ms: number): void {
      clockOffset += ms;
      // During sleep, the watchdog does not run - exactly like on a real board.
      if (stopped || asleep || watchdogMs === 0) return;
      const elapsed = now() - lastPet;
      if (elapsed >= watchdogMs) {
        reset("watchdog");
        return;
      }
      const remaining = watchdogMs - elapsed;
      if (remaining <= watchdogMs / 4) server.emit("watchdog.warning", { remainingMs: remaining });
    },

    wake(reason: "timer" | "external" = "external"): void {
      if (!asleep) return;
      server.emit("power.wake", { reason });
    },

    close(): void {
      if (!stopped) {
        stopped = true;
        lifecycle.settle("stopped", "host closed");
      }
      server.close();
    },
  };
}
