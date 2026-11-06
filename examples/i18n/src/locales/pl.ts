/** Polish: four forms. `many` is the common one, which `count === 1` never finds. */
import type { Catalogue } from "@raptorstack/raptorjs/i18n";

const pl: Catalogue = {
  "app.title": "Asystent",
  "inbox.title": "Wiadomości",
  "inbox.empty": "Nic do czytania.",
  "jobs.count": {
    one: "{count} zadanie w toku",
    few: "{count} zadania w toku",
    many: "{count} zadań w toku",
    other: "{count} zadania w toku",
  },
  greeting: "Cześć, {name}!",
};

export default pl;
