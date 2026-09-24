/**
 * @raptor/desktop - Raptor Desktop Adapter.
 *
 * Roadmap sectiunea 7 il pune imediat dupa runtime, ca "prima cale spre
 * aplicatii native pentru PC". Pachetul contine trei lucruri: descrierea
 * back-end-urilor de WebView, host-ul de referinta care fixeaza comportamentul
 * asteptat de la binarul nativ, si planul de impachetare din care se genereaza
 * CI-ul de instalatoare.
 */
export { DESKTOP_BACKENDS, DESKTOP_PLATFORMS, desktopBackend } from "./backends.ts";
export type { DesktopBackend } from "./backends.ts";

export { DESKTOP_FORMATS, planDesktopPackages, runtimeRequirements } from "./packaging.ts";
export type { DesktopPlanOptions, RuntimeRequirement } from "./packaging.ts";

export { createDesktopHost } from "./host.ts";
export type {
  DesktopHost,
  DesktopHostOptions,
  MenuItem,
  NotificationRecord,
  SpawnOutcome,
  WindowState,
} from "./host.ts";
