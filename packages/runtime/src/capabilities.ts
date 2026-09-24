/**
 * Capability broker (spec sectiunile 5 si 7): securitatea este o functie de
 * produs, nu un wrapper optional.
 *
 * Reguli implementate aici:
 *  - implicit totul este refuzat, cu exceptia `clock.real` / `crypto.random`,
 *    care sunt permise dar adnotate in trace;
 *  - granularitatea este per tinta (cale, gazda:port, variabila, comanda);
 *  - grant-urile sunt revocabile in timpul rularii;
 *  - delegarea catre un worker/izolat copil se face doar explicit, printr-un
 *    subset declarat - nu prin mostenire ambientala;
 *  - fiecare verificare (permisa sau refuzata) intra in diagnostic.
 */
import { CapabilityError } from "./errors.ts";
import type { CapabilityDeclarations, CapabilityKind, PolicyMode } from "./manifest.ts";
import { CAPABILITY_KINDS } from "./manifest.ts";
import type { Observer } from "./observe.ts";
import { silentObserver } from "./observe.ts";
import { containsPath, normalizePath, resolvePath } from "./paths.ts";

/** Capabilitati ambientale: boolean, fara tinta. */
export const AMBIENT_KINDS: readonly CapabilityKind[] = ["clock.real", "crypto.random"];

export interface CapabilityDecision {
  readonly granted: boolean;
  readonly capability: CapabilityKind;
  readonly target: string;
  readonly reason: string;
  /** Regula din manifest care a decis; util in `doctor` si in erori. */
  readonly rule: string | null;
  /** Accesul e permis, dar trebuie marcat in trace (clock/crypto implicite). */
  readonly annotated: boolean;
}

export interface CapabilityUsage {
  readonly capability: CapabilityKind;
  readonly target: string;
  readonly granted: boolean;
  readonly count: number;
}

export interface CapabilityDiagnostics {
  readonly policy: PolicyMode;
  readonly projectRoot: string;
  readonly strict: boolean;
  readonly declared: Readonly<Record<string, readonly string[] | boolean>>;
  readonly revoked: readonly CapabilityKind[];
  readonly usage: readonly CapabilityUsage[];
}

export interface CapabilityBroker {
  readonly policy: PolicyMode;
  readonly projectRoot: string;
  /** `true` daca nu se aplica niciun domeniu implicit. */
  readonly strict: boolean;
  check(capability: CapabilityKind, target?: string): CapabilityDecision;
  /** Ca `check`, dar arunca `CapabilityError` daca accesul este refuzat. */
  require(capability: CapabilityKind, target?: string): CapabilityDecision;
  revoke(capability: CapabilityKind): void;
  /** Sub-broker cu un subset explicit; nimic nu se mosteneste implicit. */
  delegate(capabilities: readonly CapabilityKind[], label?: string): CapabilityBroker;
  declarations(): CapabilityDeclarations;
  diagnostics(): CapabilityDiagnostics;
}

export interface BrokerOptions {
  readonly declarations?: CapabilityDeclarations;
  readonly projectRoot: string;
  readonly policy?: PolicyMode;
  readonly observer?: Observer;
  /**
   * In regim strict nu exista domenii implicite: absolut tot accesul trebuie
   * declarat in manifest. Politica de productie il activeaza (spec sectiunea 7).
   */
  readonly strict?: boolean;
}

/** Separator care nu poate aparea intr-un nume de capability sau intr-o tinta. */
const SEPARATOR = String.fromCharCode(0);

function ruleTargets(declarations: CapabilityDeclarations, capability: CapabilityKind): string[] {
  const value = (declarations as Record<string, unknown>)[capability];
  return Array.isArray(value) ? (value as string[]) : [];
}

/** `./src` se rezolva fata de radacina proiectului; caile absolute raman. */
function matchPath(rule: string, projectRoot: string, target: string): boolean {
  const scope = resolvePath(projectRoot, rule);
  return containsPath(scope, target);
}

/** `api.example.com:443`, `*.example.com:443`, `api.example.com:*`. */
function matchHost(rule: string, target: string): boolean {
  const sep = rule.lastIndexOf(":");
  if (sep <= 0) return false;
  const ruleHost = rule.slice(0, sep).toLowerCase();
  const rulePort = rule.slice(sep + 1);

  const targetSep = target.lastIndexOf(":");
  if (targetSep <= 0) return false;
  const host = target.slice(0, targetSep).toLowerCase();
  const port = target.slice(targetSep + 1);

  if (rulePort !== "*" && rulePort !== port) return false;
  if (ruleHost === host) return true;
  if (ruleHost.startsWith("*.")) {
    const suffix = ruleHost.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

/** `DATABASE_URL` sau prefix `DATABASE_*`. */
function matchName(rule: string, target: string): boolean {
  if (rule === target) return true;
  if (rule.endsWith("*")) return target.startsWith(rule.slice(0, -1));
  return false;
}

class Broker implements CapabilityBroker {
  readonly policy: PolicyMode;
  readonly projectRoot: string;
  readonly #declarations: CapabilityDeclarations;
  readonly #revoked = new Set<CapabilityKind>();
  readonly #usage = new Map<string, { capability: CapabilityKind; target: string; granted: boolean; count: number }>();
  readonly #observer: Observer;
  readonly #strict: boolean;

  constructor(options: BrokerOptions) {
    this.projectRoot = normalizePath(options.projectRoot);
    this.policy = options.policy ?? "development";
    this.#declarations = { ...(options.declarations ?? {}) };
    this.#observer = options.observer ?? silentObserver();
    this.#strict = options.strict ?? this.policy === "production";
  }

  get strict(): boolean {
    return this.#strict;
  }

  #decide(capability: CapabilityKind, target: string): CapabilityDecision {
    if (this.#revoked.has(capability)) {
      return { granted: false, capability, target, reason: "capability revocata in timpul rularii", rule: null, annotated: false };
    }

    if (AMBIENT_KINDS.includes(capability)) {
      const declared = (this.#declarations as Record<string, unknown>)[capability];
      if (declared === false) {
        return { granted: false, capability, target, reason: "dezactivata explicit in manifest", rule: `${capability}: false`, annotated: false };
      }
      // Implicit permisa, dar marcata in trace (spec sectiunea 7).
      return {
        granted: true,
        capability,
        target,
        reason: declared === true ? "declarata in manifest" : "implicit permisa, adnotata in trace",
        rule: declared === true ? `${capability}: true` : null,
        annotated: declared !== true,
      };
    }

    const rules = ruleTargets(this.#declarations, capability);
    if (rules.length === 0) {
      // Spec sectiunea 7: citirea de fisiere este "refuzata in afara proiectului".
      // Fara declaratie, domeniul implicit este exact radacina proiectului; orice
      // manifest care declara `files.read` inlocuieste complet acest implicit.
      if (!this.#strict && capability === "files.read" && containsPath(this.projectRoot, target)) {
        return {
          granted: true,
          capability,
          target,
          reason: "in radacina proiectului (domeniu implicit)",
          rule: "(implicit: radacina proiectului)",
          annotated: true,
        };
      }
      return { granted: false, capability, target, reason: "nedeclarata in manifest", rule: null, annotated: false };
    }

    for (const rule of rules) {
      const hit =
        capability === "files.read" || capability === "files.write"
          ? matchPath(rule, this.projectRoot, target)
          : capability === "net.connect" || capability === "net.listen"
            ? matchHost(rule, target)
            : matchName(rule, target);
      if (hit) {
        return { granted: true, capability, target, reason: "acoperita de o regula declarata", rule, annotated: false };
      }
    }

    return {
      granted: false,
      capability,
      target,
      reason: `in afara domeniului declarat (${rules.join(", ")})`,
      rule: null,
      annotated: false,
    };
  }

  check(capability: CapabilityKind, target = ""): CapabilityDecision {
    const normalized =
      capability === "files.read" || capability === "files.write" ? resolvePath(this.projectRoot, target) : target;
    const decision = this.#decide(capability, normalized);

    const key = `${capability}${SEPARATOR}${normalized}`;
    const entry = this.#usage.get(key);
    if (entry) entry.count += 1;
    else this.#usage.set(key, { capability, target: normalized, granted: decision.granted, count: 1 });

    this.#observer.record({
      at: 0,
      kind: "capability",
      name: capability,
      severity: decision.granted ? (decision.annotated ? "debug" : "info") : "warn",
      attributes: {
        target: normalized,
        granted: decision.granted,
        reason: decision.reason,
        rule: decision.rule,
        annotated: decision.annotated,
        policy: this.policy,
      },
    });

    return decision;
  }

  require(capability: CapabilityKind, target = ""): CapabilityDecision {
    const decision = this.check(capability, target);
    if (!decision.granted) {
      const code = this.#revoked.has(capability)
        ? "raptor:capability/revoked"
        : decision.rule === null && ruleTargets(this.#declarations, capability).length === 0
          ? "raptor:capability/undeclared"
          : "raptor:capability/denied";
      throw new CapabilityError(code, capability, decision.target, decision.reason);
    }
    return decision;
  }

  revoke(capability: CapabilityKind): void {
    this.#revoked.add(capability);
    this.#observer.log("info", "capability.revoked", { capability });
  }

  delegate(capabilities: readonly CapabilityKind[], label = "delegated"): CapabilityBroker {
    const subset: Record<string, unknown> = {};
    for (const capability of capabilities) {
      if (this.#revoked.has(capability)) continue;
      const declared = (this.#declarations as Record<string, unknown>)[capability];
      if (declared === undefined) continue;
      subset[capability] = Array.isArray(declared) ? [...declared] : declared;
    }
    // Ambientalele nu se propaga implicit: daca nu sunt cerute, copilul le pierde.
    for (const ambient of AMBIENT_KINDS) {
      if (!capabilities.includes(ambient)) subset[ambient] = false;
    }
    this.#observer.log("info", "capability.delegated", { label, capabilities: [...capabilities] });
    // Un broker delegat este strict prin constructie, chiar daca parintele nu
    // este: subsetul cerut ramane singura sursa de acces. Altfel domeniul
    // implicit (radacina proiectului la citire) ar reaparea in copil si ar
    // ocoli si lista delegata, si o capability revocata inainte de delegare.
    return new Broker({
      declarations: subset as CapabilityDeclarations,
      projectRoot: this.projectRoot,
      policy: this.policy,
      strict: true,
      observer: this.#observer.child(label),
    });
  }

  declarations(): CapabilityDeclarations {
    const copy: Record<string, unknown> = {};
    for (const kind of CAPABILITY_KINDS) {
      const declared = (this.#declarations as Record<string, unknown>)[kind];
      if (declared !== undefined) copy[kind] = Array.isArray(declared) ? [...declared] : declared;
    }
    return copy as CapabilityDeclarations;
  }

  diagnostics(): CapabilityDiagnostics {
    const declared: Record<string, readonly string[] | boolean> = {};
    for (const [key, value] of Object.entries(this.declarations())) {
      declared[key] = Array.isArray(value) ? [...value] : (value as boolean);
    }
    return {
      policy: this.policy,
      projectRoot: this.projectRoot,
      strict: this.#strict,
      declared,
      revoked: [...this.#revoked],
      usage: [...this.#usage.values()]
        .map((entry) => ({ ...entry }))
        .sort((a, b) => (a.capability + a.target < b.capability + b.target ? -1 : 1)),
    };
  }
}

export function createBroker(options: BrokerOptions): CapabilityBroker {
  return new Broker(options);
}
