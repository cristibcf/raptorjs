/**
 * Wiring the service to the host.
 *
 * The port and configuration come from outside the app - here from
 * `SessionOptions`, in production from the supervisor (the systemd unit, the
 * deployment manifest, the container's environment variables). The app requests
 * them by name and has no way to choose them itself.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createServiceHost, nodeListeners } from "@raptor/host/service";
import type { ListenerFactory, ServiceHost } from "@raptor/host/service";
import { createService } from "./app.ts";
import type { Service } from "./app.ts";

export interface SessionOptions {
  /** The ports allocated by the deployment, by name. `0` = free port, for tests. */
  readonly ports?: Readonly<Record<string, number>>;
  readonly config?: Readonly<Record<string, string>>;
  readonly storage?: Map<string, string>;
  readonly capabilities?: readonly string[];
  readonly listeners?: ListenerFactory;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: ServiceHost;
  readonly bridge: HostBridge;
  readonly service: Service;
  close(): Promise<void>;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "server",
      bundleId: "com.raptor.service-shell",
      displayName: "Raptor Service Shell",
      version: "0.1.0",
      entry: "./src/app.ts",
      capabilities,
      allowedOrigins: ["https://api.raptor.example"],
      deepLinkSchemes: [],
      update: { feed: null, channel: "stable" },
    }),
  );
}

export function createSession(options: SessionOptions = {}): Session {
  const manifest = manifestFor(options.capabilities ?? ["net.listen", "service.config"]);
  const channel = createMemoryChannel();

  const host = createServiceHost({
    manifest,
    transport: channel.host,
    listeners: options.listeners ?? nodeListeners(),
    ports: options.ports ?? { public: 0 },
    ...(options.config ? { config: options.config } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
  });

  const bridge = createBridge({
    target: "server",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 5000,
  });

  return {
    manifest,
    host,
    bridge,
    service: createService(bridge),
    async close(): Promise<void> {
      await host.close();
      bridge.dispose("session ended");
    },
  };
}
