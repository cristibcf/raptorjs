/**
 * Bump-ul de versiune pentru cele 6 pachete publicate, in lockstep.
 *
 * Se publica impreuna (`pnpm -r ... publish`), deci poarta aceeasi versiune.
 * `workspace:*` intre ele e rescris de pnpm la publish, deci NU e nevoie sa
 * atingem dependentele - doar campul `version` din fiecare manifest.
 *
 *   node tools/bump.ts patch     # 0.1.0 -> 0.1.1
 *   node tools/bump.ts minor     # 0.1.0 -> 0.2.0
 *   node tools/bump.ts major     # 0.1.0 -> 1.0.0
 *   node tools/bump.ts 0.3.0     # versiune explicita
 *   node tools/bump.ts patch --dry   # doar arata, nu scrie
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Folderele celor 6 pachete publicate (directoarele, nu numele scoped). */
const PACKAGES = ["raptorjs", "wire", "engine", "runtime", "host", "test"];

interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Sufixul de prerelease, ex. `-alpha.1`, sau `""`. */
  pre: string;
}

function parse(version: string): Semver {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`versiune invalida: '${version}'`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? "" };
}

function bump(current: Semver, kind: string): string {
  switch (kind) {
    case "major":
      return `${current.major + 1}.0.0`;
    case "minor":
      return `${current.major}.${current.minor + 1}.0`;
    case "patch":
      // De pe un prerelease, un `patch` doar scoate sufixul (0.1.0-alpha -> 0.1.0).
      return current.pre ? `${current.major}.${current.minor}.${current.patch}` : `${current.major}.${current.minor}.${current.patch + 1}`;
    default:
      // Versiune explicita: se valideaza ca semver.
      parse(kind);
      return kind;
  }
}

function manifestPath(pkg: string): string {
  return join(ROOT, "packages", pkg, "package.json");
}

/** Citeste versiunile curente; toate trebuie sa fie egale (altfel s-au desincronizat). */
function readVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const manifest = JSON.parse(readFileSync(manifestPath(pkg), "utf8")) as { name: string; version: string };
    versions.set(pkg, manifest.version);
  }
  return versions;
}

export function run(kind: string | undefined, dry: boolean): number {
  if (!kind) {
    console.error("folosire: node tools/bump.ts <patch|minor|major|X.Y.Z> [--dry]");
    return 2;
  }

  const versions = readVersions();
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    console.error("pachetele au versiuni diferite; sincronizeaza-le intai:");
    for (const [pkg, v] of versions) console.error(`  ${pkg}: ${v}`);
    return 1;
  }

  const current = [...distinct][0]!;
  const next = bump(parse(current), kind);
  console.log(`bump: ${current} -> ${next}${dry ? "  (dry-run, nimic scris)" : ""}`);

  if (dry) return 0;

  // Scriere prin inlocuire in text, ca sa pastram formatarea fiecarui manifest.
  for (const pkg of PACKAGES) {
    const p = manifestPath(pkg);
    const raw = readFileSync(p, "utf8");
    const replaced = raw.replace(`"version": ${JSON.stringify(current)}`, `"version": ${JSON.stringify(next)}`);
    if (replaced === raw) {
      console.error(`  nu am gasit linia de versiune in ${pkg}/package.json`);
      return 1;
    }
    writeFileSync(p, replaced);
    console.log(`  ${pkg} -> ${next}`);
  }

  console.log(`\nUrmatorul pas: publica cu`);
  console.log(`  pnpm -r --filter "./packages/*" publish --access public`);
  console.log(`(sau intai un commit: git commit -am "release ${next}" && git tag v${next})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const kind = args.find((a) => a !== "--dry");
  process.exit(run(kind, dry));
}
