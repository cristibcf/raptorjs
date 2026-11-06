/**
 * Messages: a locale signal, catalogues, interpolation and plural selection.
 *
 * This is the half the stack was missing. `ui/date` and `ui/input-extra`
 * already format dates, money, durations and sizes through `Intl`; what had no
 * home was the text itself, so every application hand-rolled a catalogue and a
 * plural rule - and a good number get the plural rule wrong. Romanian has
 * three forms, Polish four.
 *
 * It is a signal read on purpose, and that is the point worth looking at:
 * `t()` subscribes to the locale, so `setLocale("ro")` re-binds exactly the
 * text nodes that read it. No re-render, no reload, no component re-running -
 * which is what fine-grained reactivity is better at than a VDOM, where the
 * same switch means re-rendering the tree (whitepaper 2, 4.1).
 *
 * Plural selection is delegated to `Intl.PluralRules`: a few lines here, and
 * the CLDR data for every locale the runtime ships. Zero dependencies, and no
 * `window` assumption, so the same catalogue renders an SSR page and an email.
 *
 * Numbers are interpolated with `String(value)`, deliberately: formatting
 * quantities is `groupDigits` / `formatCurrency` / `formatDate`'s job, and
 * silently grouping an id into "123,456" would be worse than useless. Format
 * first, interpolate the string.
 */
import { state } from "@raptorstack/raptorjs";

/** The CLDR plural categories, as `Intl.PluralRules` names them. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * A pluralized message. `other` is required because it is the only category
 * every locale has - the rest exist in the locales that need them.
 */
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };

/** One entry in a catalogue: a plain string, or one form per plural category. */
export type Message = string | PluralForms;

/** Flat keys, dots included (`"inbox.title"`); nesting would collide with `PluralForms`. */
export type Catalogue = Readonly<Record<string, Message>>;

/** A lazily loaded catalogue. `() => import("./ro.ts")` satisfies it directly. */
export type CatalogueLoader = () => Promise<Catalogue | { default: Catalogue }>;

/** Placeholder values for `{name}`. Numbers are inserted as `String(value)`. */
export type Values = Readonly<Record<string, string | number>>;

// --- State -----------------------------------------------------------------
// Module-level, like the router's location: there is one current language, and
// every t() in the document observes it. Per-request locales on the server go
// through `withLocale`, not through this signal.

const current = state<string>(detectLocale());
/**
 * Bumped whenever a catalogue changes. Needed because a lazily loaded
 * catalogue arrives without the locale tag changing, and the text that fell
 * back to its key must still re-bind when it lands.
 */
const revision = state(0);

const catalogues = new Map<string, Catalogue>();
const loaders = new Map<string, CatalogueLoader>();
const loading = new Map<string, Promise<void>>();
const pluralRules = new Map<string, Intl.PluralRules | null>();
const reported = new Set<string>();

let fallback = "en";
let override: string | null = null;
let onMissing: ((key: string, locale: string) => void) | null = null;

function detectLocale(): string {
  // Host-guarded: the browser knows, every other host has to be told.
  const nav = (globalThis as { navigator?: { language?: string } }).navigator;
  const tag = nav?.language;
  return typeof tag === "string" && tag.length > 0 ? tag : "en";
}

/** `"ro-MD"` -> `"ro"`. The tag itself when it has no region. */
function baseOf(tag: string): string {
  const dash = tag.indexOf("-");
  return dash === -1 ? tag : tag.slice(0, dash);
}

/** Lookup order for `tag`: itself, its base language, then the fallback's. */
function chainFor(tag: string): string[] {
  const out = [tag];
  const base = baseOf(tag);
  if (base !== tag) out.push(base);
  for (const candidate of [fallback, baseOf(fallback)]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

// --- Catalogues ------------------------------------------------------------

function merge(tag: string, catalogue: Catalogue): void {
  const existing = catalogues.get(tag);
  catalogues.set(tag, existing ? { ...existing, ...catalogue } : catalogue);
  // A key that was missing may now exist: let the bindings that fell back to
  // it recompute. Also clears its "already reported" mark.
  for (const mark of reported) {
    if (mark.endsWith("\u0000" + tag)) reported.delete(mark);
  }
  revision.update((n) => n + 1);
}

/**
 * Registers messages for a locale, eagerly or lazily.
 *
 * ```ts
 * loadMessages("en", { "inbox.title": "Inbox" });
 * loadMessages("ro", () => import("./locales/ro.ts"));
 * ```
 *
 * A loader runs at most once, the first time the locale is needed, so ten
 * languages registered here are not ten bundles loaded.
 */
export function loadMessages(tag: string, source: Catalogue | CatalogueLoader): void {
  if (typeof source === "function") loaders.set(tag, source);
  else merge(tag, source);
}

/**
 * Ensures a catalogue is available, or `null` when there is nothing to wait
 * for (already loaded, or never registered - the lookup will fall back).
 */
function ensure(tag: string): Promise<void> | null {
  if (catalogues.has(tag)) return null;
  const inFlight = loading.get(tag);
  if (inFlight) return inFlight;
  const loader = loaders.get(tag);
  if (!loader) {
    const base = baseOf(tag);
    return base === tag ? null : ensure(base);
  }
  const work = (async () => {
    try {
      const loaded = await loader();
      const catalogue = (loaded as { default?: Catalogue }).default ?? (loaded as Catalogue);
      merge(tag, catalogue);
    } catch (err) {
      // A failed load must not wedge the language: warn, switch anyway, and
      // let the keys fall back. An application that wants to block on this
      // can await `setLocale` and check `hasMessages`.
      console.warn(`[raptor] i18n: loading the "${tag}" catalogue failed:`, err);
    } finally {
      loading.delete(tag);
    }
  })();
  loading.set(tag, work);
  return work;
}

/** The locale tags that have messages registered, loaded or lazy. */
export function locales(): string[] {
  return [...new Set([...catalogues.keys(), ...loaders.keys()])].sort();
}

/** Whether `tag`'s catalogue is loaded (a lazy one that has not run is not). */
export function hasMessages(tag: string): boolean {
  return catalogues.has(tag);
}

// --- Locale ----------------------------------------------------------------

/** The current locale tag, as a reactive read. */
export function locale(): string {
  // `override` first, so a `withLocale` render does not subscribe to the
  // global signal it is deliberately ignoring.
  return override ?? current();
}

/**
 * Switches language. Resolves once the catalogue is available; the locale flips
 * only then, so the UI never shows a frame of raw keys while a lazy catalogue
 * is in flight. An already-loaded locale switches synchronously.
 */
export function setLocale(tag: string): Promise<void> {
  const pending = ensure(tag);
  if (!pending) {
    current.set(tag);
    return Promise.resolve();
  }
  return pending.then(() => {
    current.set(tag);
  });
}

/**
 * The locale a key falls back to when the current one has no entry for it
 * (default `"en"`). Set it before the first render.
 */
export function setFallbackLocale(tag: string): void {
  fallback = tag;
  revision.update((n) => n + 1);
}

/**
 * Renders `fn` in `tag` regardless of the current locale - an SSR response in
 * the request's language, or ten emails in ten languages from one process,
 * without touching the global signal other requests are reading.
 *
 * Synchronous only: rendering in this stack is synchronous, and an `await`
 * inside would let the override leak into whatever ran next.
 */
export function withLocale<T>(tag: string, fn: () => T): T {
  const previous = override;
  override = tag;
  try {
    return fn();
  } finally {
    override = previous;
  }
}

/**
 * Where a missing key goes. `null` restores the default, a single
 * `console.warn` per key per locale. Useful to route misses to telemetry, or
 * to make them throw in a test.
 */
export function setMissingKeyHandler(handler: ((key: string, locale: string) => void) | null): void {
  onMissing = handler;
  reported.clear();
}

function reportMissing(key: string, tag: string): void {
  // Once per key per locale: a missing key sits in a binding that recomputes,
  // and a warning per keystroke would bury the one that matters.
  const mark = key + "\u0000" + tag;
  if (reported.has(mark)) return;
  reported.add(mark);
  if (onMissing) onMissing(key, tag);
  else console.warn(`[raptor] i18n: missing key "${key}" for locale "${tag}"`);
}

// --- Lookup, interpolation, plurals ----------------------------------------

function lookup(key: string, tag: string): Message | undefined {
  for (const candidate of chainFor(tag)) {
    const message = catalogues.get(candidate)?.[key];
    if (message !== undefined) return message;
  }
  return undefined;
}

const RE_PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, values: Values | undefined): string {
  if (!values) return template;
  return template.replace(RE_PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    // An unknown placeholder is left verbatim, so a message that legitimately
    // contains `{foo}` survives, and a typo is visible instead of silent.
    return value === undefined ? whole : String(value);
  });
}

function selectPlural(tag: string, count: number): PluralCategory {
  let rules = pluralRules.get(tag);
  if (rules === undefined) {
    try {
      rules = typeof Intl !== "undefined" && Intl.PluralRules ? new Intl.PluralRules(tag) : null;
    } catch {
      rules = null; // an unknown tag must not take the page down
    }
    pluralRules.set(tag, rules);
  }
  if (!rules) return count === 1 ? "one" : "other";
  return rules.select(count) as PluralCategory;
}

/**
 * The translation of `key`, with `{name}` placeholders filled from `values`.
 *
 * A signal read: call it inside a binding (`R.p(() => t("inbox.title"))`) and
 * that text node re-binds on `setLocale`, on its own.
 *
 * A missing key returns the key itself rather than throwing - a half-translated
 * screen is a bug to fix, not a reason to blank the page - and is reported
 * once through `setMissingKeyHandler`.
 */
export function t(key: string, values?: Values): string {
  revision();
  const tag = locale();
  const message = lookup(key, tag);
  if (message === undefined) {
    reportMissing(key, tag);
    return key;
  }
  // A pluralized entry read without a count: `other` is the form every locale
  // has, and is the one a bare key means.
  return interpolate(typeof message === "string" ? message : message.other, values);
}

/**
 * The translation of `key` for `count`, choosing the plural form with
 * `Intl.PluralRules` - three forms in Romanian, four in Polish, and whatever
 * the locale actually needs rather than `count === 1`.
 *
 * `{count}` is available to the message without being passed, as
 * `String(count)`; pass `count` in `values` to substitute a formatted one.
 */
export function plural(key: string, count: number, values?: Values): string {
  revision();
  const tag = locale();
  const message = lookup(key, tag);
  if (message === undefined) {
    reportMissing(key, tag);
    return key;
  }
  if (typeof message === "string") return interpolate(message, { count, ...values });
  const category = selectPlural(tag, count);
  return interpolate(message[category] ?? message.other, { count, ...values });
}
