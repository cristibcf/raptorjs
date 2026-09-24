/**
 * Normalizare si continere de cai, folosita de capability broker.
 *
 * Contine logica sensibila la securitate: `containsPath` trebuie sa refuze
 * traversarea (`../`), sa nu confunde `/proiect-secret` cu `/proiect`, si sa
 * trateze corect Windows (separatori mixti, litera de disc, case-insensitive).
 */
import { isAbsolute, resolve, sep } from "node:path";

const WINDOWS = sep === "\\";

/** `C:/` pe Windows, `/` in rest: punctul in care urcarea in arbore se opreste. */
function isFilesystemRoot(path: string): boolean {
  return path === "/" || /^[A-Za-z]:\/$/.test(path);
}

/**
 * Forma canonica: separatori `/`, fara slash final, disc majuscul pe Windows.
 *
 * Radacinile isi pastreaza slash-ul final. Fara el, `C:/` ar deveni `C:`, care
 * pe Windows inseamna "directorul curent al discului C" - iar o cautare care
 * urca in arbore (`loadProject`) ar sari inapoi in directorul curent si ar cicla
 * la nesfarsit in loc sa se opreasca la radacina.
 */
export function normalizePath(input: string): string {
  const absolute = resolve(input).split("\\").join("/");
  const trimmed = absolute.length > 1 && absolute.endsWith("/") && !isFilesystemRoot(absolute) ? absolute.slice(0, -1) : absolute;
  if (WINDOWS && /^[a-z]:/.test(trimmed)) return trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return trimmed;
}

/** Rezolva `target` fata de `base` (caile absolute raman neschimbate). */
export function resolvePath(base: string, target: string): string {
  if (!target) return normalizePath(base);
  return isAbsolute(target) ? normalizePath(target) : normalizePath(resolve(base, target));
}

function comparable(path: string): string {
  return WINDOWS ? path.toLowerCase() : path;
}

/** `true` daca `target` este `scope` sau se afla strict sub el. */
export function containsPath(scope: string, target: string): boolean {
  const a = comparable(normalizePath(scope));
  const b = comparable(normalizePath(target));
  if (a === b) return true;
  const prefix = a.endsWith("/") ? a : a + "/";
  return b.startsWith(prefix);
}

/** Cale relativa la radacina proiectului, pentru diagnostice lizibile. */
export function relativeToRoot(root: string, target: string): string {
  const a = normalizePath(root);
  const b = normalizePath(target);
  if (!containsPath(a, b)) return b;
  if (a === b) return ".";
  // O radacina se termina deja cu `/`; orice alt domeniu are nevoie de separator.
  return "./" + b.slice(a.endsWith("/") ? a.length : a.length + 1);
}
