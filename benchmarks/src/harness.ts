/**
 * Harness de masurare pentru benchmark-uri comparative.
 *
 * De ce exista: masuratorile facute cu mediana, pe variante rulate una dupa
 * alta, s-au dovedit nefolosibile pe o masina incarcata - acelasi cod a dat
 * intre 151 si 352 ms in aceeasi sesiune. Un decalaj de 40% raportat asa nu
 * spune nimic despre cod, doar despre ce mai rula in fundal.
 *
 * Trei decizii care fac diferenta:
 *
 * 1. **Estimator = minimul, nu mediana.** Zgomotul (GC de la alt proces,
 *    preemptie, throttling termic) doar *adauga* timp; nu scade niciodata.
 *    Deci cea mai rapida rulare observata este cea mai buna aproximare a
 *    costului real al codului. Mediana amesteca semnal cu interferenta.
 *
 * 2. **Rulari intercalate cu rotatie.** Daca masori tot A, apoi tot B, o
 *    schimbare de incarcare intre ele arata exact ca o diferenta de
 *    performanta. Rulam A,B,C / B,C,A / C,A,B ... deci fiecare varianta
 *    prinde in medie acelasi zgomot si aceeasi pozitie in runda.
 *
 * 3. **Poarta de stabilitate.** Impartim rundele in doua jumatati si comparam
 *    minimul fiecareia. Daca difera cu mai mult de `maxDriftPct`, mediul s-a
 *    schimbat in timpul masuratorii si rezultatul este marcat INSTABIL. Un
 *    numar instabil nu se raporteaza si nu se compara - se rearunca.
 */

export interface Variant<T> {
  readonly label: string;
  /** Construieste o instanta noua pentru fiecare runda (fara stare reportata). */
  readonly build: () => T;
}

export interface CompareOptions {
  /** Cate runde intercalate. Mai multe = estimator mai bun al minimului. */
  readonly rounds?: number;
  /** Iteratii cronometrate intr-o runda. */
  readonly iterations?: number;
  /** Iteratii de incalzire inainte de cronometru (JIT + forme stabilizate). */
  readonly warmup?: number;
  /** Drift maxim acceptat intre minimele celor doua jumatati de rulare (%). */
  readonly maxDriftPct?: number;
}

export interface VariantStats {
  readonly label: string;
  readonly minMs: number;
  readonly medianMs: number;
  readonly maxMs: number;
  /** (max - min) / min, in procente: cat de zgomotos a fost mediul. */
  readonly spreadPct: number;
  /** Drift intre minimul primei jumatati si al celei de-a doua, in procente. */
  readonly driftPct: number;
  readonly stable: boolean;
  readonly samples: readonly number[];
  /** Valoarea de verificare a corectitudinii, daca `work` a intors una. */
  readonly checksum: number | undefined;
}

export interface CompareResult {
  readonly variants: readonly VariantStats[];
  /** true doar daca fiecare varianta a trecut poarta de stabilitate. */
  readonly stable: boolean;
  /** true daca toate variantele au produs acelasi checksum. */
  readonly checksumsAgree: boolean;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const min = (values: readonly number[]): number => values.reduce((a, b) => (b < a ? b : a), Infinity);

/**
 * Cronometreaza `work` pe o instanta proaspata, de `rounds` ori, intercalat cu
 * celelalte variante. `work` primeste instanta si numarul iteratiei si poate
 * intoarce un numar care se acumuleaza intr-un checksum - daca doua variante
 * calculeaza acelasi lucru, checksum-urile trebuie sa fie identice.
 */
export function compare<T>(
  variants: readonly Variant<T>[],
  work: (instance: T, i: number) => number | void,
  options: CompareOptions = {},
): CompareResult {
  const rounds = options.rounds ?? 15;
  const iterations = options.iterations ?? 40_000;
  const warmup = options.warmup ?? 2_000;
  const maxDriftPct = options.maxDriftPct ?? 8;

  const times = new Map<string, number[]>(variants.map((v) => [v.label, []]));
  const checksums = new Map<string, number>();

  for (let round = 0; round < rounds; round++) {
    // Rotatie: fiecare varianta ocupa pe rand fiecare pozitie din runda, deci
    // nicio varianta nu plateste sistematic costul de "prima dupa GC".
    for (let k = 0; k < variants.length; k++) {
      const variant = variants[(round + k) % variants.length]!;
      const instance = variant.build();

      let acc = 0;
      for (let i = 0; i < warmup; i++) acc += (work(instance, i) as number) || 0;

      const started = performance.now();
      for (let i = 0; i < iterations; i++) acc += (work(instance, i) as number) || 0;
      const elapsed = performance.now() - started;

      times.get(variant.label)!.push(elapsed);
      checksums.set(variant.label, acc);
    }
  }

  const stats: VariantStats[] = variants.map((variant) => {
    const samples = times.get(variant.label)!;
    const half = samples.length >> 1;
    const firstHalf = min(samples.slice(0, half));
    const secondHalf = min(samples.slice(half));
    const driftPct = (Math.abs(secondHalf - firstHalf) / Math.min(firstHalf, secondHalf)) * 100;
    const lo = min(samples);
    const hi = Math.max(...samples);
    return {
      label: variant.label,
      minMs: lo,
      medianMs: median(samples),
      maxMs: hi,
      spreadPct: ((hi - lo) / lo) * 100,
      driftPct,
      stable: driftPct <= maxDriftPct,
      samples,
      checksum: checksums.get(variant.label),
    };
  });

  const seen = new Set(stats.map((s) => s.checksum));
  return {
    variants: stats,
    stable: stats.every((s) => s.stable),
    checksumsAgree: seen.size === 1,
  };
}

/** Tipareste un raport care spune raspicat cand rezultatul NU e de incredere. */
export function report(result: CompareResult, opsPerIteration?: number): void {
  const fastest = min(result.variants.map((v) => v.minMs));

  console.log("");
  console.log(
    "varianta".padEnd(18) +
      "min".padStart(10) +
      "mediana".padStart(11) +
      "spread".padStart(10) +
      "drift".padStart(9) +
      "  relativ",
  );
  console.log("-".repeat(72));
  for (const v of result.variants) {
    const relative = v.minMs / fastest;
    console.log(
      v.label.padEnd(18) +
        `${v.minMs.toFixed(1)} ms`.padStart(10) +
        `${v.medianMs.toFixed(1)} ms`.padStart(11) +
        `${v.spreadPct.toFixed(0)}%`.padStart(10) +
        `${v.driftPct.toFixed(1)}%`.padStart(9) +
        "  " +
        (relative === 1 ? "1.00x (cel mai rapid)" : `${relative.toFixed(2)}x`) +
        (v.stable ? "" : "   <-- INSTABIL"),
    );
  }

  if (opsPerIteration !== undefined) {
    console.log("");
    for (const v of result.variants) {
      const perOp = (v.minMs * 1e6) / (40_000 * opsPerIteration);
      console.log(`  ${v.label.padEnd(16)} ${perOp.toFixed(1).padStart(6)} ns / operatie`);
    }
  }

  console.log("");
  if (!result.checksumsAgree) {
    console.log("EROARE: variantele NU au calculat acelasi lucru - comparatia e invalida.");
  }
  if (!result.stable) {
    console.log(
      "REZULTAT INSTABIL: mediul s-a schimbat in timpul masuratorii (drift peste prag).\n" +
        "Inchide ce ruleaza in fundal si reia. Nu trage concluzii din cifrele de mai sus.",
    );
  } else {
    console.log("Stabil: driftul intre jumatatile rularii este sub prag; cifrele sunt comparabile.");
  }
}
