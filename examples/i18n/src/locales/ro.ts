/**
 * Romanian: three plural forms. `few` is not "2 to 4" - it is 0, and 2..19 by
 * the mod-100 rule, which is why 101 takes it and 21 does not.
 */
import type { Catalogue } from "@raptorstack/raptorjs/i18n";

const ro: Catalogue = {
  "app.title": "Asistent",
  "inbox.title": "Mesaje",
  "inbox.empty": "Nimic de citit.",
  "jobs.count": {
    one: "{count} sarcină în curs",
    few: "{count} sarcini în curs",
    other: "{count} de sarcini în curs",
  },
  greeting: "Bună, {name}!",
};

export default ro;
