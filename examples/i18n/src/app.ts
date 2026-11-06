/**
 * The application: ten registered languages, one of them eager.
 *
 * Nine of the ten are registered as loaders, so registering them costs nothing
 * - the catalogue is fetched the first time `setLocale` needs it, and never
 * again. Three are filled in here; the rest resolve through the fallback until
 * their file exists, which is exactly what a half-translated app should do.
 */
import { loadMessages, setFallbackLocale, t, plural } from "@raptorstack/raptorjs/i18n";
import { R } from "@raptorstack/raptorjs/dom";
import en from "./locales/en.ts";

/** The ten Gata ships on day one, in the order a language picker would show them. */
export const SUPPORTED = ["ro", "en", "de", "es", "fr", "it", "pl", "pt", "nl", "hu"] as const;

export function registerLocales(): void {
  // Eager: the fallback has to be there before the first render.
  loadMessages("en", en);
  setFallbackLocale("en");
  loadMessages("ro", () => import("./locales/ro.ts"));
  loadMessages("pl", () => import("./locales/pl.ts"));
}

/**
 * One screen. Every text is an accessor, so it is a binding the locale signal
 * owns - which is the whole demonstration: see demo.ts for the mutation count.
 */
export function Screen(jobs: () => number): unknown {
  return R.section(
    { class: "screen" },
    R.h1({}, () => t("app.title")),
    R.h2({}, () => t("inbox.title")),
    R.p({ class: "greeting" }, () => t("greeting", { name: "Ana" })),
    R.p({ class: "jobs" }, () => plural("jobs.count", jobs())),
  );
}
