/**
 * @raptor/device-host - a board's firmware as a Raptor host.
 *
 * The sixth target and the furthest from the roadmap: `embedded` appears
 * nowhere in it, and its column in the capability matrix is entirely derived.
 * Its point is not to cover a row of the spec, but to test the model where it
 * breaks: a host that does not trust the app, peripherals handed out piece by
 * piece, sleep that truly stops the clock, and an update that can turn the
 * product into a brick if it has no rollback.
 */
export { createDeviceHost } from "./host.ts";
export type { DeviceHost, DeviceHostOptions } from "./host.ts";

export type { Board, BusDefinition, DeviceIdentity, PinDefinition, PinDirection } from "./board.ts";
