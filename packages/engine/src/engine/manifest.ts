/**
 * Build manifest (RaptorEngine whitepaper Appendix B + 21.2).
 *
 * The build emits the toolchain versions, hashes, flags and provenance so it
 * is reproducible. Non-deterministic timestamps do NOT enter the artifact hash.
 * It also includes a metrics scorecard (30: performance budgets as tests).
 */
import { ENGINE_VERSION, COMPILER_VERSION } from "./cache.ts";

export interface BuildMetrics {
  /** Signals/deriveds eliminated by DSE (14.1). */
  eliminated: number;
  /** Deriveds fused (14.2). */
  fused: number;
  /** Reactive DOM bindings generated. */
  domBindings: number;
  /** Components in the output. */
  components: number;
  /** RAS addresses in the wire manifest. */
  wireAddresses: number;
}

export interface BuildManifest {
  engineVersion: string;
  compilerVersion: string;
  profile: string;
  target: string;
  inputsHash: string;
  /** The low-level toolchain versions (lowlevel + rolldown/oxc if present). */
  toolchain: Record<string, string>;
  outputs: string[];
  routes: string[];
  /** Preload routes (profile-guided, 22-24). */
  preload: string[];
  /** true if plan hints from the profile were applied (PGO). */
  hintsApplied: boolean;
  wireSchemas: string[];
  rasManifest: string;
  reproducible: boolean;
  metrics: BuildMetrics;
}

export interface ManifestInputs {
  profile: string;
  target: string;
  inputsHash: string;
  lowlevel: string;
  outputs: string[];
  wireSchemas: string[];
  metrics: BuildMetrics;
  preload?: string[];
  hintsApplied?: boolean;
  /** Full toolchain (lowlevel + rolldown/oxc). If missing, lowlevel only. */
  toolchain?: Record<string, string>;
}

export function buildManifest(inputs: ManifestInputs): BuildManifest {
  return {
    engineVersion: ENGINE_VERSION,
    compilerVersion: COMPILER_VERSION,
    profile: inputs.profile,
    target: inputs.target,
    inputsHash: inputs.inputsHash,
    toolchain: inputs.toolchain ?? { lowlevel: inputs.lowlevel },
    outputs: inputs.outputs,
    routes: [],
    preload: inputs.preload ?? [],
    hintsApplied: inputs.hintsApplied ?? false,
    wireSchemas: inputs.wireSchemas,
    rasManifest: "ras.manifest",
    reproducible: true,
    metrics: inputs.metrics,
  };
}
