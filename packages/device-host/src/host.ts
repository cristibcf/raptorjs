/**
 * Host-ul de placheta.
 *
 * A sasea forma a aceluiasi contract, si prima in care host-ul **nu are
 * incredere in aplicatie**. Pe celelalte cinci, o aplicatie care se blocheaza
 * ramane doar blocata: fereastra nu mai raspunde, serviciul nu mai serveste,
 * unealta atarna. Pe o placheta care sta intr-un dulap de tablou, asta nu este
 * o optiune - de aceea exista watchdog-ul, iar el nu este o capabilitate.
 *
 * Ce mai aduce nou fata de celelalte cinci:
 *
 *  - **Perifericele sunt per instanta.** Nu "are voie la GPIO", ci "are voie la
 *    pinul 4, ca iesire". Capabilitatea deschide usa, lista de pini spune care.
 *    Este exact modelul pe care il foloseste si desktopul pentru `process.spawn`.
 *  - **Somnul este adevarat.** `suspended` din masina de lifecycle nu mai este o
 *    metafora: ceasul aplicatiei se opreste, iar trezirea vine cu un motiv.
 *  - **Actualizarea are rollback.** Un firmware nou care nu confirma ca a pornit
 *    bine este dat inapoi la urmatorul reset, nu lasat sa transforme placheta
 *    intr-o caramida.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";
import type { Board, BusDefinition, PinDefinition } from "./board.ts";

export interface DeviceHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly board: Board;
  /**
   * Pinii pe care aplicatia ii poate atinge, cu directia lor. Vin din harta de
   * hardware a produsului, nu din codul aplicatiei.
   */
  readonly pins?: readonly PinDefinition[];
  readonly buses?: readonly BusDefinition[];
  /** Fereastra de watchdog. Peste ea fara `watchdog.pet`, placheta se reseteaza. */
  readonly watchdogMs?: number;
  /** Ceas injectabil: testele nu asteapta secunde reale. */
  readonly now?: () => number;
  readonly storage?: Map<string, string>;
  /** Imaginea de firmware oferita de canalul OTA. */
  readonly availableFirmware?: { readonly version: string; readonly bytes: number } | null;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface DeviceHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  /** Milisecunde ramase pana la reset, sau `null` cand watchdog-ul e oprit. */
  readonly watchdogRemainingMs: number | null;
  readonly resets: readonly string[];
  /** Imaginea aplicata dar inca neconfirmata, daca exista. */
  readonly firmware: { readonly version: string; readonly confirmed: boolean } | null;
  /** Starea pinilor, asa cum a lasat-o aplicatia. */
  pinState(pin: number): boolean | undefined;
  /** Avanseaza ceasul plachetei si evalueaza watchdog-ul. */
  tick(ms: number): void;
  /** Trezire din exterior (buton, intrerupere). */
  wake(reason?: "timer" | "external"): void;
  close(): void;
}

function requireNumber(params: Readonly<Record<string, unknown>>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' trebuie sa fie un intreg pozitiv`, { key, value });
  }
  return value;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/** Aceeasi politica de chei ca pe celelalte host-uri: spatiu plat, fara cai. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `cheie de stocare invalida: ${key}`, {
      key,
      policy: "partitie de NVS",
    });
  }
  return key;
}

export function createDeviceHost(options: DeviceHostOptions): DeviceHost {
  const manifest = options.manifest;
  if (manifest.target !== "embedded") {
    throw new HostError("raptor:host/manifest-invalid", "createDeviceHost cere un manifest cu target 'embedded'", {
      target: manifest.target,
    });
  }

  const board = options.board;
  // Ceasul plachetei: `tick` il avanseaza, ca testele sa nu astepte secunde
  // reale si ca watchdog-ul sa fie verificabil determinist.
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
      throw new HostError("raptor:host/capability-undeclared", `pinul ${pin} nu este in harta de hardware`, {
        pin,
        declared: [...pins.keys()].sort((a, b) => a - b),
      });
    }
    if (definition.direction !== direction) {
      // O scriere pe un pin de intrare este o greseala de cablaj in cod: pe o
      // placheta reala poate insemna un scurt, deci se refuza inainte de hardware.
      throw new HostError("raptor:host/capability-unavailable", `pinul ${pin} este declarat ca '${definition.direction}'`, {
        pin,
        label: definition.label ?? null,
        direction: definition.direction,
        attempted: direction,
      });
    }
    return definition;
  };

  /** Resetul plachetei: nu o exceptie in aplicatie, ci o repornire. */
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
        throw new HostError("raptor:host/protocol", "hw.gpio.write cere o valoare booleana", { pin, value });
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
        throw new HostError("raptor:host/capability-undeclared", `magistrala '${bus}' nu este declarata`, {
          bus,
          declared: [...buses.keys()].sort(),
        });
      }
      if (!definition.addresses.includes(address)) {
        // Restul magistralei apartine altor periferice - poate chiar unora
        // critice. Adresa nedeclarata nu se atinge.
        throw new HostError("raptor:host/capability-unavailable", `adresa 0x${address.toString(16)} nu este declarata pe '${bus}'`, {
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
      // Somnul poate veni din orice stare de lucru: drumul se calculeaza, nu se
      // presupune ca aplicatia tocmai a pornit.
      lifecycle.advanceTo("suspended", "somn");
      server.emit("power.sleeping", { durationMs });

      const reason = await board.sleep(durationMs);
      // Watchdog-ul nu curge in somn: ceasul aplicatiei este oprit, deci
      // fereastra incepe din nou de la trezire.
      lastPet = now();
      asleep = false;
      lifecycle.settle("foreground", `trezire (${reason})`);
      server.emit("power.wake", { reason });
      return { slept: durationMs, reason };
    },

    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      reset("aplicatia a cerut repornirea");
      return { state: lifecycle.state };
    },

    "storage.get": (params) => store.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      const value = requireString(params, "value");
      if (store.get(key) === value) {
        // O scriere identica nu ajunge la flash: pe NVS, fiecare scriere costa
        // din durata de viata a memoriei.
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
        throw new HostError("raptor:host/unimplemented", "nu exista firmware in asteptarea confirmarii", {});
      }
      pendingFirmware = { version: pendingFirmware.version, confirmed: true };
      return { version: pendingFirmware.version, confirmed: true };
    },

    "update.apply": () => {
      if (!options.availableFirmware) {
        throw new HostError("raptor:host/unimplemented", "nu exista nicio imagine de firmware de aplicat", {});
      }
      // Imaginea noua porneste "neconfirmata": daca nu se confirma dupa repornire,
      // urmatorul reset o da inapoi. Altfel un firmware stricat ar fi definitiv.
      pendingFirmware = { version: options.availableFirmware.version, confirmed: false };
      reset("firmware nou, in asteptarea confirmarii");
      return { applied: true, version: pendingFirmware.version, confirmed: false };
    },
  };

  const startedAt = now();

  /**
   * Dupa un reset, aplicatia care a trimis apelul nu mai exista: firmware-ul a
   * repornit. Un apel intarziat de la ea primeste un refuz limpede, nu o eroare
   * de tranzitie de lifecycle - diagnosticele raman insa citibile, ca cineva sa
   * poata afla *de ce* a repornit placheta.
   */
  const READABLE_AFTER_RESET = new Set(["device.info", "lifecycle.state", "storage.get", "storage.keys"]);
  const guarded: Record<string, MethodHandler> = {};
  for (const [name, handler] of Object.entries(methods)) {
    guarded[name] = READABLE_AFTER_RESET.has(name)
      ? handler
      : (params) => {
          if (stopped) {
            throw new HostError("raptor:host/lifecycle", `placheta a repornit (${resets.at(-1) ?? "reset"}); apelul nu mai are destinatar`, {
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
      // In somn, watchdog-ul nu curge - exact ca pe o placheta reala.
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
        lifecycle.settle("stopped", "host inchis");
      }
      server.close();
    },
  };
}
