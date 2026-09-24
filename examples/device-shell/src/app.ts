/**
 * A sasea forma: un logger de senzor pe o placheta.
 *
 * Aici aplicatia se schimba mai mult decat la celelalte cinci, si merita spus de
 * ce. Un carnet de note pe un microcontroler ar fi fost o gluma: pe o placheta
 * nu exista utilizator care sa scrie note. Ce ramane insa identic este forma:
 * starea in semnale `@raptor/core`, persistenta prin stocarea host-ului, si tot
 * ce tine de platforma prin `bridge` - aceleasi trei lucruri ca in
 * `desktop-shell` sau `service-shell`.
 *
 * Ce e nou aici, si nu are corespondent pe celelalte tinte:
 *
 *  - **Watchdog.** Bucla principala trebuie sa dea semne de viata. Nu e o
 *    optiune si nu se poate refuza: daca aplicatia se blocheaza, host-ul
 *    reseteaza placheta.
 *  - **Somn.** Intre citiri, placheta doarme. Ceasul aplicatiei se opreste.
 *  - **Scrierile in NVS se numara**, pentru ca uzeaza flash-ul: logger-ul
 *    salveaza doar cand valoarea chiar s-a schimbat destul.
 */
import { derived, state } from "@raptor/core";
import type { HostBridge } from "@raptor/host";

export interface Reading {
  readonly value: number;
  readonly atMs: number;
}

export interface Logger {
  readonly readings: () => readonly Reading[];
  readonly lastError: () => string | null;
  /** Rezumat derivat, ca pe celelalte tinte. */
  readonly summary: () => string;
  /** Citeste starea salvata si aprinde LED-ul de activitate. */
  start(): Promise<void>;
  /** O singura trecere prin bucla: da semne de viata, citeste, poate salveaza. */
  step(): Promise<void>;
  /** Bucla completa: `count` treceri, cu somn intre ele. */
  run(count: number, sleepMs: number): Promise<void>;
  /** Stinge LED-ul si lasa placheta intr-o stare cunoscuta. */
  shutdown(): Promise<void>;
}

const READINGS_KEY = "readings";
const LED_PIN = 2;
const SENSOR_BUS = "i2c0";
const SENSOR_ADDRESS = 0x48;

/** Sub aceasta diferenta fata de ultima valoare *salvata*, nu se scrie in flash. */
const SIGNIFICANT_CHANGE = 0.5;

export function createLogger(bridge: HostBridge): Logger {
  const readings = state<readonly Reading[]>([]);
  const lastError = state<string | null>(null);
  const awake = state(true);
  // Referinta pentru deduplicare este ultima valoare *scrisa*, nu ultima citita:
  // altfel o deriva lenta nu ar ajunge niciodata in flash, oricat ar creste.
  let lastSaved: number | null = null;

  const summary = derived(() => {
    const last = readings()[readings().length - 1];
    return `${awake() ? "treaz" : "adormit"} - ${readings().length} citiri` + (last ? `, ultima ${last.value.toFixed(1)}` : "");
  });

  bridge.on("power.sleeping", () => awake.set(false));
  bridge.on("power.wake", () => awake.set(true));
  bridge.on("watchdog.warning", (payload) => {
    // Un avertisment nu este o eroare: este exact momentul in care o bucla
    // lunga trebuie sa se intrerupa si sa dea semne de viata.
    lastError.set(`watchdog: ${String(payload["remainingMs"])}ms ramase`);
  });

  const led = async (on: boolean): Promise<void> => {
    if (!bridge.allows("hw.gpio.write")) return;
    await bridge.call("hw.gpio.write", { pin: LED_PIN, value: on });
  };

  /** Senzorul raspunde cu doi octeti; conversia este a aplicatiei, nu a host-ului. */
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
      // Semnele de viata se dau intai: daca citirea de mai jos atarna, macar
      // fereastra a fost reimprospatata inainte.
      await bridge.call("watchdog.pet");

      const value = await readSensor();
      if (value === null) return;

      const info = await bridge.call<{ uptimeMs: number }>("device.info");
      const next = [...readings(), { value, atMs: info.uptimeMs }];
      readings.set(next);

      // Flash-ul se uzeaza: salvam doar cand valoarea s-a departat destul de
      // ultima salvata - deci si o deriva lenta ajunge pe disc, doar mai rar.
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
