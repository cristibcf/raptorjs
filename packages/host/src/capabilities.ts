/**
 * Matricea de capabilitati a host-urilor native (roadmap sectiunea 6).
 *
 * Tabelul din roadmap este sursa de adevar si este transcris aici ca date, nu
 * ca ramuri `if` imprastiate prin adaptoare: desktop-ul si mobilul citesc
 * aceeasi matrice, deci o diferenta de politica intre ele nu poate aparea din
 * neatentie. Randurile marcate ca venind din proza sectiunii 6 sunt separate
 * explicit de randurile tabelului, ca sa se vada ce este contract si ce este
 * extindere.
 */
import { HostError } from "./errors.ts";

export const HOST_TARGETS = ["desktop", "mobile", "web", "server", "cli", "embedded"] as const;
export type HostTarget = (typeof HOST_TARGETS)[number];

/**
 * Tintele pe care roadmap-ul le numeste "host nativ" (sectiunea 4).
 *
 * `web`, `server`, `cli` si `embedded` nu sunt printre ele, si coloanele lor
 * din matrice sunt *derivate*, nu citite din tabelul sectiunii 6: pe web host-ul
 * este browserul, pe server supervizorul de proces, pe cli terminalul, iar pe
 * embedded firmware-ul plachetei - singurul host care nu are incredere in
 * aplicatie si o reseteaza daca nu mai da semne de viata.
 *
 * Distinctia conteaza cand se citeste matricea ca spec: doar doua coloane din
 * ea sunt contract, restul sunt extinderi ale aceluiasi model.
 */
export const NATIVE_TARGETS: readonly HostTarget[] = ["desktop", "mobile"];

/**
 * `granted`     - disponibila pe tinta, dar tot marginita de politica ei;
 * `optional`    - exista doar daca aplicatia o declara explicit in manifest;
 * `unavailable` - nu exista pe tinta; declararea ei este o eroare de manifest.
 */
export type Availability = "granted" | "optional" | "unavailable";

export interface HostCapabilityDefinition {
  readonly id: string;
  readonly summary: string;
  readonly desktop: Availability;
  readonly mobile: Availability;
  /** Derivata din constrangerile platformei web, nu din tabelul sectiunii 6. */
  readonly web: Availability;
  /** Derivata din ce ofera un supervizor de proces; vezi `NATIVE_TARGETS`. */
  readonly server: Availability;
  /** Derivata din ce ofera un terminal; vezi `NATIVE_TARGETS`. */
  readonly cli: Availability;
  /** Derivata din ce ofera firmware-ul unei plachete; vezi `NATIVE_TARGETS`. */
  readonly embedded: Availability;
  readonly policy: string;
  /** Politica unei tinte, cand difera de cea implicita de mai sus. */
  readonly policies?: Partial<Record<HostTarget, string>>;
  /**
   * Cine aplica efectiv limita. `runtime` inseamna ca adaptorul doar transporta
   * declaratia, iar refuzul vine din capability broker-ul RaptorRuntime.
   */
  readonly enforcedBy: "host" | "runtime";
  /**
   * `table` = randul apare in tabelul sectiunii 6; `prose` = din textul ei;
   * `derived` = nu apare in roadmap, exista pentru o tinta ne-nativa.
   */
  readonly source: "table" | "prose" | "derived";
}

/** Randurile tabelului din sectiunea 6, plus modulele optionale din proza. */
export const HOST_CAPABILITIES: readonly HostCapabilityDefinition[] = [
  {
    id: "app.storage",
    summary: "Stocare aplicatie",
    desktop: "granted",
    mobile: "granted",
    web: "granted",
    server: "granted",
    cli: "granted",
    embedded: "granted",
    policy: "limitata la directorul aplicatiei",
    policies: {
      web: "limitata la originea paginii (localStorage)",
      server: "limitata la directorul de date al serviciului",
      cli: "limitata la directorul de configuratie al uneltei",
      embedded: "partitie de NVS; scrierile uzeaza flash-ul, deci sunt numarate",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "net.connect",
    summary: "Retea",
    desktop: "granted",
    mobile: "granted",
    web: "granted",
    server: "granted",
    cli: "granted",
    embedded: "optional",
    policy: "allowlist de domenii si timeouts",
    policies: {
      web: "allowlist de domenii, peste CORS-ul browserului",
      embedded: "multe plachete nu au retea deloc; cand exista, se declara explicit",
    },
    enforcedBy: "runtime",
    source: "table",
  },
  {
    id: "window.manage",
    summary: "Ferestre si navigare",
    desktop: "granted",
    mobile: "unavailable",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "controlata de adaptor",
    policies: {
      web: "history API si popup-uri; popup-ul cere gest de utilizator, meniurile nu exista",
      server: "un serviciu nu are interfata grafica",
      cli: "o unealta de linie de comanda nu are ferestre",
      embedded: "o placheta nu are sistem de ferestre",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.camera",
    summary: "Camera",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "permisiune explicita de sistem si runtime",
    policies: {
      web: "getUserMedia; browserul cere permisiune la prima folosire",
      server: "nu exista pe un server",
      cli: "nu exista intr-un terminal",
      embedded: "un senzor de imagine se atinge ca periferic, nu ca modul de sistem",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.location",
    summary: "Locatie",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "permisiune explicita de sistem si runtime",
    policies: {
      web: "geolocation; browserul cere permisiune la prima folosire",
      server: "nu exista pe un server",
      cli: "nu exista intr-un terminal",
      embedded: "un modul GPS se atinge ca periferic, pe magistrala",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "process.spawn",
    summary: "Subprocese",
    desktop: "optional",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "optional",
    embedded: "unavailable",
    policy: "doar desktop, cu lista explicita",
    policies: {
      web: "nu exista in browser, sub nicio forma",
      server: "workers si unelte, cu lista explicita",
      cli: "unelte externe, cu lista explicita",
      embedded: "nu exista procese; firmware-ul este un singur program",
    },
    enforcedBy: "host",
    source: "table",
  },
  {
    id: "device.notifications",
    summary: "Notificari",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "modul optional, cu capabilitate proprie",
    policies: {
      web: "Notification API; browserul cere permisiune",
      server: "notificarile serviciului merg in loguri, nu la un utilizator",
      cli: "iesirea unei unelte merge in terminal, nu in notificari",
      embedded: "o placheta semnaleaza prin periferice, nu prin notificari",
    },
    enforcedBy: "host",
    source: "prose",
  },
  {
    id: "device.files",
    summary: "Selector de fisiere al sistemului",
    desktop: "optional",
    mobile: "optional",
    web: "optional",
    server: "unavailable",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "modul optional; intoarce doar fisierele alese de utilizator",
    policies: {
      web: "input de fisier ales de utilizator; fara acces la disc",
      server: "nu exista un utilizator care sa aleaga fisiere",
      cli: "fisierele vin din argumente, nu dintr-un selector",
      embedded: "nu exista utilizator si nici sistem de fisiere obisnuit",
    },
    enforcedBy: "host",
    source: "prose",
  },
  {
    id: "net.listen",
    summary: "Deschiderea de socketi de ascultare",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "optional",
    embedded: "optional",
    policy: "porturi declarate explicit; socketul il deschide host-ul, nu aplicatia",
    policies: {
      cli: "o unealta poate servi local (dev server), cu porturi declarate",
      embedded: "doar daca placheta are retea; tipic o pagina de configurare",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "service.config",
    summary: "Configuratie si secrete de la supervizor",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "optional",
    cli: "unavailable",
    embedded: "unavailable",
    policy: "chei declarate; valorile vin de la supervizor, nu din fisierele aplicatiei",
    policies: {
      cli: "o unealta isi citeste configuratia prin capabilitatile de runtime",
      embedded: "configuratia sta in NVS, adica in stocarea aplicatiei",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "tty.interact",
    summary: "Citirea de la utilizator (prompt, confirmare)",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "optional",
    embedded: "unavailable",
    policy: "doar cu terminal interactiv; fara el, orice intrebare este refuzata, nu presupusa",
    policies: {
      embedded: "nu exista utilizator la capatul celalalt",
    },
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "hw.gpio",
    summary: "Pini digitali",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "pini declarati explicit, cu directie; un pin nedeclarat nu poate fi nici citit, nici scris",
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "hw.bus",
    summary: "Magistrale de periferice (I2C, SPI)",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "magistrale si adrese declarate explicit; restul magistralei ramane inaccesibil",
    enforcedBy: "host",
    source: "derived",
  },
  {
    id: "power.sleep",
    summary: "Controlul somnului plachetei",
    desktop: "unavailable",
    mobile: "unavailable",
    web: "unavailable",
    server: "unavailable",
    cli: "unavailable",
    embedded: "optional",
    policy: "aplicatia poate cere somn, dar nu poate opri watchdog-ul",
    enforcedBy: "host",
    source: "derived",
  },
];

const BY_ID = new Map(HOST_CAPABILITIES.map((capability) => [capability.id, capability]));

export function hostCapability(id: string): HostCapabilityDefinition | undefined {
  return BY_ID.get(id);
}

export function availabilityOn(capability: HostCapabilityDefinition, target: HostTarget): Availability {
  if (target === "desktop") return capability.desktop;
  if (target === "mobile") return capability.mobile;
  if (target === "web") return capability.web;
  if (target === "server") return capability.server;
  if (target === "cli") return capability.cli;
  return capability.embedded;
}

/** Politica in vigoare pe tinta data; tintele ne-native au uneori alta. */
export function policyOn(capability: HostCapabilityDefinition, target: HostTarget): string {
  return capability.policies?.[target] ?? capability.policy;
}

/** Capabilitatile pe care o tinta le poate oferi, indiferent de aplicatie. */
export function capabilitiesFor(target: HostTarget): readonly HostCapabilityDefinition[] {
  return HOST_CAPABILITIES.filter((capability) => availabilityOn(capability, target) !== "unavailable");
}

export interface CapabilityVerdict {
  readonly id: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly availability: Availability | "unknown";
}

/**
 * Decizia pentru o singura capabilitate, pe o tinta, cu un set declarat.
 *
 * Este pura si sincrona: aceeasi functie ruleaza si in JS (ca sa refuze devreme,
 * cu un mesaj bun), si pe latura host-ului (unde este granita reala). Duplicarea
 * verificarii este intentionata - latura JS poate fi oricand ocolita.
 */
export function decideCapability(
  target: HostTarget,
  id: string,
  declared: readonly string[],
): CapabilityVerdict {
  const definition = BY_ID.get(id);
  if (!definition) {
    return { id, granted: false, reason: "capabilitate de host necunoscuta", availability: "unknown" };
  }

  const availability = availabilityOn(definition, target);
  if (availability === "unavailable") {
    return {
      id,
      granted: false,
      reason: `nu exista pe ${target}: ${policyOn(definition, target)}`,
      availability,
    };
  }
  if (availability === "granted") {
    return { id, granted: true, reason: policyOn(definition, target), availability };
  }
  if (declared.includes(id)) {
    return { id, granted: true, reason: `declarata explicit; ${policyOn(definition, target)}`, availability };
  }
  return { id, granted: false, reason: "modul optional nedeclarat in raptor.host.json", availability };
}

/** Varianta care arunca; folosita pe caile in care refuzul opreste apelul. */
export function requireCapability(target: HostTarget, id: string, declared: readonly string[]): CapabilityVerdict {
  const verdict = decideCapability(target, id, declared);
  if (verdict.granted) return verdict;
  const code =
    verdict.availability === "optional" ? "raptor:host/capability-undeclared" : "raptor:host/capability-unavailable";
  throw new HostError(code, `capabilitatea '${id}' nu este disponibila: ${verdict.reason}`, {
    capability: id,
    target,
    declared: [...declared],
  });
}
