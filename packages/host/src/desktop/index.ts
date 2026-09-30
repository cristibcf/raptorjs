/**
 * @raptorstack/desktop - Raptor Desktop Adapter.
 *
 * Roadmap section 7 places it right after the runtime, as "the first path to
 * native PC apps". The package contains three things: the description of the
 * WebView back-ends, the reference host that pins down the behavior expected of
 * the native binary, and the packaging plan the installer CI is generated from.
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
