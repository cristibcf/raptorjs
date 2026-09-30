/**
 * Capability broker (spec sections 5 and 7): security is a product feature,
 * not an optional wrapper.
 *
 * Rules implemented here:
 *  - everything is denied by default, except `clock.real` / `crypto.random`,
 *    which are allowed but annotated in the trace;
 *  - granularity is per target (path, host:port, variable, command);
 *  - grants are revocable at runtime;
 *  - delegation to a child worker/isolate happens only explicitly, through a
 *    declared subset - not through ambient inheritance;
 *  - every check (allowed or denied) enters the diagnostics.
 */
import { CapabilityError } from "./errors.ts";
import type { CapabilityDeclarations, CapabilityKind, PolicyMode } from "./manifest.ts";
import { CAPABILITY_KINDS } from "./manifest.ts";
import type { Observer } from "./observe.ts";
import { silentObserver } from "./observe.ts";
import { containsPath, normalizePath, realPath, resolvePath } from "./paths.ts";

/** Ambient capabilities: boolean, no target. */
export const AMBIENT_KINDS: readonly CapabilityKind[] = ["clock.real", "crypto.random"];

export interface CapabilityDecision {
  readonly granted: boolean;
  readonly capability: CapabilityKind;
  readonly target: string;
  readonly reason: string;
  /** The manifest rule that decided; useful in `doctor` and in errors. */
  readonly rule: string | null;
  /** Access is allowed, but must be marked in the trace (implicit clock/crypto). */
  readonly annotated: boolean;
  /**
   * Where the path actually lands, when it differs from the one requested - that
   * is, when there is a symlink along the way. `null` otherwise.
   *
   * A log that shows only `./data/link` and not `/etc/shadow` tells the truth
   * and yet misleads whoever reads it.
   */
  readonly resolved: string | null;
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
  /** `true` if no implicit scope applies. */
  readonly strict: boolean;
  check(capability: CapabilityKind, target?: string): CapabilityDecision;
  /** Like `check`, but throws `CapabilityError` if access is denied. */
  require(capability: CapabilityKind, target?: string): CapabilityDecision;
  revoke(capability: CapabilityKind): void;
  /** Sub-broker with an explicit subset; nothing is inherited implicitly. */
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
   * In strict mode there are no implicit scopes: absolutely all access must be
   * declared in the manifest. The production policy enables it (spec section 7).
   */
  readonly strict?: boolean;
}

/** A separator that cannot appear in a capability name or in a target. */
const SEPARATOR = String.fromCharCode(0);

function ruleTargets(declarations: CapabilityDeclarations, capability: CapabilityKind): string[] {
  const value = (declarations as Record<string, unknown>)[capability];
  return Array.isArray(value) ? (value as string[]) : [];
}

/**
 * `./src` is resolved relative to the project root; absolute paths stay as is.
 *
 * `target` arrives **already with links resolved** (see `check`): otherwise we
 * would resolve it once per manifest rule, with the same system calls every
 * time. The scope is resolved here, because it differs from one rule to another.
 */
function matchRealPath(rule: string, projectRoot: string, realTarget: string): boolean {
  return containsPath(realPath(resolvePath(projectRoot, rule)), realTarget);
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

  /**
   * `target` is what the application requested (after normalization), `realTarget`
   * is where it lands with links resolved. Decisions carry the former - it is what
   * whoever reads the log recognizes - but are made on the latter.
   */
  #decide(capability: CapabilityKind, target: string, realTarget: string): CapabilityDecision {
    if (this.#revoked.has(capability)) {
      return { granted: false, capability, target, reason: "capability revoked at runtime", rule: null, annotated: false, resolved: null };
    }

    if (AMBIENT_KINDS.includes(capability)) {
      const declared = (this.#declarations as Record<string, unknown>)[capability];
      if (declared === false) {
        return { granted: false, capability, target, reason: "explicitly disabled in the manifest", rule: `${capability}: false`, annotated: false, resolved: null };
      }
      // Implicitly allowed, but marked in the trace (spec section 7).
      return {
        granted: true,
        capability,
        target,
        reason: declared === true ? "declared in the manifest" : "implicitly allowed, annotated in the trace",
        rule: declared === true ? `${capability}: true` : null,
        annotated: declared !== true,
        resolved: null,
      };
    }

    const rules = ruleTargets(this.#declarations, capability);
    if (rules.length === 0) {
      // Spec section 7: file reads are "denied outside the project".
      // Without a declaration, the implicit scope is exactly the project root; any
      // manifest that declares `files.read` fully replaces this default.
      if (!this.#strict && capability === "files.read" && containsPath(realPath(this.projectRoot), realTarget)) {
        return {
          granted: true,
          capability,
          target,
          reason: "inside the project root (implicit scope)",
          rule: "(implicit: project root)",
          annotated: true,
          resolved: null,
        };
      }
      return { granted: false, capability, target, reason: "not declared in the manifest", rule: null, annotated: false, resolved: null };
    }

    for (const rule of rules) {
      const hit =
        capability === "files.read" || capability === "files.write"
          ? matchRealPath(rule, this.projectRoot, realTarget)
          : capability === "net.connect" || capability === "net.listen"
            ? matchHost(rule, target)
            : matchName(rule, target);
      if (hit) {
        return { granted: true, capability, target, reason: "covered by a declared rule", rule, annotated: false, resolved: null };
      }
    }

    return {
      granted: false,
      capability,
      target,
      reason: `outside the declared scope (${rules.join(", ")})`,
      rule: null,
      annotated: false,
      resolved: null,
    };
  }

  check(capability: CapabilityKind, target = ""): CapabilityDecision {
    const isPath = capability === "files.read" || capability === "files.write";
    const normalized = isPath ? resolvePath(this.projectRoot, target) : target;
    // A single resolution per check, however many rules the manifest has.
    const real = isPath ? realPath(normalized) : normalized;
    const decided = this.#decide(capability, normalized, real);

    // The real path enters the decision only when it differs - otherwise we would
    // fill the diagnostics with repetitions of the same string.
    const decision: CapabilityDecision = real === normalized ? decided : { ...decided, resolved: real };

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
        resolved: decision.resolved,
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
    // Ambient capabilities do not propagate implicitly: if not requested, the child loses them.
    for (const ambient of AMBIENT_KINDS) {
      if (!capabilities.includes(ambient)) subset[ambient] = false;
    }
    this.#observer.log("info", "capability.delegated", { label, capabilities: [...capabilities] });
    // A delegated broker is strict by construction, even if the parent is not:
    // the requested subset stays the only source of access. Otherwise the implicit
    // scope (project root on read) would reappear in the child and would bypass
    // both the delegated list and a capability revoked before delegation.
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
