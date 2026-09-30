/**
 * The terminal, as an interface.
 *
 * As with the other adapters, the platform pieces are injected: the app does
 * not touch `process.stdout`, and the tests need no real terminal.
 *
 * The field that matters most here is `interactive`. A terminal without it
 * cannot answer questions - and that is not a convenience detail: a tool run
 * from CI that "assumes yes" on a destructive confirmation is exactly the kind
 * of behavior the contract must make impossible.
 */

export type Stream = "out" | "err";

export interface Terminal {
  /** The tool's arguments, without the interpreter's. */
  readonly args: readonly string[];
  write(stream: Stream, text: string): void;
  /** `false` when the output is redirected to a file or a pipe. */
  readonly isTTY: boolean;
  /** `false` when the input does not come from a human (CI, pipe, cron). */
  readonly interactive: boolean;
  readonly columns: number;
  /** Color support; `NO_COLOR` and the absence of a TTY turn it off. */
  readonly color: boolean;
  /** Reads a line from the user; absent if there is no input. */
  ask?(question: string): Promise<string>;
  /** Ctrl-C. The adapter translates it into an event, it does not stop the process. */
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
 * The real terminal, from a `process`.
 *
 * `args` skips the first two elements of `argv` (the interpreter and the
 * script), so the app receives exactly what the user typed.
 */
export function terminalFromProcess(proc: ProcessLike): Terminal {
  const isTTY = Boolean(proc.stdout.isTTY);
  const interactive = Boolean(proc.stdin.isTTY && proc.stdout.isTTY);
  // The `NO_COLOR` convention is honored by serious tools; we honor it too.
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
