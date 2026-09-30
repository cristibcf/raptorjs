/** Targets supported by RaptorForge. Host adapters stay replaceable. */
import type { CapabilityDeclarations } from "@raptorstack/runtime";
import type { HostTarget } from "@raptorstack/host";

export const APP_TARGETS = ["web", "desktop", "mobile"] as const;
export type AppTarget = (typeof APP_TARGETS)[number];

export interface TargetDefinition {
  id: AppTarget;
  displayName: string;
  host: "browser" | "webview";
  /** The native host adapter for this target, or null when the browser is the host. */
  hostTarget: HostTarget | null;
  /**
   * Capabilities requested from RaptorRuntime, in the shape `raptor.runtime.json`
   * actually accepts. A native host adds an application data directory; the web
   * target asks for nothing beyond its own sources.
   */
  runtimeCapabilities: CapabilityDeclarations;
  /** Optional host modules declared in `raptor.host.json` for this target. */
  hostCapabilities: readonly string[];
  outputDirectory: string;
}

const WEB_CAPABILITIES: CapabilityDeclarations = {
  "files.read": ["./src", "./index.html", "./raptor.runtime.json"],
};

const NATIVE_CAPABILITIES: CapabilityDeclarations = {
  "files.read": ["./src", "./index.html", "./raptor.runtime.json"],
  "files.write": ["./app-data"],
};

export const TARGETS: Readonly<Record<AppTarget, TargetDefinition>> = {
  web: {
    id: "web",
    displayName: "Web",
    host: "browser",
    hostTarget: null,
    runtimeCapabilities: WEB_CAPABILITIES,
    hostCapabilities: [],
    outputDirectory: "dist/web",
  },
  desktop: {
    id: "desktop",
    displayName: "Desktop",
    host: "webview",
    hostTarget: "desktop",
    runtimeCapabilities: NATIVE_CAPABILITIES,
    // Notifications are the one optional module a desktop shell almost always
    // wants; cameras, location and subprocesses stay off until asked for.
    hostCapabilities: ["device.notifications"],
    outputDirectory: "dist/desktop",
  },
  mobile: {
    id: "mobile",
    displayName: "Mobile",
    host: "webview",
    hostTarget: "mobile",
    runtimeCapabilities: NATIVE_CAPABILITIES,
    hostCapabilities: ["device.notifications"],
    outputDirectory: "dist/mobile",
  },
};

export function isAppTarget(value: string): value is AppTarget {
  return (APP_TARGETS as readonly string[]).includes(value);
}
