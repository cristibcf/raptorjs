/**
 * The same application, a fifth time: as a command-line tool.
 *
 * It does not import `process` and does not write directly to the output. The
 * arguments, the streams, the terminal width and the questions all come through
 * `bridge` - so the tool can be run in tests without a terminal, and its behavior
 * is the same.
 *
 * The part worth looking at is `clear`: a destructive command that asks for
 * confirmation. Without an interactive terminal (CI, pipe, cron), the confirmation
 * cannot happen, and the tool **refuses and says how to run it**, instead of
 * assuming "yes" or crashing with a stack trace.
 */
import { state } from "raptorjs";
import type { HostBridge } from "@raptor/host";

export interface Note {
  readonly text: string;
}

export interface Cli {
  readonly notes: () => readonly Note[];
  /** Runs a single invocation and returns the exit code. */
  run(): Promise<number>;
}

const NOTES_KEY = "notes";

const USAGE = [
  "raptor-notes - notes, from the command line",
  "",
  "  raptor-notes list             show the notes",
  "  raptor-notes add <text>       add a note",
  "  raptor-notes clear [--yes]    delete all notes (asks for confirmation)",
  "",
  "  --help                        this text",
].join("\n");

export function createCli(bridge: HostBridge): Cli {
  const notes = state<readonly Note[]>([]);

  const write = async (text: string, stream: "out" | "err" = "out"): Promise<void> => {
    await bridge.call("cli.write", { stream, text: text.endsWith("\n") ? text : `${text}\n` });
  };

  const load = async (): Promise<void> => {
    const stored = await bridge.call<string | null>("storage.get", { key: NOTES_KEY });
    if (stored) notes.set(JSON.parse(stored) as Note[]);
  };

  const save = async (next: readonly Note[]): Promise<void> => {
    await bridge.call("storage.set", { key: NOTES_KEY, value: JSON.stringify(next) });
    notes.set(next);
  };

  return {
    notes: () => notes(),

    async run(): Promise<number> {
      const args = await bridge.call<string[]>("cli.args");
      const tty = await bridge.call<{ columns: number; interactive: boolean }>("tty.info");
      await load();

      const command = args.find((arg) => !arg.startsWith("-"));
      if (!command || args.includes("--help")) {
        await write(USAGE);
        return command ? 0 : 1;
      }

      if (command === "list") {
        if (notes().length === 0) {
          await write("no notes");
          return 0;
        }
        for (const [index, note] of notes().entries()) {
          // The width comes from the host, so the output lays out even in small terminals.
          const prefix = `${index + 1}. `;
          const room = Math.max(10, tty.columns - prefix.length);
          const text = note.text.length > room ? `${note.text.slice(0, room - 1)}…` : note.text;
          await write(prefix + text);
        }
        return 0;
      }

      if (command === "add") {
        const text = args.slice(args.indexOf("add") + 1).filter((arg) => !arg.startsWith("-")).join(" ").trim();
        if (!text) {
          await write("add requires a text", "err");
          return 2;
        }
        await save([...notes(), { text }]);
        await write(`added (${notes().length} notes)`);
        return 0;
      }

      if (command === "clear") {
        if (notes().length === 0) {
          await write("nothing to delete");
          return 0;
        }

        let confirmed = args.includes("--yes");
        if (!confirmed) {
          if (!bridge.allows("cli.confirm")) {
            await write("deleting requires confirmation, and the tool is not allowed to ask; run with --yes", "err");
            return 3;
          }
          try {
            const answer = await bridge.call<{ confirmed: boolean }>("cli.confirm", {
              question: `Delete ${notes().length} notes?`,
            });
            confirmed = answer.confirmed;
          } catch (error) {
            // The host's refusal (non-interactive terminal) is not a failure: it is
            // exactly the answer someone running from CI needs.
            if ((error as { code?: string }).code === "raptor:host/capability-unavailable") {
              await write("without an interactive terminal I cannot ask for confirmation; run with --yes", "err");
              return 3;
            }
            throw error;
          }
        }

        if (!confirmed) {
          await write("cancelled");
          return 0;
        }
        await save([]);
        await write("deleted");
        return 0;
      }

      await write(`unknown command: ${command}\n\n${USAGE}`, "err");
      return 2;
    },
  };
}
