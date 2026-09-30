/**
 * The WebView back-ends of the desktop adapter (roadmap section 6).
 *
 * "A common core in Rust and WebView back-ends for Windows, macOS and Linux"
 * means we do not bundle a browser: we use the system's WebView. The
 * consequence must be visible in the contract, not hidden in documentation -
 * hence `minimumOs` and `runtimeDependency`: on Windows, WebView2 may be missing
 * from the machine and the installer must know it.
 */

export interface DesktopBackend {
  readonly platform: "windows" | "macos" | "linux";
  readonly webview: string;
  readonly architectures: readonly string[];
  readonly minimumOs: string;
  /** The component that must exist on the target machine, or `null`. */
  readonly runtimeDependency: string | null;
  readonly notes: string;
}

export const DESKTOP_BACKENDS: readonly DesktopBackend[] = [
  {
    platform: "windows",
    webview: "WebView2",
    architectures: ["x64", "arm64"],
    minimumOs: "Windows 10 1809",
    runtimeDependency: "Microsoft Edge WebView2 Runtime",
    notes: "the installer checks the WebView2 runtime and brings it in if it is missing",
  },
  {
    platform: "macos",
    webview: "WKWebView",
    architectures: ["arm64", "x64"],
    minimumOs: "macOS 11",
    runtimeDependency: null,
    notes: "WKWebView is part of the system; the app requires notarization",
  },
  {
    platform: "linux",
    webview: "WebKitGTK",
    architectures: ["x64", "arm64"],
    minimumOs: "glibc 2.31",
    runtimeDependency: "libwebkit2gtk-4.1",
    notes: "AppImage carries the dependency; the .deb package declares it",
  },
];

export const DESKTOP_PLATFORMS: readonly string[] = DESKTOP_BACKENDS.map((backend) => backend.platform);

export function desktopBackend(platform: string): DesktopBackend | undefined {
  return DESKTOP_BACKENDS.find((backend) => backend.platform === platform);
}
