/**
 * Aceeasi aplicatie, a cincea oara: ca unealta de linie de comanda.
 *
 * Nu importa `process` si nu scrie direct la iesire. Argumentele, fluxurile,
 * latimea terminalului si intrebarile vin toate prin `bridge` - deci unealta
 * poate fi rulata in teste fara terminal, iar comportamentul ei este acelasi.
 *
 * Partea care merita privita este `clear`: o comanda distructiva care cere
 * confirmare. Fara terminal interactiv (CI, pipe, cron), confirmarea nu poate
 * avea loc, iar unealta **refuza si spune cum sa fie rulata**, in loc sa
 * presupuna "da" sau sa crape cu o stiva.
 */
import { state } from "@raptor/core";
import type { HostBridge } from "@raptor/host";

export interface Note {
  readonly text: string;
}

export interface Cli {
  readonly notes: () => readonly Note[];
  /** Ruleaza o singura invocare si intoarce codul de iesire. */
  run(): Promise<number>;
}

const NOTES_KEY = "notes";

const USAGE = [
  "raptor-notes - note, din linia de comanda",
  "",
  "  raptor-notes list             arata notele",
  "  raptor-notes add <text>       adauga o nota",
  "  raptor-notes clear [--yes]    sterge toate notele (cere confirmare)",
  "",
  "  --help                        acest text",
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
          await write("nicio nota");
          return 0;
        }
        for (const [index, note] of notes().entries()) {
          // Latimea vine de la host, deci iesirea se aseaza si in terminale mici.
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
          await write("add cere un text", "err");
          return 2;
        }
        await save([...notes(), { text }]);
        await write(`adaugat (${notes().length} note)`);
        return 0;
      }

      if (command === "clear") {
        if (notes().length === 0) {
          await write("nimic de sters");
          return 0;
        }

        let confirmed = args.includes("--yes");
        if (!confirmed) {
          if (!bridge.allows("cli.confirm")) {
            await write("stergerea cere confirmare, iar unealta nu are voie sa intrebe; ruleaza cu --yes", "err");
            return 3;
          }
          try {
            const answer = await bridge.call<{ confirmed: boolean }>("cli.confirm", {
              question: `Sterg ${notes().length} note?`,
            });
            confirmed = answer.confirmed;
          } catch (error) {
            // Refuzul host-ului (terminal neinteractiv) nu este o avarie: este
            // exact raspunsul de care are nevoie cineva care ruleaza din CI.
            if ((error as { code?: string }).code === "raptor:host/capability-unavailable") {
              await write("fara terminal interactiv nu pot cere confirmare; ruleaza cu --yes", "err");
              return 3;
            }
            throw error;
          }
        }

        if (!confirmed) {
          await write("anulat");
          return 0;
        }
        await save([]);
        await write("sters");
        return 0;
      }

      await write(`comanda necunoscuta: ${command}\n\n${USAGE}`, "err");
      return 2;
    },
  };
}
