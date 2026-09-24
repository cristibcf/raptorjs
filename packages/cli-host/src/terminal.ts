/**
 * Terminalul, ca interfata.
 *
 * Ca si la celelalte adaptoare, bucatile de platforma se injecteaza: aplicatia
 * nu atinge `process.stdout`, iar testele nu au nevoie de un terminal real.
 *
 * Campul care conteaza cel mai mult aici este `interactive`. Un terminal fara
 * el nu poate raspunde la intrebari - iar asta nu este un detaliu de comoditate:
 * o unealta rulata din CI care "presupune da" la o confirmare distructiva este
 * exact felul de comportament pe care contractul trebuie sa il faca imposibil.
 */

export type Stream = "out" | "err";

export interface Terminal {
  /** Argumentele uneltei, fara cele ale interpretorului. */
  readonly args: readonly string[];
  write(stream: Stream, text: string): void;
  /** `false` cand iesirea este redirectata catre un fisier sau un pipe. */
  readonly isTTY: boolean;
  /** `false` cand intrarea nu vine de la un om (CI, pipe, cron). */
  readonly interactive: boolean;
  readonly columns: number;
  /** Suport de culoare; `NO_COLOR` si lipsa de TTY il sting. */
  readonly color: boolean;
  /** Citeste o linie de la utilizator; lipseste daca nu exista intrare. */
  ask?(question: string): Promise<string>;
  /** Ctrl-C. Adaptorul il traduce in eveniment, nu opreste procesul. */
  onInterrupt?(listener: () => void): void;
}

export interface ProcessLike {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown; isTTY?: boolean; columns?: number };
  readonly stderr: { write(text: string): unknown; isTTY?: boolean };
  readonly stdin: { isTTY?: boolean };
  on(event: string, listener: () => void): unknown;
}

/**
 * Terminalul real, dintr-un `process`.
 *
 * `args` sare peste primele doua elemente din `argv` (interpretorul si scriptul),
 * ca aplicatia sa primeasca exact ce a scris utilizatorul.
 */
export function terminalFromProcess(proc: ProcessLike): Terminal {
  const isTTY = Boolean(proc.stdout.isTTY);
  const interactive = Boolean(proc.stdin.isTTY && proc.stdout.isTTY);
  // Conventia `NO_COLOR` este respectata de unelte serioase; o respectam si noi.
  const color = isTTY && !proc.env["NO_COLOR"];

  const terminal: Record<string, unknown> = {
    args: proc.argv.slice(2),
    isTTY,
    interactive,
    columns: proc.stdout.columns ?? 80,
    color,
    write(stream: Stream, text: string): void {
      (stream === "err" ? proc.stderr : proc.stdout).write(text);
    },
    onInterrupt(listener: () => void): void {
      proc.on("SIGINT", listener);
    },
  };

  if (interactive) {
    terminal["ask"] = async (question: string): Promise<string> => {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({
        input: proc.stdin as unknown as NodeJS.ReadableStream,
        output: proc.stdout as unknown as NodeJS.WritableStream,
      });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    };
  }

  return terminal as unknown as Terminal;
}
