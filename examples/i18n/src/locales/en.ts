/** The fallback catalogue: shipped eagerly, because something must always resolve. */
import type { Catalogue } from "@raptorstack/raptorjs/i18n";

const en: Catalogue = {
  "app.title": "Assistant",
  "inbox.title": "Inbox",
  "inbox.empty": "Nothing to read.",
  "jobs.count": { one: "{count} job running", other: "{count} jobs running" },
  greeting: "Hello, {name}!",
};

export default en;
