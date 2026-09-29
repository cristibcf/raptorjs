/**
 * Protocolul puntii JS <-> host nativ (roadmap sectiunea 6).
 *
 * Este un protocol de cereri corelate plus evenimente, serializat ca JSON pe
 * linie. Formatul este deliberat plictisitor: granita trece printr-un proces
 * nativ scris in alta limba, deci trebuie sa fie trivial de implementat corect
 * si in Rust, nu doar in JavaScript.
 *
 * Decodarea trateaza intrarea ca ostila: orice cadru care nu respecta forma este
 * respins cu `raptor:host/protocol`, iar cheile mostenite (`__proto__`) nu ajung
 * niciodata pe un obiect construit de noi.
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
 * Metodele puntii si capabilitatea ceruta de fiecare.
 *
 * `null` inseamna functionalitate de baza a host-ului: ciclul de viata, deep
 * link-urile si actualizarile nu sunt module optionale, ci responsabilitati ale
 * adaptorului insusi (sectiunea 6). Tot restul este legat de matrice.
 */
export const METHOD_CAPABILITY: Readonly<Record<string, string | null>> = {
  /**
   * Ce implementeaza efectiv adaptorul din spate. O capabilitate acordata spune
   * doar ca aplicatia *are voie*; nu spune ca host-ul curent *poate* - meniurile
   * exista pe desktop si nu exista in browser, desi tin de aceeasi capabilitate.
   * Fara asta, o interfata care isi arata singura posibilitatile ar minti.
   */
  "host.describe": null,
  "lifecycle.state": null,
  "lifecycle.requestStop": null,
  "deeplink.pending": null,
  "update.check": null,
  "update.apply": null,
  /**
   * A *citi* ruta curenta nu inseamna a controla navigarea: aplicatia trebuie sa
   * stie ce ecran deseneaza, mai ales la pornire si dupa o reluare din
   * suspendare, cand nu a vazut niciun `navigation.changed`. Controlul ramane la
   * adaptor - nu exista o metoda prin care aplicatia sa ceara o ruta.
   */
  "navigation.current": null,

  "window.open": "window.manage",
  "window.close": "window.manage",
  "window.setTitle": "window.manage",
  "window.navigate": "window.manage",
  "window.list": "window.manage",
  // Meniurile sunt o responsabilitate de desktop (sectiunea 6) si tin de acelasi
  // domeniu ca ferestrele: pe mobil nu exista, deci nici metoda nu raspunde.
  "menu.set": "window.manage",

  "storage.get": "app.storage",
  "storage.set": "app.storage",
  "storage.delete": "app.storage",
  "storage.keys": "app.storage",

  /**
   * Un serviciu raporteaza singur daca poate primi trafic. Nu cere capabilitate:
   * un host care nu stie ca aplicatia nu mai e gata ar trimite cereri intr-un
   * proces care tocmai se dreneaza.
   */
  /**
   * Argumentele, fluxurile si codul de iesire sunt pentru o unealta ce sunt
   * fereastra si ecranul pentru o aplicatie cu interfata: nu module optionale,
   * ci chiar substanta ei. De aceea nu cer capabilitate.
   */
  /**
   * Watchdog-ul nu cere capabilitate, si nici nu poate fi oprit din aplicatie:
   * este singurul loc din tot contractul unde host-ul **nu are incredere** in ea.
   * O capabilitate care s-ar putea refuza ar transforma exact mecanismul care
   * salveaza placheta intr-unul optional.
   */
  "watchdog.pet": null,
  "device.info": null,
  /** Confirma ca firmware-ul nou a pornit bine; fara ea, urmeaza rollback. */
  "update.confirm": null,

  "hw.gpio.read": "hw.gpio",
  "hw.gpio.write": "hw.gpio",
  "hw.bus.transfer": "hw.bus",
  "power.sleep": "power.sleep",

  "cli.args": null,
  "cli.write": null,
  "cli.exit": null,
  "tty.info": null,
  /** A *intreba* utilizatorul cere insa terminal interactiv. */
  "cli.prompt": "tty.interact",
  "cli.confirm": "tty.interact",

  "health.set": null,
  "serve.listen": "net.listen",
  /** Raspunsul aplicatiei la un `serve.request` primit ca eveniment. */
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
    throw new HostError("raptor:host/method-unknown", `metoda '${method}' nu exista in puntea de host`, {
      method,
      known: METHODS,
    });
  }
  return METHOD_CAPABILITY[method] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chei care, la atribuire, ating prototipul in loc sa devina proprietati. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Cat de adanc poate fi imbricat un cadru.
 *
 * `JSON.parse` din V8 e iterativ si duce zeci de mii de niveluri fara sa
 * clipeasca; `sanitize` e recursiv si cadea cu `RangeError: Maximum call stack
 * size exceeded` pe la 5000. Era prins de `try/catch`-ul apelantilor, deci nu
 * dobora nimic - dar un cadru refuzat cu "stiva plina" in loc de "prea adanc"
 * spune ca s-a stricat ceva la noi, cand de fapt limita e o alegere.
 *
 * 64 e cu mult peste orice cadru real de punte si cu mult sub stiva.
 */
const MAX_FRAME_DEPTH = 64;

/**
 * Curata RECURSIV cheile periculoase dintr-o valoare venita de pe punte.
 *
 * `JSON.parse` produce `__proto__` ca proprietate **proprie**, deci obiectul
 * decodat e inofensiv in sine. Pericolul apare la primul consumator care face
 * `Object.assign({}, ...)` sau `tinta[cheie] = valoare` cu ea - acolo setter-ul
 * de prototip se declanseaza.
 *
 * O curatare doar la primul nivel ar lasa `{ optiuni: { __proto__: {...} } }`
 * intact, iar fisierul asta isi pune ca titlu ca nimic din cadru nu poate
 * atinge prototipul. Deci coboara peste tot (audit 2026-09-24, S9).
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_FRAME_DEPTH) {
    throw new HostError("raptor:host/protocol", `cadru imbricat pe mai mult de ${MAX_FRAME_DEPTH} niveluri`, {
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

/** Copie fara chei mostenite: nimic din cadru nu poate atinge prototipul. */
function plain(value: unknown, where: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new HostError("raptor:host/protocol", `${where} trebuie sa fie un obiect`, { received: typeof value });
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
    throw new HostError("raptor:host/protocol", `cadru care nu este JSON: ${(error as Error).message}`, {});
  }
  if (!isRecord(raw)) {
    throw new HostError("raptor:host/protocol", "cadrul trebuie sa fie un obiect JSON", {});
  }

  const kind = raw["kind"];
  if (kind === "call") {
    const id = raw["id"];
    const method = raw["method"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "cadrul 'call' cere un id intreg", { id });
    }
    if (typeof method !== "string" || method.length === 0) {
      throw new HostError("raptor:host/protocol", "cadrul 'call' cere un nume de metoda", { method });
    }
    return { kind: "call", id, method, params: plain(raw["params"], "params") };
  }

  if (kind === "result") {
    const id = raw["id"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "cadrul 'result' cere un id intreg", { id });
    }
    return { kind: "result", id, value: raw["value"] };
  }

  if (kind === "failure") {
    const id = raw["id"];
    const error = raw["error"];
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new HostError("raptor:host/protocol", "cadrul 'failure' cere un id intreg", { id });
    }
    if (!isRecord(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") {
      throw new HostError("raptor:host/protocol", "cadrul 'failure' cere { code, message }", {});
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
      throw new HostError("raptor:host/protocol", "cadrul 'event' cere un nume", { name });
    }
    return { kind: "event", name, payload: plain(raw["payload"], "payload") };
  }

  throw new HostError("raptor:host/protocol", `tip de cadru necunoscut: ${String(kind)}`, { kind });
}
