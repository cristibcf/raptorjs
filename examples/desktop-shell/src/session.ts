/**
 * Wiring the app to the host, in a single place.
 *
 * In production, the channel's `host` end is the native binary and the `app` end
 * is the WebView. Here both are in-process, so the demo and the tests can run
 * without any platform installed - but the contract between them is the same.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDesktopHost } from "@raptor/host/desktop";
import type { DesktopHost } from "@raptor/host/desktop";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** The optional modules granted to this installation. */
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
      bridge.dispose("session ended");
      host.close();
    },
  };
}
