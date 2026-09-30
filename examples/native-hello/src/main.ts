// The same program, this time in TypeScript - with types, interfaces, generics
// and assertions. The native binary strips them out with oxc and runs the
// resulting JavaScript, with no Node installed anywhere.
import observe from "raptor:observe";
import { readText, list } from "raptor:files";
import capabilities from "raptor:capabilities";

interface Nota {
  readonly text: string;
  readonly lungime: number;
}

type Verdict = "allowed" | "denied";

function primul<T>(lista: readonly T[]): T | null {
  return lista.length > 0 ? lista[0]! : null;
}

observe.log("info", "app.start", { limbaj: "typescript" });

const sursa: string = readText("./src/main.ts");
const note: Nota[] = [{ text: "first", lungime: sursa.length }];

export const octetiCititi: number = note[0]!.lungime;
export const primaNota: string = primul(note)?.text ?? "(none)";
export const fisiere: readonly string[] = list("./src") as string[];

let verdict: Verdict = "allowed";
try {
  readText("../../package.json");
} catch {
  verdict = "denied";
}
export const inAfaraDomeniului: Verdict = verdict;
export const potScrie: boolean = capabilities.check("files.write", "./src/x").granted;

export default function main(): string {
  return "done";
}
