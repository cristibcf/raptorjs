/**
 * Legarea logger-ului de placheta.
 *
 * Harta de hardware - ce pini, ce magistrale, ce adrese - vine din afara
 * aplicatiei, ca portul la serviciu si ca lista de comenzi la desktop. Pinul 2
 * este LED-ul, pinul 5 butonul (intrare), iar senzorul sta la 0x48 pe i2c0.
 * Tot ce nu e pe lista nu se poate atinge.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDeviceHost } from "@raptor/device-host";
import type { Board, DeviceHost, PinDefinition } from "@raptor/device-host";
import { createLogger } from "./app.ts";
import type { Logger } from "./app.ts";

export const PINS: readonly PinDefinition[] = [
  { pin: 2, direction: "out", label: "led-activitate" },
  { pin: 5, direction: "in", label: "buton-utilizator" },
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
      bridge.dispose("sesiune incheiata");
    },
  };
}

/**
 * O placheta simulata, cu un senzor care urca incet.
 *
 * Firmware-ul real ar implementa aceeasi interfata peste registrele chipului;
 * aplicatia nu vede diferenta.
 */
export function simulatedBoard(
  options: { readonly start?: number; readonly step?: number; readonly blockSleep?: boolean } = {},
): Board & {
  readonly writes: Array<{ pin: number; value: boolean }>;
  readonly resets: string[];
  readonly sleeps: number[];
  /** Termina somnul in curs; are efect doar cu `blockSleep`. */
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
      // Fara `blockSleep`, somnul se termina in aceeasi microtask - ceea ce este
      // comod pentru demo, dar face invizibil tot ce se intampla *in timpul* lui.
      if (!options.blockSleep) return "timer";
      return await new Promise<"timer" | "external">((resolve) => {
        release = resolve;
      });
    },
  };
}
