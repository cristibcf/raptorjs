/**
 * @raptor/service-host - supervizorul de proces ca host Raptor.
 *
 * Acopera randul "Servicii platforma" din etapa 3 a roadmap-ului: HTTP, loguri
 * si oprire curata, prin aceeasi punte de capabilitati ca desktopul, mobilul si
 * browserul. Ce da host-ul aici sunt socketi de ascultare, configuratie si
 * semnalul de drenare - nu ferestre.
 *
 * Numele pachetului evita confuzia cu `@raptor/server`, care este SDK-ul de
 * store reactiv RaptorWire si rezolva cu totul alta problema.
 */
export { createServiceHost } from "./host.ts";
export type { Health, ServiceHost, ServiceHostOptions } from "./host.ts";

export { nodeListeners } from "./listener.ts";
export type { Listener, ListenerFactory, ServeHandler } from "./listener.ts";
