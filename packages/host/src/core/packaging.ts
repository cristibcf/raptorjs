/**
 * Descriptori de impachetare, comuni desktop-ului si mobilului (roadmap
 * sectiunile 3 si 7: "build reproductibil", "CI pentru instalatoare").
 *
 * Pachetul acesta nu construieste instalatoare - nu are cum, nu stie nimic
 * despre platforma. Produce *planul*: ce artefacte se nasc, cum se numesc, pe ce
 * matrice de CI se construiesc si ce trebuie semnat. Planul este determinist si
 * verificabil, deci doua rulari pe aceeasi intrare dau exact acelasi rezultat,
 * iar CI-ul poate fi generat din el in loc sa fie scris de mana.
 */
import { HostError } from "./errors.ts";
import type { HostTarget } from "./capabilities.ts";

export type SigningRequirement = "required" | "optional" | "store";

export interface InstallerFormat {
  readonly id: string;
  readonly platform: string;
  /** Arhitecturile pe care formatul se construieste, sortate. */
  readonly architectures: readonly string[];
  readonly extension: string;
  readonly signing: SigningRequirement;
  /** Eticheta de runner CI potrivita pentru acest format. */
  readonly runner: string;
  readonly notes: string;
}

export interface Artifact {
  readonly format: string;
  readonly platform: string;
  readonly architecture: string;
  readonly filename: string;
  readonly signing: SigningRequirement;
  readonly runner: string;
}

export interface PackagePlan {
  readonly target: HostTarget;
  readonly bundleId: string;
  readonly version: string;
  readonly artifacts: readonly Artifact[];
  /** Etichetele de runner distincte; exact matricea de care are nevoie CI-ul. */
  readonly runners: readonly string[];
  /** Artefactele care nu pot fi publicate nesemnate. */
  readonly mustSign: readonly string[];
}

export interface PlanOptions {
  readonly target: HostTarget;
  readonly bundleId: string;
  readonly version: string;
  readonly formats: readonly InstallerFormat[];
  /** Restrange planul la aceste platforme; implicit toate. */
  readonly platforms?: readonly string[];
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Numele artefactului este parte din contract, nu o alegere de moment: CI-ul,
 * feed-ul de actualizari si verificarea semnaturii se leaga toate de el.
 */
export function artifactName(bundleId: string, version: string, platform: string, architecture: string, extension: string): string {
  return `${bundleId}-${version}-${platform}-${architecture}.${extension}`;
}

export function planPackages(options: PlanOptions): PackagePlan {
  if (!VERSION.test(options.version)) {
    throw new HostError("raptor:host/manifest-invalid", `versiune invalida pentru impachetare: ${options.version}`, {
      version: options.version,
    });
  }

  const allowed = options.platforms ? new Set(options.platforms) : null;
  const unknown = options.platforms?.filter(
    (platform) => !options.formats.some((format) => format.platform === platform),
  );
  if (unknown && unknown.length > 0) {
    throw new HostError("raptor:host/manifest-invalid", `platforme nesuportate de tinta ${options.target}: ${unknown.join(", ")}`, {
      platforms: unknown,
      supported: [...new Set(options.formats.map((format) => format.platform))].sort(),
    });
  }

  const artifacts: Artifact[] = [];
  for (const format of options.formats) {
    if (allowed && !allowed.has(format.platform)) continue;
    for (const architecture of format.architectures) {
      artifacts.push({
        format: format.id,
        platform: format.platform,
        architecture,
        filename: artifactName(options.bundleId, options.version, format.platform, architecture, format.extension),
        signing: format.signing,
        runner: format.runner,
      });
    }
  }

  artifacts.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));

  return {
    target: options.target,
    bundleId: options.bundleId,
    version: options.version,
    artifacts,
    runners: [...new Set(artifacts.map((artifact) => artifact.runner))].sort(),
    mustSign: artifacts.filter((artifact) => artifact.signing === "required").map((artifact) => artifact.filename),
  };
}
