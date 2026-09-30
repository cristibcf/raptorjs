/**
 * RaptorEngine configuration (RaptorEngine whitepaper section 34 + Appendix A).
 *
 * Good defaults: separate config files are only justified for options that
 * cannot be inferred from the project. `defineConfig` is just a typed identity.
 */

export type BuildTarget = "web" | "server" | "edge";

/**
 * Build profiles (section 18). No hidden magic: they are inspectable presets
 * of strategies. Each one sets which optimizations take priority.
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
  /** Disables Dependency Fusion (useful for debugging - see 14.2). */
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

/** Typed identity for raptor.config.ts (section 34). */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Merges the user config over the defaults (one-level deep merge). */
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
 * The priorities of each profile (section 18). They influence the strategy, not
 * the semantics (24: adaptive strategies, not adaptive correctness).
 */
export interface ProfileStrategy {
  /** Components that depend on wire go into a separate chunk (worker-friendly). */
  isolateRealtime: boolean;
  /** Aggressive preload of the critical chunk. */
  aggressivePreload: boolean;
  /** A single chunk (SSR/content) vs. split per component. */
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
