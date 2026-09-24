/** Tipuri si generatoare de date comune pentru DOM benchmark. */

export interface BenchApp {
  /** Construieste `n` randuri de la zero. */
  create(rows: RowData[]): void;
  /** Inlocuieste eticheta fiecarui rand (worst case pentru VDOM). */
  updateAll(rows: RowData[]): void;
  /** Inlocuieste eticheta fiecarui al 10-lea rand (evidentiaza fine-grained). */
  updatePartial(rows: RowData[]): void;
  /** Goleste lista. */
  clear(): void;
  /** Numarul de randuri montate acum (pentru validare corectitudine). */
  count(): number;
  /** Prima eticheta montata (pentru validare corectitudine). */
  firstLabel(): string;
}

export interface RowData {
  id: number;
  label: string;
}

const ADJECTIVES = ["rapid", "compact", "reactiv", "binar", "atomic", "lazy", "fine", "exact"];
const NOUNS = ["signal", "nod", "effect", "delta", "frame", "opcode", "buffer", "raptor"];

let seq = 1;

export function buildRows(n: number): RowData[] {
  const rows: RowData[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      id: seq++,
      label: `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[(i * 7) % NOUNS.length]}`,
    };
  }
  return rows;
}

/** Regenereaza etichetele PASTRAND acelasi id (rand identic = update, nu re-creare). */
export function relabelAll(rows: RowData[]): RowData[] {
  return rows.map((r) => ({ id: r.id, label: `${r.label} !` }));
}

/** Schimba doar fiecare al 10-lea rand; restul raman referinta identica. */
export function relabelEvery10th(rows: RowData[]): RowData[] {
  return rows.map((r, i) => (i % 10 === 0 ? { id: r.id, label: `${r.label} #` } : r));
}
