/**
 * Legarea aplicatiei de host, intr-un singur loc.
 *
 * In productie, capatul `host` al canalului este binarul nativ si capatul `app`
 * este WebView-ul. Aici amandoua sunt in proces, ca demo-ul si testele sa poata
 * rula fara nicio platforma instalata - dar contractul dintre ele este acelasi.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDesktopHost } from "@raptor/desktop";
import type { DesktopHost } from "@raptor/desktop";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** Modulele optionale acordate acestei instalari. */
  readonly capabilities?: readonly string[];
  readonly storage?: Map<string, string>;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: DesktopHost;
  readonly bridge: HostBridge;
  readonly shell: Shell;
  close(): void;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "desktop",
      bundleId: "com.raptor.desktop-shell",
      displayName: "Raptor Desktop Shell",
      version: "0.1.0",
      entry: "./index.html",
      capabilities,
      allowedOrigins: ["https://api.raptor.example"],
      deepLinkSchemes: ["raptor-shell"],
      window: { title: "Raptor Desktop Shell", width: 1024, height: 720, resizable: true },
      update: { feed: "https://updates.raptor.example/stable.json", channel: "stable" },
    }),
  );
}

export function createSession(options: SessionOptions = {}): Session {
  const manifest = manifestFor(options.capabilities ?? ["device.notifications"]);
  const channel = createMemoryChannel();

  const host = createDesktopHost({
    manifest,
    transport: channel.host,
    ...(options.storage ? { storage: options.storage } : {}),
  });
  const bridge = createBridge({
    target: "desktop",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 5000,
  });

  return {
    manifest,
    host,
    bridge,
    shell: createShell(bridge),
    close(): void {
      bridge.dispose("sesiune incheiata");
      host.close();
    },
  };
}
