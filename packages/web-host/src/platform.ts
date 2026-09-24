/**
 * Bucatile de browser de care are nevoie adaptorul, ca interfete.
 *
 * Nu importam `window` direct din doua motive. Unul practic: adaptorul trebuie
 * sa fie testabil pe Node, fara browser. Unul de fond: ce ii dai host-ului aici
 * este exact suprafata pe care o poate atinge - daca o bucata nu este trecuta,
 * metoda corespunzatoare raspunde `raptor:host/unimplemented`, nu se descurca
 * singura cautand prin `globalThis`.
 */

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export interface HistoryLike {
  pushState(data: unknown, unused: string, url: string): void;
  back(): void;
  readonly length: number;
}

export interface LocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
}

export interface WindowOpenerLike {
  open(url: string, target: string, features: string): unknown;
}

export interface NotificationLike {
  requestPermission(): Promise<"granted" | "denied" | "default">;
  show(title: string, body: string): void;
}

export interface GeolocationLike {
  current(): Promise<{ latitude: number; longitude: number; accuracyM: number }>;
}

export interface CameraLike {
  capture(): Promise<{ mimeType: string; byteLength: number; handle: string }>;
}

export interface FilePickerLike {
  pick(): Promise<{ name: string; mimeType: string; byteLength: number; handle: string }>;
}

export interface WebPlatform {
  readonly storage?: WebStorageLike;
  readonly history?: HistoryLike;
  readonly location?: LocationLike;
  readonly opener?: WindowOpenerLike;
  readonly notifications?: NotificationLike;
  readonly geolocation?: GeolocationLike;
  readonly camera?: CameraLike;
  readonly files?: FilePickerLike;
  /** Titlul documentului; `window.setTitle` il schimba pe al paginii curente. */
  setTitle?(title: string): void;
  /** Inregistreaza butonul de back al browserului (`popstate`). */
  onPopState?(listener: (path: string) => void): void;
}

/**
 * Platforma reala, citita dintr-un `window` de browser.
 *
 * Trecem prin `unknown` in loc sa depindem de lib.dom in semnatura publica:
 * pachetul trebuie sa se compileze si intr-un proiect care tinteste doar Node.
 * Bucatile care lipsesc din mediul dat raman pur si simplu nemontate.
 */
export function platformFromWindow(win: unknown): WebPlatform {
  const w = win as Record<string, unknown>;
  const platform: Record<string, unknown> = {};

  if (w["localStorage"]) platform["storage"] = w["localStorage"];
  if (w["history"]) platform["history"] = w["history"];
  if (w["location"]) platform["location"] = w["location"];
  if (typeof w["open"] === "function") {
    platform["opener"] = { open: (url: string, target: string, features: string) => (w["open"] as (...args: unknown[]) => unknown)(url, target, features) };
  }

  const doc = w["document"] as Record<string, unknown> | undefined;
  if (doc) {
    platform["setTitle"] = (title: string): void => {
      doc["title"] = title;
    };
  }

  const NotificationCtor = w["Notification"] as
    | (new (title: string, options: { body: string }) => unknown) & { requestPermission(): Promise<string> }
    | undefined;
  if (NotificationCtor) {
    platform["notifications"] = {
      async requestPermission(): Promise<"granted" | "denied" | "default"> {
        const result = await NotificationCtor.requestPermission();
        return result === "granted" || result === "denied" ? result : "default";
      },
      show(title: string, body: string): void {
        new NotificationCtor(title, { body });
      },
    };
  }

  const navigator = w["navigator"] as Record<string, unknown> | undefined;
  const geolocation = navigator?.["geolocation"] as
    | { getCurrentPosition(ok: (p: unknown) => void, bad: (e: unknown) => void): void }
    | undefined;
  if (geolocation) {
    platform["geolocation"] = {
      current: () =>
        new Promise<{ latitude: number; longitude: number; accuracyM: number }>((resolve, reject) => {
          geolocation.getCurrentPosition((position) => {
            const coords = (position as { coords: { latitude: number; longitude: number; accuracy: number } }).coords;
            resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyM: coords.accuracy });
          }, reject);
        }),
    };
  }

  if (typeof w["addEventListener"] === "function" && w["location"]) {
    platform["onPopState"] = (listener: (path: string) => void): void => {
      (w["addEventListener"] as (type: string, handler: () => void) => void)("popstate", () => {
        const location = w["location"] as { pathname: string; search: string; hash: string };
        listener(location.pathname + location.search + location.hash);
      });
    };
  }

  return platform as WebPlatform;
}
