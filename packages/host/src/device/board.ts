/**
 * The board, as an interface.
 *
 * Pins and buses are not just "a resource": on a real board, a wrongly written
 * pin can short something out or hold a relay closed. That is why the
 * description here is stricter than on the other hosts - each pin has a
 * declared direction, and the host denies a write to a pin declared as input
 * before it reaches the hardware.
 *
 * As everywhere in this family of adapters, the board is injected: a test runs
 * on a simulated one, the real firmware on an actual one, and the app's code
 * sees no difference.
 */

export type PinDirection = "in" | "out";

export interface PinDefinition {
  readonly pin: number;
  readonly direction: PinDirection;
  /** The name from the schematic; appears in diagnostics, so it is not all numbers. */
  readonly label?: string;
}

export interface BusDefinition {
  readonly bus: string;
  /** The addresses on the bus the app is allowed to touch. */
  readonly addresses: readonly number[];
}

export interface DeviceIdentity {
  readonly chip: string;
  readonly firmware: string;
  /** Why it last booted: power-on, software reset, or watchdog. */
  readonly resetReason: "power-on" | "software" | "watchdog" | "wake";
}

export interface Board {
  readonly identity: DeviceIdentity;
  readNextPin(pin: number): boolean;
  writePin(pin: number, value: boolean): void;
  /** A transfer on the bus; returns the bytes read. */
  transfer(bus: string, address: number, write: Uint8Array, readLength: number): Uint8Array;
  /** Free bytes in the heap; on a board it is a number that matters. */
  freeHeap(): number;
  /** Hardware reset. The host calls it when the watchdog expires. */
  reset(reason: string): void;
  /** Sleep; returns the wake reason. */
  sleep(durationMs: number): Promise<"timer" | "external">;
}
