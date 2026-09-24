/**
 * @raptor/web-host - browserul ca host Raptor.
 *
 * Roadmap-ul §4 numeste browserul host-ul tintei `web`, iar §6 descrie doar
 * host-urile native. Pachetul acesta inchide cercul: aceeasi punte, aceleasi
 * capabilitati, aceeasi masina de lifecycle, implementate peste API-urile web -
 * ca o aplicatie scrisa pe contractul Raptor sa ruleze nemodificata pe toate
 * cele trei tinte.
 *
 * O precizare care nu trebuie pierduta: aici contractul da **portabilitate**,
 * nu izolare. Granita de securitate a unei pagini ramane sandbox-ul de origine
 * al browserului, nu verificarile din `serveHost`.
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
