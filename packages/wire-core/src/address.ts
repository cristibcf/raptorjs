/**
 * Reactive Address Space (RAS) - whitepaper v0.2 sectiunea 5.2.
 *
 * Atribuie identitati compacte, stabile pe durata sesiunii, nodurilor reactive
 * care traverseaza reteaua. Numele de domeniu ("BTC.price", "cpu", "job:1")
 * raman pentru authoring/bootstrap, dar hot path-ul foloseste adresa numerica.
 * Astfel dispar numele de field repetate de pe fir (buget de performanta v0.2:
 * "Repeated field names pe RaptorWire = 0 dupa address negotiation").
 */

export class AddressBook {
  private readonly toAddr = new Map<string, number>();
  private readonly toHandle = new Map<number, string>();
  private next: number;

  constructor(start = 0x1000) {
    this.next = start;
  }

  /** Server: obtine adresa pentru un handle, alocand una noua la nevoie. */
  assign(handle: string): { address: number; isNew: boolean } {
    const existing = this.toAddr.get(handle);
    if (existing !== undefined) return { address: existing, isNew: false };
    const address = this.next++;
    this.toAddr.set(handle, address);
    this.toHandle.set(address, handle);
    return { address, isNew: true };
  }

  /** Client: inregistreaza o pereche adresa->handle primita in dictionar. */
  define(address: number, handle: string): void {
    this.toAddr.set(handle, address);
    this.toHandle.set(address, handle);
  }

  handleOf(address: number): string | undefined {
    return this.toHandle.get(address);
  }

  addressOf(handle: string): number | undefined {
    return this.toAddr.get(handle);
  }

  get size(): number {
    return this.toAddr.size;
  }
}
