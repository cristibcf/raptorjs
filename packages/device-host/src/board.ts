/**
 * Placheta, ca interfata.
 *
 * Pinii si magistralele nu sunt "o resursa" oarecare: pe o placheta reala, un
 * pin scris gresit poate scurtcircuita ceva sau poate tine un releu inchis.
 * De aceea descrierea de aici este mai stricta decat la celelalte host-uri -
 * fiecare pin are o directie declarata, iar host-ul refuza o scriere pe un pin
 * declarat ca intrare inainte sa ajunga la hardware.
 *
 * Ca peste tot in familia asta de adaptoare, placheta se injecteaza: un test
 * ruleaza pe una simulata, firmware-ul real pe una adevarata, iar codul
 * aplicatiei nu vede diferenta.
 */

export type PinDirection = "in" | "out";

export interface PinDefinition {
  readonly pin: number;
  readonly direction: PinDirection;
  /** Numele din schema; apare in diagnostice, ca sa nu se vorbeasca in numere. */
  readonly label?: string;
}

export interface BusDefinition {
  readonly bus: string;
  /** Adresele de pe magistrala pe care aplicatia are voie sa le atinga. */
  readonly addresses: readonly number[];
}

export interface DeviceIdentity {
  readonly chip: string;
  readonly firmware: string;
  /** De ce a pornit ultima oara: pornire, reset software, sau watchdog. */
  readonly resetReason: "power-on" | "software" | "watchdog" | "wake";
}

export interface Board {
  readonly identity: DeviceIdentity;
  readNextPin(pin: number): boolean;
  writePin(pin: number, value: boolean): void;
  /** Un schimb pe magistrala; intoarce octetii cititi. */
  transfer(bus: string, address: number, write: Uint8Array, readLength: number): Uint8Array;
  /** Octeti liberi in heap; pe o placheta este o cifra care conteaza. */
  freeHeap(): number;
  /** Reset hardware. Host-ul il cheama cand watchdog-ul expira. */
  reset(reason: string): void;
  /** Somn; intoarce motivul trezirii. */
  sleep(durationMs: number): Promise<"timer" | "external">;
}
