/**
 * `raptor.host.json` - the native boundary manifest.
 *
 * It does not duplicate `raptor.runtime.json`: that one describes the app for
 * the runtime (entry, policy, process capabilities), while this one describes
 * what the app asks of the operating system - the window, deep link schemes,
 * notifications, the update channel, the signing identity. The two are read
 * together but evolve separately: a web project does not need the second.
 *
 * Like the runtime's manifest parser, this one gathers all the problems before
 * answering, so `doctor` can show them all at once.
 */
import { HOST_TARGETS, decideCapability, hostCapability } from "./capabilities.ts";
import type { HostTarget } from "./capabilities.ts";
import { HostError } from "./errors.ts";

export const HOST_MANIFEST_FILENAME = "raptor.host.json";

export interface WindowDefaults {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly resizable: boolean;
}

export interface UpdateChannel {
  /** The update feed URL, or `null` for distribution through a store. */
  readonly feed: string | null;
  readonly channel: "stable" | "beta";
}

export interface SigningIdentity {
  /** Reverse-DNS app identifier: `com.example.app`. */
  readonly bundleId: string;
  /** The team/organization name from the certificate, or `null` until signing. */
  readonly team: string | null;
}

export interface HostManifest {
  readonly target: HostTarget;
  readonly bundleId: string;
  readonly displayName: string;
  readonly version: string;
  /** The page the WebView loads at startup, relative to the packaged unit. */
  readonly entry: string;
  /** The optional modules requested explicitly (the section 6 matrix). */
  readonly capabilities: readonly string[];
  /** The allowed origins; the adapter carries them, the runtime enforces them. */
  readonly allowedOrigins: readonly string[];
  readonly deepLinkSchemes: readonly string[];
  readonly window: WindowDefaults | null;
  readonly update: UpdateChannel;
  readonly signing: SigningIdentity;
}

export interface HostManifestIssue {
  readonly path: string;
  readonly message: string;
}

export interface HostManifestParseResult {
  readonly manifest: HostManifest | null;
  readonly issues: readonly HostManifestIssue[];
}

const BUNDLE_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(raw: unknown, path: string, issues: HostManifestIssue[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    issues.push({ path, message: "must be a list of strings" });
    return [];
  }
  return [...(raw as string[])];
}

function readWindow(raw: unknown, target: HostTarget, issues: HostManifestIssue[]): WindowDefaults | null {
  // `null` is the serialized form of "no window", so it must be accepted as
  // absence: otherwise a manifest produced by our parser would no longer pass
  // through it on a second read.
  //
  // On `web`, the field stays valid but changes meaning: it describes the popup
  // the page can open, not an operating-system window.
  if (raw === undefined || raw === null) return null;
  if (target === "mobile") {
    // Section 6: on mobile, navigation is controlled by the adapter, not the app.
    issues.push({ path: "window", message: "the 'mobile' target does not configure windows; the adapter controls them" });
    return null;
  }
  if (!isRecord(raw)) {
    issues.push({ path: "window", message: "must be an object" });
    return null;
  }

  const title = typeof raw["title"] === "string" ? raw["title"] : "";
  if (!title) issues.push({ path: "window.title", message: "required field (string)" });

  const dimension = (key: "width" | "height", fallback: number): number => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      issues.push({ path: `window.${key}`, message: "must be a positive integer" });
      return fallback;
    }
    return value;
  };

  const resizable = raw["resizable"];
  if (resizable !== undefined && typeof resizable !== "boolean") {
    issues.push({ path: "window.resizable", message: "must be a boolean" });
  }

  return {
    title,
    width: dimension("width", 1024),
    height: dimension("height", 768),
    resizable: typeof resizable === "boolean" ? resizable : true,
  };
}

function readUpdate(raw: unknown, issues: HostManifestIssue[]): UpdateChannel {
  if (raw === undefined) return { feed: null, channel: "stable" };
  if (!isRecord(raw)) {
    issues.push({ path: "update", message: "must be an object" });
    return { feed: null, channel: "stable" };
  }

  let feed: string | null = null;
  const rawFeed = raw["feed"];
  if (rawFeed !== undefined && rawFeed !== null) {
    if (typeof rawFeed !== "string") {
      issues.push({ path: "update.feed", message: "must be an https URL or null" });
    } else if (!rawFeed.startsWith("https://")) {
      // An update channel over http would allow replacing the binary in transit.
      issues.push({ path: "update.feed", message: "the update channel must be https" });
    } else {
      feed = rawFeed;
    }
  }

  const rawChannel = raw["channel"];
  if (rawChannel !== undefined && rawChannel !== "stable" && rawChannel !== "beta") {
    issues.push({ path: "update.channel", message: "must be 'stable' or 'beta'" });
  }

  return { feed, channel: rawChannel === "beta" ? "beta" : "stable" };
}

export function parseHostManifest(source: string): HostManifestParseResult {
  const issues: HostManifestIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { manifest: null, issues: [{ path: "", message: `invalid JSON: ${(error as Error).message}` }] };
  }
  if (!isRecord(raw)) {
    return { manifest: null, issues: [{ path: "", message: "the manifest must be a JSON object" }] };
  }

  const rawTarget = raw["target"];
  const target: HostTarget | null = (HOST_TARGETS as readonly string[]).includes(rawTarget as string)
    ? (rawTarget as HostTarget)
    : null;
  if (!target) {
    issues.push({ path: "target", message: `must be ${HOST_TARGETS.map((t) => `'${t}'`).join(", ")}` });
  }

  const bundleId = typeof raw["bundleId"] === "string" ? raw["bundleId"] : "";
  if (!bundleId) issues.push({ path: "bundleId", message: "required field (string)" });
  else if (!BUNDLE_ID.test(bundleId)) {
    issues.push({ path: "bundleId", message: "the expected form is reverse-DNS, e.g. com.example.app" });
  }

  const displayName = typeof raw["displayName"] === "string" ? raw["displayName"] : "";
  if (!displayName) issues.push({ path: "displayName", message: "required field (string)" });

  const version = typeof raw["version"] === "string" ? raw["version"] : "0.1.0";
  if (raw["version"] !== undefined && typeof raw["version"] !== "string") {
    issues.push({ path: "version", message: "must be a string" });
  }

  const entry = typeof raw["entry"] === "string" ? raw["entry"] : "./index.html";
  if (raw["entry"] !== undefined && typeof raw["entry"] !== "string") {
    issues.push({ path: "entry", message: "must be a relative path within the packaged unit" });
  }

  const capabilities = stringList(raw["capabilities"], "capabilities", issues);
  for (const id of capabilities) {
    if (!hostCapability(id)) {
      issues.push({ path: `capabilities.${id}`, message: "unknown host capability" });
      continue;
    }
    if (!target) continue;
    const verdict = decideCapability(target, id, capabilities);
    if (!verdict.granted && verdict.availability === "unavailable") {
      issues.push({ path: `capabilities.${id}`, message: verdict.reason });
    }
  }

  const allowedOrigins = stringList(raw["allowedOrigins"], "allowedOrigins", issues);
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        issues.push({ path: `allowedOrigins.${origin}`, message: "https only (or localhost in development)" });
      }
    } catch {
      issues.push({ path: `allowedOrigins.${origin}`, message: "must be an absolute origin" });
    }
  }

  const deepLinkSchemes = stringList(raw["deepLinkSchemes"], "deepLinkSchemes", issues);
  for (const scheme of deepLinkSchemes) {
    if (!SCHEME.test(scheme)) {
      issues.push({ path: `deepLinkSchemes.${scheme}`, message: "the scheme must be of the form 'app'" });
    }
  }

  const window = target ? readWindow(raw["window"], target, issues) : null;
  const update = readUpdate(raw["update"], issues);

  let team: string | null = null;
  const signing = raw["signing"];
  if (signing !== undefined) {
    if (!isRecord(signing)) issues.push({ path: "signing", message: "must be an object" });
    else if (signing["team"] !== undefined && signing["team"] !== null) {
      if (typeof signing["team"] === "string") team = signing["team"];
      else issues.push({ path: "signing.team", message: "must be a string or null" });
    }
  }

  if (issues.length > 0 || !target || !bundleId || !displayName) return { manifest: null, issues };

  return {
    manifest: {
      target,
      bundleId,
      displayName,
      version,
      entry,
      capabilities: [...capabilities].sort(),
      allowedOrigins: [...allowedOrigins].sort(),
      deepLinkSchemes: [...deepLinkSchemes].sort(),
      window,
      update,
      signing: { bundleId, team },
    },
    issues: [],
  };
}

export function requireHostManifest(source: string): HostManifest {
  const result = parseHostManifest(source);
  if (!result.manifest) {
    throw new HostError("raptor:host/manifest-invalid", `${HOST_MANIFEST_FILENAME} is invalid`, {
      issues: result.issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)),
    });
  }
  return result.manifest;
}
