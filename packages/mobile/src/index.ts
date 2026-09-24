/**
 * @raptor/mobile - Raptor Mobile Adapter.
 *
 * Roadmap sectiunea 8 il aseaza dupa desktop, si nu din intamplare: modelul de
 * capabilitati se dovedeste intai acolo unde feedback-ul e rapid, si abia apoi
 * se extinde spre telefoane, unde granitele sunt mai stranse - fara ferestre,
 * fara subprocese, cu navigarea la adaptor si actualizarile la magazin.
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
