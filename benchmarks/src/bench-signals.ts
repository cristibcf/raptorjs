/**
 * Microbenchmark de reactivitate: RaptorJS vs @preact/signals-core.
 *
 * Construim acelasi graf de dependente pentru fiecare librarie:
 *   1 sursa -> WIDTH lanturi paralele de derived, fiecare de adancime DEPTH.
 * Apoi, per iteratie: update pe sursa + citirea (pull) a celor WIDTH cozi,
 * insumate intr-un checksum. Model pull, complet sincron => comparabil identic
 * pentru ambele sisteme de memo lazy. Fiecare update invalideaza tot graful.
 *
 * Masuratoarea trece prin `harness.ts`: rulari intercalate, estimator = minim,
 * si o poarta de stabilitate care marcheaza rezultatul ca nefolosibil cand
 * mediul s-a schimbat in timpul rularii. Vezi comentariul din harness pentru de ce.
 *
 * Nota: Solid NU e inclus aici. Modelul lui e push/eager, iar effect-urile lui
 * au nevoie de scheduler-ul din runtime-ul solid-js/web; intr-un mediu Node bare
 * memo-urile lui nu recomputeaza la pull fara observer, deci orice numar ar fi
 * inselator intr-un harness headless.
 */
import { state, derived, createRoot } from "../../packages/core/src/index.ts";
import { signal as pSignal, computed as pComputed } from "@preact/signals-core";
import { compare, report, type Variant } from "./harness.ts";

const WIDTH = 8;
const DEPTH = 10;
const ITER = 40_000;
/** Recalculari asteptate pe iteratie - fiecare update invalideaza tot graful. */
const RECOMPUTES_PER_ITER = WIDTH * DEPTH;

export interface SignalResult {
  library: string;
  updatesPerSec: number;
  totalMs: number;
  checksum: number;
  /** false = mediul a fost prea zgomotos, cifra nu trebuie raportata. */
  stable: boolean;
}

interface Graph {
  update(i: number): void;
  read(): number;
}

/** Construieste WIDTH lanturi de accesori, fiecare de adancime DEPTH. */
function buildChains(
  seed: (w: number) => () => number,
  link: (prev: () => number) => () => number,
): Array<() => number> {
  const tails: Array<() => number> = [];
  for (let w = 0; w < WIDTH; w++) {
    let node = seed(w);
    for (let d = 1; d < DEPTH; d++) node = link(node);
    tails.push(node);
  }
  return tails;
}

function sumTails(tails: Array<() => number>): number {
  let sum = 0;
  for (const t of tails) sum += t();
  return sum;
}

// --- RaptorJS --------------------------------------------------------------
function buildRaptor(): Graph {
  let setSrc!: (v: number) => void;
  let tails!: Array<() => number>;
  createRoot(() => {
    const s = state(0);
    setSrc = (v) => s.set(v);
    tails = buildChains(
      (w) => derived(() => s() + w),
      (prev) => derived(() => prev() + 1),
    );
  });
  return { update: setSrc, read: () => sumTails(tails) };
}

// --- @preact/signals-core --------------------------------------------------
function buildPreactSignals(): Graph {
  const s = pSignal(0);
  const tails = buildChains(
    (w) => {
      const c = pComputed(() => s.value + w);
      return () => c.value;
    },
    (prev) => {
      const c = pComputed(() => prev() + 1);
      return () => c.value;
    },
  );
  return { update: (v) => (s.value = v), read: () => sumTails(tails) };
}

const VARIANTS: ReadonlyArray<Variant<Graph>> = [
  { label: "RaptorJS", build: buildRaptor },
  { label: "@preact/signals", build: buildPreactSignals },
];

export function runSignalBench(): SignalResult[] {
  const result = compare<Graph>(
    VARIANTS,
    (g, i) => {
      g.update(i);
      return g.read();
    },
    { iterations: ITER, rounds: 15, warmup: 2_000 },
  );

  if (!result.checksumsAgree) {
    throw new Error("[bench-signals] variantele nu au calculat acelasi graf");
  }

  return result.variants.map((v) => ({
    library: v.label,
    updatesPerSec: (ITER / v.minMs) * 1000,
    totalMs: v.minMs,
    checksum: v.checksum ?? 0,
    stable: v.stable,
  }));
}

// Rulare standalone.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("bench-signals.ts")) {
  console.log(`\nSignals graph: WIDTH=${WIDTH} DEPTH=${DEPTH} ITER=${ITER.toLocaleString()}`);
  console.log(`Estimator: minimul din 15 rulari intercalate (vezi harness.ts).`);

  const result = compare<Graph>(
    VARIANTS,
    (g, i) => {
      g.update(i);
      return g.read();
    },
    { iterations: ITER, rounds: 15, warmup: 2_000 },
  );
  report(result, RECOMPUTES_PER_ITER);

  console.log("");
  for (const v of result.variants) {
    const ups = Math.round((ITER / v.minMs) * 1000);
    console.log(`  ${v.label.padEnd(18)} ${ups.toLocaleString().padStart(12)} upd/s`);
  }
}
