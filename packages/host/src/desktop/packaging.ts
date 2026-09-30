/**
 * Desktop packaging: installer formats, plan and CI matrix.
 *
 * Signing is not optional on Windows and macOS - there an unsigned binary is
 * blocked or warned about by the system, so we mark it `required` and the plan
 * says explicitly what cannot be published unsigned (roadmap section 7: "CI for
 * installers - signing, smoke tests and safe distribution").
 */
import { planPackages } from "@raptorstack/host";
import type { HostManifest, InstallerFormat, PackagePlan } from "@raptorstack/host";
import { DESKTOP_BACKENDS } from "./backends.ts";

export const DESKTOP_FORMATS: readonly InstallerFormat[] = [
  {
    id: "msi",
    platform: "windows",
    architectures: ["x64", "arm64"],
    extension: "msi",
    signing: "required",
    runner: "windows-latest",
    notes: "per-machine install, suited to distribution in organizations",
  },
  {
    id: "nsis",
    platform: "windows",
    architectures: ["x64", "arm64"],
    extension: "exe",
    signing: "required",
    runner: "windows-latest",
    notes: "per-user install, with background updates",
  },
  {
    id: "dmg",
    platform: "macos",
    architectures: ["arm64", "x64"],
    extension: "dmg",
    signing: "required",
    runner: "macos-latest",
    notes: "requires Apple notarization before distribution",
  },
  {
    id: "deb",
    platform: "linux",
    architectures: ["x64", "arm64"],
    extension: "deb",
    signing: "optional",
    runner: "ubuntu-latest",
    notes: "declares the WebKitGTK dependency",
  },
  {
    id: "appimage",
    platform: "linux",
    architectures: ["x64", "arm64"],
    extension: "AppImage",
    signing: "optional",
    runner: "ubuntu-latest",
    notes: "carries its dependencies with it; requires no installation",
  },
];

export interface DesktopPlanOptions {
  /** Restrict the plan to these platforms; all three by default. */
  readonly platforms?: readonly string[];
}

export function planDesktopPackages(manifest: HostManifest, options: DesktopPlanOptions = {}): PackagePlan {
  const planOptions = {
    target: "desktop" as const,
    bundleId: manifest.bundleId,
    version: manifest.version,
    formats: DESKTOP_FORMATS,
  };
  return planPackages(options.platforms ? { ...planOptions, platforms: options.platforms } : planOptions);
}

export interface RuntimeRequirement {
  readonly platform: string;
  readonly dependency: string;
  readonly minimumOs: string;
}

/** What must exist on the user's machine, beyond the app itself. */
export function runtimeRequirements(plan: PackagePlan): readonly RuntimeRequirement[] {
  const platforms = new Set(plan.artifacts.map((artifact) => artifact.platform));
  return DESKTOP_BACKENDS.filter((backend) => platforms.has(backend.platform) && backend.runtimeDependency !== null).map(
    (backend) => ({
      platform: backend.platform,
      dependency: backend.runtimeDependency!,
      minimumOs: backend.minimumOs,
    }),
  );
}
