/** Contract comun implementat de fiecare app de framework in browser. */
export interface BenchApp {
  /** Inlocuieste continutul cu `n` randuri noi (create rows). */
  run(n: number): void;
  /** Adauga `n` randuri la tabelul existent (append rows). */
  append(n: number): void;
  /** Actualizeaza eticheta fiecarui al 10-lea rand (partial update). */
  update(): void;
  /** Evidentiaza (className "danger") randul de la indexul dat. */
  select(index: number): void;
  /** Sterge randul de la indexul dat (remove row). */
  remove(index: number): void;
  /** Interschimba doua randuri (swap rows) — indecsi 1 si n-2. */
  swap(): void;
  /** Goleste tabelul. */
  clear(): void;
  /** Numarul de randuri montate (validare). */
  count(): number;
}

export type MountApp = (container: HTMLElement) => BenchApp;
