/**
 * Impachetarea mobila.
 *
 * Diferenta fata de desktop nu este cosmetica: pe telefon distributia trece prin
 * magazin, deci semnarea nu este o optiune a echipei, ci o conditie a platformei
 * (`store`). Planul spune asta explicit, ca CI-ul sa nu incerce sa publice
 * artefacte pe care magazinul oricum le-ar respinge.
 */
import { planPackages } from "@raptor/host";
import type { HostManifest, InstallerFormat, PackagePlan } from "@raptor/host";

export const MOBILE_FORMATS: readonly InstallerFormat[] = [
  {
    id: "aab",
    platform: "android",
    architectures: ["universal"],
    extension: "aab",
    signing: "store",
    runner: "ubuntu-latest",
    notes: "formatul cerut de Google Play; magazinul genereaza APK-urile per dispozitiv",
  },
  {
    id: "apk",
    platform: "android",
    architectures: ["arm64", "x64"],
    extension: "apk",
    signing: "required",
    runner: "ubuntu-latest",
    notes: "distributie directa sau teste pe dispozitiv",
  },
  {
    id: "ipa",
    platform: "ios",
    architectures: ["arm64"],
    extension: "ipa",
    signing: "store",
    runner: "macos-latest",
    notes: "semnare cu profil de provisioning; distributie prin App Store sau TestFlight",
  },
];

export interface MobilePlanOptions {
  readonly platforms?: readonly string[];
}

export function planMobilePackages(manifest: HostManifest, options: MobilePlanOptions = {}): PackagePlan {
  const planOptions = {
    target: "mobile" as const,
    bundleId: manifest.bundleId,
    version: manifest.version,
    formats: MOBILE_FORMATS,
  };
  return planPackages(options.platforms ? { ...planOptions, platforms: options.platforms } : planOptions);
}
