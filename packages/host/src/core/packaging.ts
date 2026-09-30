/**
 * Packaging descriptors, shared by desktop and mobile (roadmap sections 3 and
 * 7: "reproducible build", "CI for installers").
 *
 * This package does not build installers - it cannot, it knows nothing about
 * the platform. It produces the *plan*: which artifacts are born, what they are
 * named, on which CI matrix they build and what must be signed. The plan is
 * deterministic and verifiable, so two runs on the same input give exactly the
 * same result, and CI can be generated from it instead of hand-written.
 */
import { HostError } from "./errors.ts";
import type { HostTarget } from "./capabilities.ts";

export type SigningRequirement = "required" | "optional" | "store";

export interface InstallerFormat {
  readonly id: string;
  readonly platform: string;
  /** The architectures the format builds on, sorted. */
  readonly architectures: readonly string[];
  readonly extension: string;
  readonly signing: SigningRequirement;
  /** The CI runner label suited to this format. */
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
  /** The distinct runner labels; exactly the matrix CI needs. */
  readonly runners: readonly string[];
  /** The artifacts that cannot be published unsigned. */
  readonly mustSign: readonly string[];
}

export interface PlanOptions {
  readonly target: HostTarget;
  readonly bundleId: string;
  readonly version: string;
  readonly formats: readonly InstallerFormat[];
  /** Restrict the plan to these platforms; all by default. */
  readonly platforms?: readonly string[];
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * The artifact name is part of the contract, not a passing choice: CI, the
 * update feed and signature verification all hang off it.
 */
export function artifactName(bundleId: string, version: string, platform: string, architecture: string, extension: string): string {
  return `${bundleId}-${version}-${platform}-${architecture}.${extension}`;
}

export function planPackages(options: PlanOptions): PackagePlan {
  if (!VERSION.test(options.version)) {
    throw new HostError("raptor:host/manifest-invalid", `invalid version for packaging: ${options.version}`, {
      version: options.version,
    });
  }

  const allowed = options.platforms ? new Set(options.platforms) : null;
  const unknown = options.platforms?.filter(
    (platform) => !options.formats.some((format) => format.platform === platform),
  );
  if (unknown && unknown.length > 0) {
    throw new HostError("raptor:host/manifest-invalid", `platforms not supported by target ${options.target}: ${unknown.join(", ")}`, {
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
