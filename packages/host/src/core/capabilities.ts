/**
 * The capability matrix of the native hosts (roadmap section 6).
 *
 * The roadmap table is the source of truth and is transcribed here as data, not
 * as `if` branches scattered through the adapters: desktop and mobile read the
 * same matrix, so a policy difference between them cannot arise by oversight.
 * The rows marked as coming from the section 6 prose are kept explicitly
 * separate from the table rows, so it is visible what is contract and what is
 * extension.
 */
import { HostError } from "./errors.ts";

export const HOST_TARGETS = ["desktop", "mobile", "web", "server", "cli", "embedded"] as const;
export type HostTarget = (typeof HOST_TARGETS)[number];

/**
 * The targets the roadmap calls "native host" (section 4).
 *
 * `web`, `server`, `cli` and `embedded` are not among them, and their columns
 * in the matrix are *derived*, not read from the section 6 table: on web the
 * host is the browser, on server the process supervisor, on cli the terminal,
 * and on embedded the board's firmware - the only host that does not trust the
 * app and resets it if it stops showing signs of life.
 *
 * The distinction matters when reading the matrix as a spec: only two of its
 * columns are contract, the rest are extensions of the same model.
 */
export const NATIVE_TARGETS: readonly HostTarget[] = ["desktop", "mobile"];

/**
 * `granted`     - available on the target, but still bounded by its policy;
 * `optional`    - exists only if the app declares it explicitly in the manifest;
 * `unavailable` - does not exist on the target; declaring it is a manifest error.
 */
export type Availability = "granted" | "optional" | "unavailable";

export interface HostCapabilityDefinition {
  readonly id: string;
  readonly summary: string;
  readonly desktop: Availability;
  readonly mobile: Availability;
  /** Derived from the web platform's constraints, not from the section 6 table. */
  readonly web: Availability;
  /** Derived from what a process supervisor offers; see `NATIVE_TARGETS`. */
  readonly server: Availability;
  /** Derived from what a terminal offers; see `NATIVE_TARGETS`. */
  readonly cli: Availability;
  /** Derived from what a board's firmware offers; see `NATIVE_TARGETS`. */
  readonly embedded: Availability;
  readonly policy: string;
  /** A target's policy, when it differs from the default one above. */
  readonly policies?: Partial<Record<HostTarget, string>>;
  /**
   * Who actually enforces the limit. `runtime` means the adapter only carries
   * the declaration, and the denial comes from the RaptorRuntime capability broker.
   */
  readonly enforcedBy: "host" | "runtime";
  /**
   * `table` = the row appears in the section 6 table; `prose` = from its text;
   * `derived` = does not appear in the roadmap, exists for a non-native target.
   */
  readonly source: "table" | "prose" | "derived";
}

/** The rows of the section 6 table, plus the optional modules from the prose. */
export const HOST_CAPABILITIES: readonly HostCapabilityDefinition[] = [
  {
    id: "app.storage",
    summary: "App storage",
    desktop: "granted",
    mobile: "granted",
    web: "granted",
    server: "granted",
    cli: "granted",
    embedded: "granted",
    policy: "limited to the app directory",
    policies: {
      web: "limited to the page origin (localStorage)",
      server: "limited to the service's data directory",
      cli: "limited to the tool's configuration directory",
      embedded: "an NVS partition; writes wear the flash, so they are counted",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "net.connect",
    summary: "Network",
    desktop: "granted",
    mobile: "granted",
    web: "granted",
    server: "granted",
    cli: "granted",
    embedded: "optional",
    policy: "domain allowlist and timeouts",
    policies: {
      web: "domain allowlist, on top of the browser's CORS",
      embedded: "many boards have no network at all; when present, it is declared explicitly",
    },
    enforcedBy: "runtime",
    source: "table",
  },
  {
    id: "window.manage",
    summary: "Windows and navigation",
    desktop: "granted",
    mobile: "unavailable",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "controlled by the adapter",
    policies: {
      web: "history API and popups; a popup requires a user gesture, menus do not exist",
      server: "a service has no graphical interface",
      cli: "a command-line tool has no windows",
      embedded: "a board has no windowing system",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.camera",
    summary: "Camera",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "explicit system and runtime permission",
    policies: {
      web: "getUserMedia; the browser asks for permission on first use",
      server: "does not exist on a server",
      cli: "does not exist in a terminal",
      embedded: "an image sensor is accessed as a peripheral, not as a system module",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.location",
    summary: "Location",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "explicit system and runtime permission",
    policies: {
      web: "geolocation; the browser asks for permission on first use",
      server: "does not exist on a server",
      cli: "does not exist in a terminal",
      embedded: "a GPS module is accessed as a peripheral, over the bus",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "process.spawn",
    summary: "Subprocesses",
    desktop: "optional",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "optional",
    embedded: "unavailable",
    policy: "desktop only, with an explicit list",
    policies: {
      web: "does not exist in the browser, in any form",
      server: "workers and tools, with an explicit list",
      cli: "external tools, with an explicit list",
      embedded: "there are no processes; the firmware is a single program",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.notifications",
    summary: "Notifications",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "optional module, with its own capability",
    policies: {
      web: "Notification API; the browser asks for permission",
      server: "a service's notifications go to logs, not to a user",
      cli: "a tool's output goes to the terminal, not to notifications",
      embedded: "a board signals through peripherals, not through notifications",
    },
    enforcedBy: "host",
    source: "prose",
  },
  {
    id: "device.files",
    summary: "System file picker",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "optional module; returns only the files the user chose",
    policies: {
      web: "a user-chosen file input; no disk access",
      server: "there is no user to choose files",
      cli: "files come from arguments, not from a picker",
      embedded: "there is no user and no ordinary file system",
    },
    enforcedBy: "host",
    source: "prose",
  },
  {
    id: "net.listen",
    summary: "Opening listening sockets",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "optional",
    embedded: "optional",
    policy: "explicitly declared ports; the socket is opened by the host, not the app",
    policies: {
      cli: "a tool can serve locally (dev server), with declared ports",
      embedded: "only if the board has a network; typically a configuration page",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "service.config",
    summary: "Configuration and secrets from the supervisor",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "declared keys; the values come from the supervisor, not from the app's files",
    policies: {
      cli: "a tool reads its configuration through the runtime capabilities",
      embedded: "the configuration lives in NVS, i.e. in the app storage",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "tty.interact",
    summary: "Reading from the user (prompt, confirmation)",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "optional",
    embedded: "unavailable",
    policy: "only with an interactive terminal; without one, any question is denied, not assumed",
    policies: {
      embedded: "there is no user at the other end",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "hw.gpio",
    summary: "Digital pins",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "explicitly declared pins, with direction; an undeclared pin can be neither read nor written",
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "hw.bus",
    summary: "Peripheral buses (I2C, SPI)",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "explicitly declared buses and addresses; the rest of the bus stays inaccessible",
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "power.sleep",
    summary: "Board sleep control",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "the app can request sleep, but cannot turn off the watchdog",
    enforcedBy: "host",
    source: "derived",
  },
];

const BY_ID = new Map(HOST_CAPABILITIES.map((capability) => [capability.id, capability]));

export function hostCapability(id: string): HostCapabilityDefinition | undefined {
  return BY_ID.get(id);
}

export function availabilityOn(capability: HostCapabilityDefinition, target: HostTarget): Availability {
  if (target === "desktop") return capability.desktop;
  if (target === "mobile") return capability.mobile;
  if (target === "web") return capability.web;
  if (target === "server") return capability.server;
  if (target === "cli") return capability.cli;
  return capability.embedded;
}

/** The policy in force on the given target; non-native targets sometimes have another. */
export function policyOn(capability: HostCapabilityDefinition, target: HostTarget): string {
  return capability.policies?.[target] ?? capability.policy;
}

/** The capabilities a target can offer, regardless of the app. */
export function capabilitiesFor(target: HostTarget): readonly HostCapabilityDefinition[] {
  return HOST_CAPABILITIES.filter((capability) => availabilityOn(capability, target) !== "unavailable");
}

export interface CapabilityVerdict {
  readonly id: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly availability: Availability | "unknown";
}

/**
 * The decision for a single capability, on a target, with a declared set.
 *
 * It is pure and synchronous: the same function runs both in JS (to deny early,
 * with a good message) and on the host side (where the real boundary is).
 * Duplicating the check is intentional - the JS side can always be bypassed.
 */
export function decideCapability(
  target: HostTarget,
  id: string,
  declared: readonly string[],
): CapabilityVerdict {
  const definition = BY_ID.get(id);
  if (!definition) {
    return { id, granted: false, reason: "unknown host capability", availability: "unknown" };
  }

  const availability = availabilityOn(definition, target);
  if (availability === "unavailable") {
    return {
      id,
      granted: false,
      reason: `does not exist on ${target}: ${policyOn(definition, target)}`,
      availability,
    };
  }
  if (availability === "granted") {
    return { id, granted: true, reason: policyOn(definition, target), availability };
  }
  if (declared.includes(id)) {
    return { id, granted: true, reason: `explicitly declared; ${policyOn(definition, target)}`, availability };
  }
  return { id, granted: false, reason: "optional module not declared in raptor.host.json", availability };
}

/** The throwing variant; used on paths where a denial stops the call. */
export function requireCapability(target: HostTarget, id: string, declared: readonly string[]): CapabilityVerdict {
  const verdict = decideCapability(target, id, declared);
  if (verdict.granted) return verdict;
  const code =
    verdict.availability === "optional" ? "raptor:host/capability-undeclared" : "raptor:host/capability-unavailable";
  throw new HostError(code, `capability '${id}' is not available: ${verdict.reason}`, {
    capability: id,
    target,
    declared: [...declared],
  });
}
