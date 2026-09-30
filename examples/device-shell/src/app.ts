/**
 * The sixth form: a sensor logger on a board.
 *
 * Here the app changes more than in the other five, and it is worth saying why.
 * A notepad on a microcontroller would have been a joke: on a board there is no
 * user to write notes. What stays identical, though, is the shape: state in
 * `@raptor/core` signals, persistence through the host's storage, and everything
 * platform-related through `bridge` - the same three things as in `desktop-shell`
 * or `service-shell`.
 *
 * What is new here, and has no counterpart on the other targets:
 *
 *  - **Watchdog.** The main loop must show signs of life. It is not an option and
 *    cannot be refused: if the app hangs, the host resets the board.
 *  - **Sleep.** Between readings, the board sleeps. The app's clock stops.
 *  - **NVS writes are counted**, because they wear out the flash: the logger
 *    saves only when the value has actually changed enough.
 */
import { derived, state } from "raptorjs";
import type { HostBridge } from "@raptor/host";

export interface Reading {
  readonly value: number;
  readonly atMs: number;
}

export interface Logger {
  readonly readings: () => readonly Reading[];
  readonly lastError: () => string | null;
  /** A derived summary, as on the other targets. */
  readonly summary: () => string;
  /** Reads the saved state and turns on the activity LED. */
  start(): Promise<void>;
  /** A single pass through the loop: shows signs of life, reads, maybe saves. */
  step(): Promise<void>;
  /** The full loop: `count` passes, with sleep between them. */
  run(count: number, sleepMs: number): Promise<void>;
  /** Turns off the LED and leaves the board in a known state. */
  shutdown(): Promise<void>;
}

const READINGS_KEY = "readings";
const LED_PIN = 2;
const SENSOR_BUS = "i2c0";
const SENSOR_ADDRESS = 0x48;

/** Below this difference from the last *saved* value, nothing is written to flash. */
const SIGNIFICANT_CHANGE = 0.5;

export function createLogger(bridge: HostBridge): Logger {
  const readings = state<readonly Reading[]>([]);
  const lastError = state<string | null>(null);
  const awake = state(true);
  // The reference for deduplication is the last *written* value, not the last read:
  // otherwise a slow drift would never reach the flash, no matter how much it grows.
  let lastSaved: number | null = null;

  const summary = derived(() => {
    const last = readings()[readings().length - 1];
    return `${awake() ? "awake" : "asleep"} - ${readings().length} readings` + (last ? `, last ${last.value.toFixed(1)}` : "");
  });

  bridge.on("power.sleeping", () => awake.set(false));
  bridge.on("power.wake", () => awake.set(true));
  bridge.on("watchdog.warning", (payload) => {
    // A warning is not an error: it is exactly the moment when a long loop must
    // break and show signs of life.
    lastError.set(`watchdog: ${String(payload["remainingMs"])}ms remaining`);
  });

  const led = async (on: boolean): Promise<void> => {
    if (!bridge.allows("hw.gpio.write")) return;
    await bridge.call("hw.gpio.write", { pin: LED_PIN, value: on });
  };

  /** The sensor answers with two bytes; the conversion is the app's, not the host's. */
  const readSensor = async (): Promise<number | null> => {
    if (!bridge.allows("hw.bus.transfer")) return null;
    const answer = await bridge.call<{ read: number[] }>("hw.bus.transfer", {
      bus: SENSOR_BUS,
      address: SENSOR_ADDRESS,
      write: [0x00],
      readLength: 2,
    });
    const raw = ((answer.read[0] ?? 0) << 8) | (answer.read[1] ?? 0);
    return Math.round((raw / 256) * 10) / 10;
  };

  return {
    readings: () => readings(),
    lastError: () => lastError(),
    summary: () => summary(),

    async start(): Promise<void> {
      const stored = await bridge.call<string | null>("storage.get", { key: READINGS_KEY });
      if (stored) {
        const previous = JSON.parse(stored) as Reading[];
        readings.set(previous);
        lastSaved = previous[previous.length - 1]?.value ?? null;
      }
      await led(true);
    },

    async step(): Promise<void> {
      // The signs of life come first: if the reading below hangs, at least the
      // window was refreshed beforehand.
      await bridge.call("watchdog.pet");

      const value = await readSensor();
      if (value === null) return;

      const info = await bridge.call<{ uptimeMs: number }>("device.info");
      const next = [...readings(), { value, atMs: info.uptimeMs }];
      readings.set(next);

      // The flash wears out: we save only when the value has moved far enough from
      // the last saved one - so even a slow drift reaches the disk, just less often.
      if (lastSaved === null || Math.abs(lastSaved - value) >= SIGNIFICANT_CHANGE) {
        await bridge.call("storage.set", { key: READINGS_KEY, value: JSON.stringify(next) });
        lastSaved = value;
      }
    },

    async run(count: number, sleepMs: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        await this.step();
        if (index === count - 1) break;
        if (bridge.allows("power.sleep")) await bridge.call("power.sleep", { durationMs: sleepMs });
      }
    },

    async shutdown(): Promise<void> {
      await led(false);
      await bridge.call("storage.set", { key: READINGS_KEY, value: JSON.stringify(readings()) });
    },
  };
}
