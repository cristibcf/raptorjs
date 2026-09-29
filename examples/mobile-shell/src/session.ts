/**
 * Legarea aplicatiei de host-ul mobil.
 *
 * In productie, capatul `host` este bridge-ul nativ Android/iOS si capatul `app`
 * este WebView-ul. Aici amandoua sunt in proces, ca demo-ul si testele sa ruleze
 * fara SDK de platforma - contractul dintre ele fiind acelasi.
 *
 * Modulele native optionale se monteaza tot aici, si doar daca manifestul le
 * declara: `capturePhoto` sau `readLocation` lipsa inseamna o instalare pe care
 * acele functii pur si simplu nu exista.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createMobileHost } from "@raptor/host/mobile";
import type { MobileHost } from "@raptor/host/mobile";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** Modulele optionale acordate acestei instalari. */
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
      // Fara `window`: pe mobil navigarea apartine adaptorului (sectiunea 6).
      // Fara `update.feed`: distributia vine din magazin.
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
    // Montat doar daca instalarea are voie sa il foloseasca.
    ...(manifest.capabilities.includes("device.camera")
      ? {
          capturePhoto: async () => ({
            mimeType: "image/jpeg",
            byteLength: 2048,
            handle: `foto-${++photoCounter}`,
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
      bridge.dispose("sesiune incheiata");
      host.close();
    },
  };
}
