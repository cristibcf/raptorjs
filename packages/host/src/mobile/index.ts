/**
 * @raptor/mobile - Raptor Mobile Adapter.
 *
 * Roadmap section 8 places it after desktop, and not by chance: the capability
 * model is proven first where feedback is fast, and only then extended to
 * phones, where the boundaries are tighter - no windows, no subprocesses, with
 * navigation at the adapter and updates at the store.
 */
export { MOBILE_BACKENDS, MOBILE_PLATFORMS, mobileBackend } from "./backends.ts";
export type { MobileBackend } from "./backends.ts";

export { MOBILE_FORMATS, planMobilePackages } from "./packaging.ts";
export type { MobilePlanOptions } from "./packaging.ts";

export { createMobileHost } from "./host.ts";
export type {
  CapturedPhoto,
  Coordinates,
  MobileHost,
  MobileHostOptions,
  NotificationRecord,
  PickedFile,
} from "./host.ts";
