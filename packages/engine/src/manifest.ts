/**
 * Build manifest (whitepaper RaptorEngine Appendix B + 21.2).
 *
 * Build-ul emite versiunile toolchain-ului, hashes, flags si provenance ca sa
 * fie reproducibil. Timestamp-urile non-deterministe NU intra in artifact hash.
 * Include si un scorecard de metrici (30: performance budgets ca teste).
 */
import { ENGINE_VERSION, COMPILER_VERSION } from "./cache.ts";

export interface BuildMetrics {
  /** Signals/deriveds eliminate de DSE (14.1). */
  eliminated: number;
  /** Deriveds fuzionate (14.2). */
  fused: number;
  /** Bindings DOM reactive generate. */
  domBindings: number;
  /** Componente in output. */
  components: number;
  /** Adrese RAS in manifestul wire. */
  wireAddresses: number;
}

export interface BuildManifest {
  engineVersion: string;
  compilerVersion: string;
  profile: string;
  target: string;
  inputsHash: string;
  /** Versiunile toolchain-ului low-level (lowlevel + rolldown/oxc daca exista). */
  toolchain: Record<string, string>;
  outputs: string[];
  routes: string[];
  /** Routes de preload (profile-guided, 22-24). */
  preload: string[];
  /** true daca s-au aplicat plan hints din profil (PGO). */
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
  /** Toolchain complet (lowlevel + rolldown/oxc). Daca lipseste, doar lowlevel. */
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
