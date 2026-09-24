/**
 * Sursa unica pentru cifrele pe care le afirmam despre proiect.
 *
 * Numarul de teste si numarul de componente erau scrise de mana in trei locuri
 * (README, pagina de start a site-ului, ROADMAP) si au divergat: 799 vs 747 vs
 * realitatea. O cifra despre care spui "onest" nu are voie sa fie tastata.
 *
 * `pnpm stats` ruleaza suita reala, numara, si rescrie:
 *   - `examples/site/src/content/stats.ts` (consumat de pagina de start)
 *   - linia cu `pnpm test` din README.md
 *
 * `pnpm stats --check` nu scrie nimic si iese cu cod 1 daca fisierele difera de
 * realitate - forma potrivita pentru CI.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Stats {
  readonly tests: number;
  readonly pass: number;
  readonly skip: number;
  readonly fail: number;
  readonly packages: number;
  readonly components: number;
  readonly uiEntryPoints: number;
  /** Numele dependentelor externe; gol inseamna ca teza tine.  */
  readonly runtimeDependencies: readonly string[];
}

/** Ruleaza suita si citeste sumarul TAP al lui `node --test`. */
function measureTests(): Pick<Stats, "tests" | "pass" | "skip" | "fail"> {
  const result = spawnSync(
    process.execPath,
    ["--test", "packages/*/tests/*.test.ts", "examples/*/tests/*.test.ts"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const read = (label: string): number => {
    const match = output.match(new RegExp(`^\\u2139 ${label} (\\d+)$`, "m"));
    if (!match) throw new Error(`nu am gasit linia de sumar '${label}' in iesirea lui node --test`);
    return Number(match[1]);
  };
  return { tests: read("tests"), pass: read("pass"), skip: read("skipped"), fail: read("fail") };
}

/** Pachetele publicabile din workspace (cele cu package.json propriu). */
function countPackages(): number {
  return readdirSync(join(ROOT, "packages")).filter((name) =>
    existsSync(join(ROOT, "packages", name, "package.json")),
  ).length;
}

/**
 * Componentele documentate = intrarile din catalogul site-ului.
 *
 * Numaram sursa, nu o importam: fisierele de catalog sunt `.tsx`, deci ar cere
 * bundler-ul doar ca sa aflam o lungime de lista.
 */
function countComponents(): number {
  const dir = join(ROOT, "examples", "site", "src", "catalog");
  let total = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tsx")) continue;
    total += readFileSync(join(dir, file), "utf8").match(/^\s*slug: "/gm)?.length ?? 0;
  }
  return total;
}

/**
 * Dependentele de runtime EXTERNE ale pachetelor publicate. Teza cere 0.
 *
 * Legaturile `@raptor/*` din workspace nu se numara: sunt acelasi proiect, nu
 * cod strain. Daca le-am numara, "zero dependente" ar arata ca 28 si cifra si-ar
 * pierde intelesul exact in locul in care conteaza.
 */
function countRuntimeDependencies(): readonly string[] {
  const external = new Set<string>();
  for (const name of readdirSync(join(ROOT, "packages"))) {
    const manifest = join(ROOT, "packages", name, "package.json");
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(json.dependencies ?? {})) {
      if (!dep.startsWith("@raptor/")) external.add(dep);
    }
  }
  return [...external].sort();
}

/** Punctele de intrare publice ale `@raptor/ui` (subpath exports). */
function countUiEntryPoints(): number {
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", "ui", "package.json"), "utf8")) as {
    exports?: Record<string, string>;
  };
  return Object.keys(manifest.exports ?? {}).length;
}

export function collect(): Stats {
  return {
    ...measureTests(),
    packages: countPackages(),
    components: countComponents(),
    uiEntryPoints: countUiEntryPoints(),
    runtimeDependencies: countRuntimeDependencies(),
  };
}

const SITE_STATS = join(ROOT, "examples", "site", "src", "content", "stats.ts");
const README = join(ROOT, "README.md");

function renderSiteStats(stats: Stats): string {
  return `/**
 * GENERAT DE \`pnpm stats\` - nu edita de mana.
 *
 * Cifrele de pe pagina de start trebuie sa vina din suita reala, nu din memoria
 * cuiva. \`pnpm stats --check\` pica in CI daca fisierul a ramas in urma.
 */
export const TEST_COUNT = ${stats.tests};
export const TEST_PASS = ${stats.pass};
export const TEST_SKIP = ${stats.skip};
export const PACKAGE_COUNT = ${stats.packages};
export const CATALOG_COUNT = ${stats.components};
export const RUNTIME_DEPENDENCIES = ${stats.runtimeDependencies.length};
`;
}

/** Locurile din README care poarta o cifra masurabila. */
const README_TEST_LINE = /^pnpm test( +)#.*$/m;
const README_CATALOG = /\*\*\d+ de intrări în catalog\*\*/;
const README_ENTRIES = /\*\*\d+ de puncte de intrare\*\*/;

function renderReadme(current: string, stats: Stats): string {
  const suffix = stats.skip > 0 ? `; ${stats.skip} skip fără Rolldown instalat` : "";
  const line = `pnpm test             # ${stats.tests} de teste (${stats.pass} pass${suffix})`;
  if (!README_TEST_LINE.test(current)) throw new Error("nu am gasit linia 'pnpm test' in README.md");
  if (!README_CATALOG.test(current)) throw new Error("nu am gasit numarul de intrari de catalog in README.md");
  if (!README_ENTRIES.test(current)) throw new Error("nu am gasit numarul de puncte de intrare in README.md");
  return current
    .replace(README_TEST_LINE, line)
    .replace(README_CATALOG, `**${stats.components} de intrări în catalog**`)
    .replace(README_ENTRIES, `**${stats.uiEntryPoints} de puncte de intrare**`);
}

export function run(check: boolean): number {
  const stats = collect();
  const site = renderSiteStats(stats);
  const readme = renderReadme(readFileSync(README, "utf8"), stats);

  const stale: string[] = [];
  if (!existsSync(SITE_STATS) || readFileSync(SITE_STATS, "utf8") !== site) stale.push("examples/site/src/content/stats.ts");
  if (readFileSync(README, "utf8") !== readme) stale.push("README.md");

  if (check) {
    if (stale.length === 0) {
      console.log(`cifrele sunt la zi: ${stats.tests} teste, ${stats.components} componente, ${stats.runtimeDependencies.length} dependente externe`);
      return 0;
    }
    console.error(`cifre invechite in: ${stale.join(", ")} - ruleaza 'pnpm stats'`);
    return 1;
  }

  writeFileSync(SITE_STATS, site);
  writeFileSync(README, readme);
  console.log(
    `stats: ${stats.tests} teste (${stats.pass} pass, ${stats.skip} skip, ${stats.fail} fail), ` +
      `${stats.packages} pachete, ${stats.components} componente, ` +
      `${stats.runtimeDependencies.length} dependente de runtime externe` +
      (stats.runtimeDependencies.length > 0 ? ` (${stats.runtimeDependencies.join(", ")})` : ""),
  );
  if (stale.length > 0) console.log(`  actualizat: ${stale.join(", ")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.includes("--check")));
}
