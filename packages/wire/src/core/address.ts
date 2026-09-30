/**
 * Reactive Address Space (RAS) - whitepaper v0.2 section 5.2.
 *
 * Assigns compact identities, stable for the duration of the session, to the
 * reactive nodes that traverse the network. Scope names ("BTC.price", "cpu",
 * "job:1") remain for authoring/bootstrap, but the hot path uses the numeric
 * address. This way repeated field names disappear from the wire (v0.2
 * performance budget: "Repeated field names on RaptorWire = 0 after address
 * negotiation").
 */

export class AddressBook {
  private readonly toAddr = new Map<string, number>();
  private readonly toHandle = new Map<number, string>();
  private next: number;

  constructor(start = 0x1000) {
    this.next = start;
  }

  /** Server: get the address for a handle, allocating a new one if needed. */
  assign(handle: string): { address: number; isNew: boolean } {
    const existing = this.toAddr.get(handle);
    if (existing !== undefined) return { address: existing, isNew: false };
    const address = this.next++;
    this.toAddr.set(handle, address);
    this.toHandle.set(address, handle);
    return { address, isNew: true };
  }

  /** Client: register an address->handle pair received in the dictionary. */
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
