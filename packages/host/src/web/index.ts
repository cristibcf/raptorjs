/**
 * @raptorstack/host/web - the browser as a Raptor host.
 *
 * Roadmap §4 names the browser the host of the `web` target, and §6 describes
 * only the native hosts. This package closes the loop: the same bridge, the
 * same capabilities, the same lifecycle machine, implemented over the web APIs -
 * so an app written to the Raptor contract runs unmodified on all three targets.
 *
 * One point that must not be lost: here the contract gives **portability**, not
 * isolation. A page's security boundary remains the browser's origin sandbox,
 * not the checks in `serveHost`.
 */
export { createWebHost } from "./host.ts";
export type { WebHost, WebHostOptions } from "./host.ts";

export { platformFromWindow } from "./platform.ts";
export type {
  CameraLike,
  FilePickerLike,
  GeolocationLike,
  HistoryLike,
  LocationLike,
  NotificationLike,
  WebPlatform,
  WebStorageLike,
  WindowOpenerLike,
} from "./platform.ts";
