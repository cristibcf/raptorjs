/**
 * Wiring the app to the browser.
 *
 * On desktop and mobile, the channel's `host` end lives in the native binary.
 * Here it lives in the same page - and that is the part that must be said openly:
 * in the browser, the bridge is no longer a security boundary, but a portability
 * layer. The boundary stays the browser's origin sandbox.
 *
 * What the app gains from it is still real: the same code runs on all three
 * targets, and finds out ahead of time - through `bridge.allows(...)` - what it
 * cannot do on the current one, instead of discovering at runtime that
 * `navigator.geolocation` is missing.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createWebHost, platformFromWindow } from "@raptor/host/web";
import type { WebHost, WebPlatform } from "@raptor/host/web";
import { createShell } from "./app.ts";
import type { Shell } from "./app.ts";

export interface SessionOptions {
  /** The optional modules granted; navigation + notifications by default. */
  readonly capabilities?: readonly string[];
  /** The available browser pieces; in the page they come from `window`. */
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
      // On web there are no system-registered schemes: the page URL is the link.
      deepLinkSchemes: [],
      // The window describes the popup, not an operating-system window.
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
      bridge.dispose("session ended");
      host.close();
    },
  };
}

/** The real session in the page: the platform comes from `window`. */
export function createBrowserSession(win: unknown, capabilities?: readonly string[]): Session {
  return createSession({
    platform: platformFromWindow(win),
    ...(capabilities ? { capabilities } : {}),
  });
}
