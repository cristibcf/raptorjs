/**
 * Wiring the logger to the board.
 *
 * The hardware map - which pins, which buses, which addresses - comes from
 * outside the app, like the port for the service and the command list for the
 * desktop. Pin 2 is the LED, pin 5 the button (input), and the sensor sits at
 * 0x48 on i2c0. Anything not on the list cannot be touched.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptorstack/host";
import type { HostBridge, HostManifest } from "@raptorstack/host";
import { createDeviceHost } from "@raptorstack/host/device";
import type { Board, DeviceHost, PinDefinition } from "@raptorstack/host/device";
import { createLogger } from "./app.ts";
import type { Logger } from "./app.ts";

export const PINS: readonly PinDefinition[] = [
  { pin: 2, direction: "out", label: "activity-led" },
  { pin: 5, direction: "in", label: "user-button" },
];

export const BUSES = [{ bus: "i2c0", addresses: [0x48] }] as const;

export interface SessionOptions {
  readonly board: Board;
  readonly capabilities?: readonly string[];
  readonly storage?: Map<string, string>;
  readonly watchdogMs?: number;
  readonly now?: () => number;
  readonly availableFirmware?: { readonly version: string; readonly bytes: number } | null;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: DeviceHost;
  readonly bridge: HostBridge;
  readonly logger: Logger;
  close(): void;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "embedded",
      bundleId: "com.raptor.sensor-logger",
      displayName: "Raptor Sensor Logger",
      version: "0.1.0",
      entry: "./src/app.ts",
      capabilities,
      allowedOrigins: [],
      deepLinkSchemes: [],
      update: { feed: null, channel: "stable" },
    }),
  );
}

export function createSession(options: SessionOptions): Session {
  const manifest = manifestFor(options.capabilities ?? ["hw.gpio", "hw.bus", "power.sleep"]);
  const channel = createMemoryChannel();

  const host = createDeviceHost({
    manifest,
    transport: channel.host,
    board: options.board,
    pins: PINS,
    buses: BUSES.map((entry) => ({ bus: entry.bus, addresses: [...entry.addresses] })),
    watchdogMs: options.watchdogMs ?? 2000,
    ...(options.now ? { now: options.now } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.availableFirmware ? { availableFirmware: options.availableFirmware } : {}),
  });

  const bridge = createBridge({
    target: "embedded",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 5000,
  });

  return {
    manifest,
    host,
    bridge,
    logger: createLogger(bridge),
    close(): void {
      host.close();
      bridge.dispose("session ended");
    },
  };
}

/**
 * A simulated board, with a sensor that rises slowly.
 *
 * The real firmware would implement the same interface over the chip's registers;
 * the app sees no difference.
 */
export function simulatedBoard(
  options: { readonly start?: number; readonly step?: number; readonly blockSleep?: boolean } = {},
): Board & {
  readonly writes: Array<{ pin: number; value: boolean }>;
  readonly resets: string[];
  readonly sleeps: number[];
  /** Ends the current sleep; only has an effect with `blockSleep`. */
  finishSleep(): void;
} {
  const writes: Array<{ pin: number; value: boolean }> = [];
  const resets: string[] = [];
  const sleeps: number[] = [];
  let temperature = options.start ?? 21;
  let release: ((reason: "timer" | "external") => void) | null = null;

  return {
    writes,
    resets,
    sleeps,
    finishSleep: () => {
      release?.("timer");
      release = null;
    },
    identity: { chip: "raptor-sim32", firmware: "0.1.0", resetReason: "power-on" },
    readNextPin: () => false,
    writePin: (pin, value) => {
      writes.push({ pin, value });
    },
    transfer: (_bus, _address, _write, readLength) => {
      temperature += options.step ?? 0.7;
      const raw = Math.round(temperature * 256);
      const bytes = new Uint8Array([(raw >> 8) & 0xff, raw & 0xff]);
      return bytes.slice(0, readLength);
    },
    freeHeap: () => 48_000,
    reset: (reason) => {
      resets.push(reason);
    },
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      // Without `blockSleep`, the sleep ends in the same microtask - which is
      // convenient for the demo, but makes everything that happens *during* it invisible.
      if (!options.blockSleep) return "timer";
      return await new Promise<"timer" | "external">((resolve) => {
        release = resolve;
      });
    },
  };
}
