/**
 * @raptor/device-host - firmware-ul unei plachete ca host Raptor.
 *
 * A sasea tinta si cea mai indepartata de roadmap: `embedded` nu apare nicaieri
 * in el, iar coloana ei din matricea de capabilitati este in intregime derivata.
 * Rostul ei nu este sa acopere un rand din spec, ci sa incerce modelul acolo
 * unde se rupe: un host care nu are incredere in aplicatie, periferice care se
 * dau pe bucati, somn care chiar opreste ceasul, si o actualizare care poate
 * transforma produsul in caramida daca nu are rollback.
 */
export { createDeviceHost } from "./host.ts";
export type { DeviceHost, DeviceHostOptions } from "./host.ts";

export type { Board, BusDefinition, DeviceIdentity, PinDefinition, PinDirection } from "./board.ts";
