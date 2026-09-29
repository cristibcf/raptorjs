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
    ["--test", "packages/*/tests/**/*.test.ts", "examples/*/tests/**/*.test.ts"],
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
 * Legaturile din workspace nu se numara: sunt acelasi proiect, nu cod strain.
 * Le recunoastem dupa versiunea `workspace:*`. `peerDependencies` (ex. compilatorul
 * TypeScript, folosit doar la build de `@raptor/engine`) nu sunt dependente de
 * runtime livrate, deci nu intra nici ele. Daca le-am numara, "zero dependente"
 * ar arata altfel si cifra si-ar pierde intelesul exact in locul in care conteaza.
 */
function countRuntimeDependencies(): readonly string[] {
  const external = new Set<string>();
  for (const name of readdirSync(join(ROOT, "packages"))) {
    const manifest = join(ROOT, "packages", name, "package.json");
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> };
    for (const [dep, version] of Object.entries(json.dependencies ?? {})) {
      if (version === "workspace:*") continue;
      external.add(dep);
    }
  }
  return [...external].sort();
}

/** Punctele de intrare UI publice: subpath-urile `./ui*` din `raptorjs`. */
function countUiEntryPoints(): number {
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", "raptorjs", "package.json"), "utf8")) as {
    exports?: Record<string, string>;
  };
  return Object.keys(manifest.exports ?? {}).filter((k) => k === "./ui" || k.startsWith("./ui/")).length;
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
  // Doar totalul: cate teste trec vs se sar variaza intre platforme (symlink-uri
  // de fisier ruleaza pe Linux dar se sar pe Windows, Rolldown lipseste unde nu e
  // instalat), deci un numar de `pass`/`skip` fixat aici ar face `stats:check` sa
  // pice pe cealalta platforma. Totalul si zero-esecuri sunt stabile peste tot.
  const line = `pnpm test             # ${stats.tests} de teste`;
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

  // O cifra masurata pe o suita rosie nu e mai buna decat una scrisa de mana -
  // e mai rea, fiindca pare masurata. Unealta asta exista ca sa nu publicam
  // numere in care nu ne putem increde, deci nu publica nici numere de aici.
  if (stats.fail > 0) {
    console.error(
      `suita are ${stats.fail} test(e) care pica - nu scriu cifre pornind de la ea.
` +
        "Ruleaza 'pnpm test', repara, apoi 'pnpm stats'.",
    );
    return 1;
  }

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
