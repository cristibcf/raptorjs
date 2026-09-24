/**
 * Normalizare si continere de cai, folosita de capability broker.
 *
 * Contine logica sensibila la securitate: continerea trebuie sa refuze
 * traversarea (`../`), sa nu confunde `/proiect-secret` cu `/proiect`, sa nu se
 * lase pacalita de o legatura simbolica, si sa trateze corect Windows
 * (separatori mixti, litera de disc, case-insensitive).
 *
 * **Doua niveluri, folosite in locuri diferite:**
 *
 *  - `containsPath` este pur **lexical** si nu atinge discul. Il folosim acolo
 *    unde raspunsul nu trebuie sa depinda de ce exista pe disc: diagnostice,
 *    teste, si prima treapta a verificarii reale.
 *  - `realPath` / `containsPathReal` **urmaresc legaturile simbolice**. Astea le
 *    foloseste capability broker-ul, fiindca altfel un symlink pus in domeniul
 *    acordat ar duce accesul in afara lui: `./date/link` ar trece verificarea si
 *    ar citi ce arata link-ul (S6 din `SECURITY-AUDIT.md`).
 *
 * Aceeasi impartire, cu aceleasi nume, in
 * `crates/raptor-runtime-core/src/paths.rs`.
 */
import { realpathSync } from "node:fs";
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

/**
 * `true` daca `target` este `scope` sau se afla strict sub el, **lexical**.
 *
 * Nu atinge discul, deci nu vede legaturile simbolice. Pentru o decizie de
 * securitate foloseste `containsPathReal`.
 */
export function containsPath(scope: string, target: string): boolean {
  const a = comparable(normalizePath(scope));
  const b = comparable(normalizePath(target));
  if (a === b) return true;
  const prefix = a.endsWith("/") ? a : a + "/";
  return b.startsWith(prefix);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  if (index < 0) return path;
  if (index === 0) return "/";
  // `C:/x` -> `C:/`, nu `C:`, care pe Windows inseamna altceva.
  return path[index - 1] === ":" ? path.slice(0, index + 1) : path.slice(0, index);
}

/**
 * Forma canonica a unei cai **dupa** rezolvarea legaturilor simbolice.
 *
 * `realpathSync` cere ca fisierul sa existe, iar brokerul trebuie sa poata
 * decide si despre un fisier care urmeaza sa fie creat (`files.write`). Deci
 * urcam pana la cel mai adanc parinte care CHIAR exista, il rezolvam pe acela,
 * si lipim inapoi segmentele ramase. O scriere in `./date/link/nou.txt` ajunge
 * astfel unde ajunge si `open`: prin link, nu pe langa el.
 *
 * Cand nimic din cale nu exista - sau cand sistemul refuza sa ne spuna -
 * ramanem la forma lexicala. Asta nu slabeste verificarea: o cale care nu
 * exista nu poate fi un symlink catre altundeva, iar daca apare intre timp, o
 * prinde `realPath` de la urmatorul acces.
 */
export function realPath(input: string): string {
  const normalized = normalizePath(input);
  const suffix: string[] = [];
  let current = normalized;

  for (;;) {
    try {
      const resolved = normalizePath(realpathSync(current));
      return suffix.length === 0 ? resolved : normalizePath(resolve(resolved, ...suffix.reverse()));
    } catch {
      const parent = parentOf(current);
      // Am ajuns la radacina fara sa gasim nimic existent: raspunsul lexical e
      // tot ce avem, si e corect ca atare.
      if (parent === current) return normalized;
      suffix.push(current.slice(parent.endsWith("/") ? parent.length : parent.length + 1));
      current = parent;
    }
  }
}

/**
 * `true` daca `target` este `scope` sau se afla strict sub el, **cu legaturile
 * simbolice rezolvate de ambele parti**.
 *
 * Domeniul se rezolva si el, nu doar tinta: pe macOS `/tmp` este un link catre
 * `/private/tmp`, deci o comparatie intre un domeniu nerezolvat si o tinta
 * rezolvata ar refuza accesul in propriul director.
 *
 * **Cursa TOCTOU ramane, si trebuie spusa:** intre verificarea de aici si
 * `open`-ul propriu-zis, cineva care poate scrie in domeniu poate inlocui un
 * director cu o legatura. Inchiderea completa cere `openat2(RESOLVE_BENEATH)`
 * pe Linux sau echivalentul lui, la care Node nu da acces. Ce se inchide aici e
 * cazul real: un link **deja prezent** in domeniu nu mai scoate accesul afara.
 */
export function containsPathReal(scope: string, target: string): boolean {
  return containsPath(realPath(scope), realPath(target));
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
