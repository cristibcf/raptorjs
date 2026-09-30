/**
 * Mobile packaging.
 *
 * The difference from desktop is not cosmetic: on a phone distribution goes
 * through the store, so signing is not a team option but a platform condition
 * (`store`). The plan says this explicitly, so CI does not try to publish
 * artifacts the store would reject anyway.
 */
import { planPackages } from "@raptorstack/host";
import type { HostManifest, InstallerFormat, PackagePlan } from "@raptorstack/host";

export const MOBILE_FORMATS: readonly InstallerFormat[] = [
  {
    id: "aab",
    platform: "android",
    architectures: ["universal"],
    extension: "aab",
    signing: "store",
    runner: "ubuntu-latest",
    notes: "the format required by Google Play; the store generates the per-device APKs",
  },
  {
    id: "apk",
    platform: "android",
    architectures: ["arm64", "x64"],
    extension: "apk",
    signing: "required",
    runner: "ubuntu-latest",
    notes: "direct distribution or on-device testing",
  },
  {
    id: "ipa",
    platform: "ios",
    architectures: ["arm64"],
    extension: "ipa",
    signing: "store",
    runner: "macos-latest",
    notes: "signing with a provisioning profile; distribution through the App Store or TestFlight",
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
