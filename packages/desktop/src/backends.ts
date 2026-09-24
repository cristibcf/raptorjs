/**
 * Back-end-urile de WebView ale adaptorului desktop (roadmap sectiunea 6).
 *
 * "Nucleu comun in Rust si back-end-uri de WebView pentru Windows, macOS si
 * Linux" inseamna ca nu impachetam un browser: folosim WebView-ul sistemului.
 * Consecinta trebuie sa fie vizibila in contract, nu ascunsa in documentatie -
 * de aici `minimumOs` si `runtimeDependency`: pe Windows, WebView2 poate lipsi
 * de pe masina si instalatorul trebuie sa stie asta.
 */

export interface DesktopBackend {
  readonly platform: "windows" | "macos" | "linux";
  readonly webview: string;
  readonly architectures: readonly string[];
  readonly minimumOs: string;
  /** Componenta care trebuie sa existe pe masina tinta, sau `null`. */
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
    notes: "instalatorul verifica runtime-ul WebView2 si il aduce daca lipseste",
  },
  {
    platform: "macos",
    webview: "WKWebView",
    architectures: ["arm64", "x64"],
    minimumOs: "macOS 11",
    runtimeDependency: null,
    notes: "WKWebView face parte din sistem; aplicatia cere notarizare",
  },
  {
    platform: "linux",
    webview: "WebKitGTK",
    architectures: ["x64", "arm64"],
    minimumOs: "glibc 2.31",
    runtimeDependency: "libwebkit2gtk-4.1",
    notes: "AppImage poarta dependenta; pachetul .deb o declara",
  },
];

export const DESKTOP_PLATFORMS: readonly string[] = DESKTOP_BACKENDS.map((backend) => backend.platform);

export function desktopBackend(platform: string): DesktopBackend | undefined {
  return DESKTOP_BACKENDS.find((backend) => backend.platform === platform);
}
