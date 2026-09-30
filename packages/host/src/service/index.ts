/**
 * @raptor/service-host - the process supervisor as a Raptor host.
 *
 * It covers the "Platform services" row of roadmap stage 3: HTTP, logs and
 * clean shutdown, through the same capability bridge as desktop, mobile and the
 * browser. What the host gives here are listening sockets, configuration and
 * the drain signal - not windows.
 *
 * The package name avoids confusion with `@raptor/server`, which is the
 * RaptorWire reactive store SDK and solves an entirely different problem.
 */
export { createServiceHost } from "./host.ts";
export type { Health, ServiceHost, ServiceHostOptions } from "./host.ts";

export { nodeListeners } from "./listener.ts";
export type { Listener, ListenerFactory, ServeHandler } from "./listener.ts";
