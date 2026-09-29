/**
 * `raptor.host.json` - manifestul granitei native.
 *
 * Nu dubleaza `raptor.runtime.json`: acela descrie aplicatia pentru runtime
 * (intrare, politica, capabilitati de proces), pe cand acesta descrie ce ii cere
 * aplicatia sistemului de operare - fereastra, scheme de deep link, notificari,
 * canal de actualizari, identitate de semnare. Cele doua se citesc impreuna, dar
 * evolueaza separat: un proiect web nu are nevoie de al doilea.
 *
 * Ca si parserul de manifest al runtime-ului, acesta aduna toate problemele
 * inainte sa raspunda, ca `doctor` sa le poata arata pe toate deodata.
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
  /** URL-ul feed-ului de actualizari, sau `null` pentru distributie prin magazin. */
  readonly feed: string | null;
  readonly channel: "stable" | "beta";
}

export interface SigningIdentity {
  /** Identificator de aplicatie invers-DNS: `com.exemplu.aplicatie`. */
  readonly bundleId: string;
  /** Numele echipei/organizatiei din certificat, sau `null` pana la semnare. */
  readonly team: string | null;
}

export interface HostManifest {
  readonly target: HostTarget;
  readonly bundleId: string;
  readonly displayName: string;
  readonly version: string;
  /** Pagina incarcata de WebView la pornire, relativa la unitatea ambalata. */
  readonly entry: string;
  /** Modulele optionale cerute explicit (matricea din sectiunea 6). */
  readonly capabilities: readonly string[];
  /** Domeniile permise; adaptorul le transporta, runtime-ul le aplica. */
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
    issues.push({ path, message: "trebuie sa fie o lista de siruri" });
    return [];
  }
  return [...(raw as string[])];
}

function readWindow(raw: unknown, target: HostTarget, issues: HostManifestIssue[]): WindowDefaults | null {
  // `null` este forma serializata a lui "fara fereastra", deci trebuie sa fie
  // acceptata ca absenta: altfel un manifest produs de parserul nostru nu ar mai
  // trece prin el la a doua citire.
  //
  // Pe `web`, campul ramane valid dar isi schimba intelesul: descrie popup-ul pe
  // care pagina il poate deschide, nu o fereastra a sistemului de operare.
  if (raw === undefined || raw === null) return null;
  if (target === "mobile") {
    // Sectiunea 6: pe mobil navigarea este controlata de adaptor, nu de aplicatie.
    issues.push({ path: "window", message: "tinta 'mobile' nu configureaza ferestre; adaptorul le controleaza" });
    return null;
  }
  if (!isRecord(raw)) {
    issues.push({ path: "window", message: "trebuie sa fie un obiect" });
    return null;
  }

  const title = typeof raw["title"] === "string" ? raw["title"] : "";
  if (!title) issues.push({ path: "window.title", message: "camp obligatoriu (sir)" });

  const dimension = (key: "width" | "height", fallback: number): number => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      issues.push({ path: `window.${key}`, message: "trebuie sa fie un intreg pozitiv" });
      return fallback;
    }
    return value;
  };

  const resizable = raw["resizable"];
  if (resizable !== undefined && typeof resizable !== "boolean") {
    issues.push({ path: "window.resizable", message: "trebuie sa fie boolean" });
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
    issues.push({ path: "update", message: "trebuie sa fie un obiect" });
    return { feed: null, channel: "stable" };
  }

  let feed: string | null = null;
  const rawFeed = raw["feed"];
  if (rawFeed !== undefined && rawFeed !== null) {
    if (typeof rawFeed !== "string") {
      issues.push({ path: "update.feed", message: "trebuie sa fie un URL https sau null" });
    } else if (!rawFeed.startsWith("https://")) {
      // Un canal de actualizari pe http ar permite inlocuirea binarului in tranzit.
      issues.push({ path: "update.feed", message: "canalul de actualizari trebuie sa fie https" });
    } else {
      feed = rawFeed;
    }
  }

  const rawChannel = raw["channel"];
  if (rawChannel !== undefined && rawChannel !== "stable" && rawChannel !== "beta") {
    issues.push({ path: "update.channel", message: "trebuie sa fie 'stable' sau 'beta'" });
  }

  return { feed, channel: rawChannel === "beta" ? "beta" : "stable" };
}

export function parseHostManifest(source: string): HostManifestParseResult {
  const issues: HostManifestIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { manifest: null, issues: [{ path: "", message: `JSON invalid: ${(error as Error).message}` }] };
  }
  if (!isRecord(raw)) {
    return { manifest: null, issues: [{ path: "", message: "manifestul trebuie sa fie un obiect JSON" }] };
  }

  const rawTarget = raw["target"];
  const target: HostTarget | null = (HOST_TARGETS as readonly string[]).includes(rawTarget as string)
    ? (rawTarget as HostTarget)
    : null;
  if (!target) {
    issues.push({ path: "target", message: `trebuie sa fie ${HOST_TARGETS.map((t) => `'${t}'`).join(", ")}` });
  }

  const bundleId = typeof raw["bundleId"] === "string" ? raw["bundleId"] : "";
  if (!bundleId) issues.push({ path: "bundleId", message: "camp obligatoriu (sir)" });
  else if (!BUNDLE_ID.test(bundleId)) {
    issues.push({ path: "bundleId", message: "forma asteptata este invers-DNS, de ex. com.exemplu.aplicatie" });
  }

  const displayName = typeof raw["displayName"] === "string" ? raw["displayName"] : "";
  if (!displayName) issues.push({ path: "displayName", message: "camp obligatoriu (sir)" });

  const version = typeof raw["version"] === "string" ? raw["version"] : "0.1.0";
  if (raw["version"] !== undefined && typeof raw["version"] !== "string") {
    issues.push({ path: "version", message: "trebuie sa fie un sir" });
  }

  const entry = typeof raw["entry"] === "string" ? raw["entry"] : "./index.html";
  if (raw["entry"] !== undefined && typeof raw["entry"] !== "string") {
    issues.push({ path: "entry", message: "trebuie sa fie o cale relativa in unitatea ambalata" });
  }

  const capabilities = stringList(raw["capabilities"], "capabilities", issues);
  for (const id of capabilities) {
    if (!hostCapability(id)) {
      issues.push({ path: `capabilities.${id}`, message: "capabilitate de host necunoscuta" });
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
        issues.push({ path: `allowedOrigins.${origin}`, message: "doar https (sau localhost in dezvoltare)" });
      }
    } catch {
      issues.push({ path: `allowedOrigins.${origin}`, message: "trebuie sa fie o origine absoluta" });
    }
  }

  const deepLinkSchemes = stringList(raw["deepLinkSchemes"], "deepLinkSchemes", issues);
  for (const scheme of deepLinkSchemes) {
    if (!SCHEME.test(scheme)) {
      issues.push({ path: `deepLinkSchemes.${scheme}`, message: "schema trebuie sa fie de forma 'aplicatie'" });
    }
  }

  const window = target ? readWindow(raw["window"], target, issues) : null;
  const update = readUpdate(raw["update"], issues);

  let team: string | null = null;
  const signing = raw["signing"];
  if (signing !== undefined) {
    if (!isRecord(signing)) issues.push({ path: "signing", message: "trebuie sa fie un obiect" });
    else if (signing["team"] !== undefined && signing["team"] !== null) {
      if (typeof signing["team"] === "string") team = signing["team"];
      else issues.push({ path: "signing.team", message: "trebuie sa fie un sir sau null" });
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
    throw new HostError("raptor:host/manifest-invalid", `${HOST_MANIFEST_FILENAME} este invalid`, {
      issues: result.issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)),
    });
  }
  return result.manifest;
}
