/**
 * Configuratie RaptorEngine (whitepaper RaptorEngine sectiunea 34 + Appendix A).
 *
 * Defaults bune: fisierele de config separate se justifica doar pentru optiuni
 * care nu pot fi inferate din proiect. `defineConfig` e doar identitate tipata.
 */

export type BuildTarget = "web" | "server" | "edge";

/**
 * Profile de build (sectiunea 18). Nu ascund magie: sunt preseturi inspectabile
 * de strategii. Fiecare seteaza ce optimizari sunt prioritare.
 */
export const BuildProfile = {
  default: "default",
  realtime: "realtime",
  dashboard: "dashboard",
  content: "content",
  edge: "edge",
  embedded: "embedded",
} as const;

export type BuildProfileValue = (typeof BuildProfile)[keyof typeof BuildProfile];

export interface WireConfig {
  enabled: boolean;
  schemaMode: "strict" | "loose";
}

export interface DevConfig {
  statefulHmr: boolean;
}

export interface BuildConfig {
  sourcemap: boolean;
  report: boolean;
  /** Dezactiveaza Dependency Fusion (utila pentru debugging - vezi 14.2). */
  disableFusion: boolean;
}

export interface RaptorConfig {
  target: BuildTarget;
  profile: BuildProfileValue;
  server: { runtime: "node" | "bun" | "edge" };
  build: BuildConfig;
  wire: WireConfig;
  dev: DevConfig;
}

export const DEFAULT_CONFIG: RaptorConfig = {
  target: "web",
  profile: "default",
  server: { runtime: "node" },
  build: { sourcemap: true, report: true, disableFusion: false },
  wire: { enabled: true, schemaMode: "strict" },
  dev: { statefulHmr: true },
};

export type UserConfig = {
  target?: BuildTarget;
  profile?: BuildProfileValue;
  server?: { runtime?: "node" | "bun" | "edge" };
  build?: Partial<BuildConfig>;
  wire?: Partial<WireConfig>;
  dev?: Partial<DevConfig>;
};

/** Identitate tipata pentru raptor.config.ts (sectiunea 34). */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Combina configul utilizatorului peste defaults (deep merge la un nivel). */
export function resolveConfig(user: UserConfig = {}): RaptorConfig {
  return {
    target: user.target ?? DEFAULT_CONFIG.target,
    profile: user.profile ?? DEFAULT_CONFIG.profile,
    server: { runtime: user.server?.runtime ?? DEFAULT_CONFIG.server.runtime },
    build: { ...DEFAULT_CONFIG.build, ...user.build },
    wire: { ...DEFAULT_CONFIG.wire, ...user.wire },
    dev: { ...DEFAULT_CONFIG.dev, ...user.dev },
  };
}

/**
 * Prioritatile fiecarui profil (sectiunea 18). Influenteaza strategia, nu
 * semantica (24: adaptive strategies, nu adaptive correctness).
 */
export interface ProfileStrategy {
  /** Componentele care depind de wire merg intr-un chunk separat (worker-friendly). */
  isolateRealtime: boolean;
  /** Preload agresiv al chunk-ului critic. */
  aggressivePreload: boolean;
  /** Un singur chunk (SSR/content) vs. split per componenta. */
  singleChunk: boolean;
}

export function profileStrategy(profile: BuildProfileValue): ProfileStrategy {
  switch (profile) {
    case "realtime":
      return { isolateRealtime: true, aggressivePreload: false, singleChunk: false };
    case "dashboard":
      return { isolateRealtime: true, aggressivePreload: true, singleChunk: false };
    case "content":
      return { isolateRealtime: false, aggressivePreload: true, singleChunk: true };
    case "edge":
    case "embedded":
      return { isolateRealtime: false, aggressivePreload: false, singleChunk: true };
    default:
      return { isolateRealtime: false, aggressivePreload: false, singleChunk: true };
  }
}
