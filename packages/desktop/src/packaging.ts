/**
 * Impachetarea desktop: formate de instalator, plan si matrice de CI.
 *
 * Semnarea nu este optionala pe Windows si macOS - acolo un binar nesemnat este
 * blocat sau avertizat de sistem, deci il marcam `required` si planul spune
 * explicit ce nu poate fi publicat nesemnat (roadmap sectiunea 7: "CI pentru
 * instalatoare - semnare, smoke tests si distributie sigura").
 */
import { planPackages } from "@raptor/host";
import type { HostManifest, InstallerFormat, PackagePlan } from "@raptor/host";
import { DESKTOP_BACKENDS } from "./backends.ts";

export const DESKTOP_FORMATS: readonly InstallerFormat[] = [
  {
    id: "msi",
    platform: "windows",
    architectures: ["x64", "arm64"],
    extension: "msi",
    signing: "required",
    runner: "windows-latest",
    notes: "instalare per-masina, potrivita distributiei in organizatii",
  },
  {
    id: "nsis",
    platform: "windows",
    architectures: ["x64", "arm64"],
    extension: "exe",
    signing: "required",
    runner: "windows-latest",
    notes: "instalare per-utilizator, cu actualizari in fundal",
  },
  {
    id: "dmg",
    platform: "macos",
    architectures: ["arm64", "x64"],
    extension: "dmg",
    signing: "required",
    runner: "macos-latest",
    notes: "cere notarizare Apple inainte de distributie",
  },
  {
    id: "deb",
    platform: "linux",
    architectures: ["x64", "arm64"],
    extension: "deb",
    signing: "optional",
    runner: "ubuntu-latest",
    notes: "declara dependenta de WebKitGTK",
  },
  {
    id: "appimage",
    platform: "linux",
    architectures: ["x64", "arm64"],
    extension: "AppImage",
    signing: "optional",
    runner: "ubuntu-latest",
    notes: "poarta dependentele cu el; nu cere instalare",
  },
];

export interface DesktopPlanOptions {
  /** Restrange planul la aceste platforme; implicit toate cele trei. */
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

/** Ce trebuie sa existe pe masina utilizatorului, dincolo de aplicatia insasi. */
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
