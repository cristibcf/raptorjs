/**
 * Wiring the app to the mobile host.
 *
 * In production, the `host` end is the native Android/iOS bridge and the `app`
 * end is the WebView. Here both are in-process, so the demo and the tests run
 * without a platform SDK - the contract between them being the same.
 *
 * The optional native modules are mounted here too, and only if the manifest
 * declares them: a missing `capturePhoto` or `readLocation` means an installation
 * on which those features simply do not exist.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptorstack/host";
import type { HostBridge, HostManifest } from "@raptorstack/host";
import { createMobileHost } from "@raptorstack/host/mobile";
import type { MobileHost } from "@raptorstack/host/mobile";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** The optional modules granted to this installation. */
  readonly capabilities?: readonly string[];
  /** Keychain (iOS) / EncryptedSharedPreferences (Android). */
  readonly secureStore?: Map<string, string>;
  readonly initialRoute?: string;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: MobileHost;
  readonly bridge: HostBridge;
  readonly shell: Shell;
  close(): void;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "mobile",
      bundleId: "com.raptor.mobile-shell",
      displayName: "Raptor Mobile Shell",
      version: "0.1.0",
      entry: "./index.html",
      capabilities,
      allowedOrigins: ["https://api.raptor.example"],
      deepLinkSchemes: ["raptor-shell"],
      // No `window`: on mobile navigation belongs to the adapter (section 6).
      // No `update.feed`: distribution comes from the store.
      update: { feed: null, channel: "stable" },
    }),
  );
}

let photoCounter = 0;

export function createSession(options: SessionOptions = {}): Session {
  const manifest = manifestFor(options.capabilities ?? ["device.notifications", "device.camera"]);
  const channel = createMemoryChannel();

  const host = createMobileHost({
    manifest,
    transport: channel.host,
    ...(options.secureStore ? { secureStore: options.secureStore } : {}),
    ...(options.initialRoute ? { initialRoute: options.initialRoute } : {}),
    // Mounted only if the installation is allowed to use it.
    ...(manifest.capabilities.includes("device.camera")
      ? {
          capturePhoto: async () => ({
            mimeType: "image/jpeg",
            byteLength: 2048,
            handle: `photo-${++photoCounter}`,
          }),
        }
      : {}),
  });

  const bridge = createBridge({
    target: "mobile",
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
