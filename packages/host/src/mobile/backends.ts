/**
 * The mobile back-ends (roadmap section 6).
 *
 * "A minimal bridge for Android and iOS, with a WebView and strictly bounded
 * native modules." The bounding starts here: each platform declares its
 * WebView, its secret store and its distribution format, and the adapter
 * assumes nothing beyond what the table says.
 */

export interface MobileBackend {
  readonly platform: "android" | "ios";
  readonly webview: string;
  readonly minimumOs: string;
  /** Where the secure storage required by section 6 ends up. */
  readonly secureStore: string;
  readonly deepLinkMechanism: string;
}

export const MOBILE_BACKENDS: readonly MobileBackend[] = [
  {
    platform: "android",
    webview: "Android System WebView",
    minimumOs: "Android 8.0 (API 26)",
    secureStore: "EncryptedSharedPreferences",
    deepLinkMechanism: "App Links (verified intent-filter)",
  },
  {
    platform: "ios",
    webview: "WKWebView",
    minimumOs: "iOS 15",
    secureStore: "Keychain",
    deepLinkMechanism: "Universal Links (apple-app-site-association)",
  },
];

export const MOBILE_PLATFORMS: readonly string[] = MOBILE_BACKENDS.map((backend) => backend.platform);

export function mobileBackend(platform: string): MobileBackend | undefined {
  return MOBILE_BACKENDS.find((backend) => backend.platform === platform);
}
