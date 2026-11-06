/**
 * @raptorstack/raptorjs/i18n - messages, interpolation and plural selection.
 *
 * The formatting half of i18n already lives in `ui/date` and
 * `ui/input-extra` (`formatDate`, `formatCurrency`, `formatDuration`,
 * `formatSize`, `formatTime`, `groupDigits`); this is the message half.
 */
export {
  locale,
  setLocale,
  setFallbackLocale,
  withLocale,
  loadMessages,
  locales,
  hasMessages,
  setMissingKeyHandler,
  t,
  plural,
  type Catalogue,
  type CatalogueLoader,
  type Message,
  type PluralCategory,
  type PluralForms,
  type Values,
} from "./i18n.ts";
