/**
 * Back-end-urile mobile (roadmap sectiunea 6).
 *
 * "Bridge minimal pentru Android si iOS, cu WebView si module native strict
 * delimitate." Delimitarea incepe de aici: fiecare platforma isi declara
 * WebView-ul, magazinul de secrete si formatul de distributie, iar adaptorul nu
 * presupune nimic dincolo de ce scrie in tabel.
 */

export interface MobileBackend {
  readonly platform: "android" | "ios";
  readonly webview: string;
  readonly minimumOs: string;
  /** Unde ajunge stocarea securizata ceruta de sectiunea 6. */
  readonly secureStore: string;
  readonly deepLinkMechanism: string;
}

export const MOBILE_BACKENDS: readonly MobileBackend[] = [
  {
    platform: "android",
    webview: "Android System WebView",
    minimumOs: "Android 8.0 (API 26)",
    secureStore: "EncryptedSharedPreferences",
    deepLinkMechanism: "App Links (intent-filter verificat)",
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
