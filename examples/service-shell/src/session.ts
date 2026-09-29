/**
 * Legarea serviciului de host.
 *
 * Portul si configuratia vin din afara aplicatiei - aici din `SessionOptions`,
 * in productie din supervizor (unitatea systemd, manifestul de deployment,
 * variabilele de mediu ale containerului). Aplicatia le cere pe nume si nu are
 * cum sa le aleaga singura.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createServiceHost, nodeListeners } from "@raptor/host/service";
import type { ListenerFactory, ServiceHost } from "@raptor/host/service";
import { createService } from "./app.ts";
import type { Service } from "./app.ts";

export interface SessionOptions {
  /** Porturile alocate de deployment, pe nume. `0` = port liber, pentru teste. */
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
      bridge.dispose("sesiune incheiata");
    },
  };
}
