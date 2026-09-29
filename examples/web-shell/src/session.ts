/**
 * Legarea aplicatiei de browser.
 *
 * Pe desktop si pe mobil, capatul `host` al canalului traieste in binarul nativ.
 * Aici traieste in aceeasi pagina - si asta este partea care trebuie spusa pe
 * fata: in browser, puntea nu mai este o granita de securitate, ci un strat de
 * portabilitate. Granita ramane sandbox-ul de origine al browserului.
 *
 * Ce castiga aplicatia din ea este tot real: acelasi cod ruleaza pe toate cele
 * trei tinte, si afla din timp - prin `bridge.allows(...)` - ce nu poate face pe
 * cea curenta, in loc sa descopere la runtime ca `navigator.geolocation` lipseste.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createWebHost, platformFromWindow } from "@raptor/host/web";
import type { WebHost, WebPlatform } from "@raptor/host/web";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** Modulele optionale acordate; implicit navigare + notificari. */
  readonly capabilities?: readonly string[];
  /** Bucatile de browser disponibile; in pagina vin din `window`. */
  readonly platform?: WebPlatform;
  readonly initialRoute?: string;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: WebHost;
  readonly bridge: HostBridge;
  readonly shell: Shell;
  close(): void;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "web",
      bundleId: "com.raptor.web-shell",
      displayName: "Raptor Web Shell",
      version: "0.1.0",
      entry: "./index.html",
      capabilities,
      allowedOrigins: ["https://api.raptor.example"],
      // Pe web nu exista scheme inregistrate in sistem: URL-ul paginii e linkul.
      deepLinkSchemes: [],
      // Fereastra descrie popup-ul, nu o fereastra a sistemului de operare.
      window: { title: "Raptor Web Shell", width: 720, height: 560, resizable: true },
      update: { feed: null, channel: "stable" },
    }),
  );
}

export function createSession(options: SessionOptions = {}): Session {
  const manifest = manifestFor(options.capabilities ?? ["window.manage", "device.notifications"]);
  const channel = createMemoryChannel();

  const host = createWebHost({
    manifest,
    transport: channel.host,
    platform: options.platform ?? {},
    ...(options.initialRoute ? { initialRoute: options.initialRoute } : {}),
  });

  const bridge = createBridge({
    target: "web",
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

/** Sesiunea reala din pagina: platforma vine din `window`. */
export function createBrowserSession(win: unknown, capabilities?: readonly string[]): Session {
  return createSession({
    platform: platformFromWindow(win),
    ...(capabilities ? { capabilities } : {}),
  });
}
