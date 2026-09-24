// Acelasi program, de data asta in TypeScript - cu tipuri, interfete, generice
// si asertiuni. Binarul nativ le elimina cu oxc si executa JavaScript-ul
// rezultat, fara Node instalat nicaieri.
import observe from "raptor:observe";
import { readText, list } from "raptor:files";
import capabilities from "raptor:capabilities";

interface Nota {
  readonly text: string;
  readonly lungime: number;
}

type Verdict = "permis" | "refuzat";

function primul<T>(lista: readonly T[]): T | null {
  return lista.length > 0 ? lista[0]! : null;
}

observe.log("info", "app.start", { limbaj: "typescript" });

const sursa: string = readText("./src/main.ts");
const note: Nota[] = [{ text: "prima", lungime: sursa.length }];

export const octetiCititi: number = note[0]!.lungime;
export const primaNota: string = primul(note)?.text ?? "(niciuna)";
export const fisiere: readonly string[] = list("./src") as string[];

let verdict: Verdict = "permis";
try {
  readText("../../package.json");
} catch {
  verdict = "refuzat";
}
export const inAfaraDomeniului: Verdict = verdict;
export const potScrie: boolean = capabilities.check("files.write", "./src/x").granted;

export default function main(): string {
  return "gata";
}
