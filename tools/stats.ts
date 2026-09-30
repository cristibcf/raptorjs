/**
 * The single source for the numbers we claim about the project.
 *
 * The test count and the component count used to be typed by hand in three places
 * (README, the site's home page, ROADMAP) and they diverged: 799 vs 747 vs
 * reality. A number you call "honest" is not allowed to be typed by hand.
 *
 * `pnpm stats` runs the real suite, counts, and rewrites:
 *   - `examples/site/src/content/stats.ts` (consumed by the home page)
 *   - the `pnpm test` line in README.md
 *
 * `pnpm stats --check` writes nothing and exits with code 1 if the files differ
 * from reality - the shape suited for CI.
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
  /** The names of the external dependencies; empty means the thesis holds.  */
  readonly runtimeDependencies: readonly string[];
}

/** Runs the suite and reads the TAP summary from `node --test`. */
function measureTests(): Pick<Stats, "tests" | "pass" | "skip" | "fail"> {
  const result = spawnSync(
    process.execPath,
    ["--test", "packages/*/tests/**/*.test.ts", "examples/*/tests/**/*.test.ts"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const read = (label: string): number => {
    // `node --test` changes its reporter by version and by TTY: when piped, Node
    // 24 emits spec (`ℹ tests 875`) while Node 22 emits TAP (`# tests 875`).
    // We catch both prefixes, otherwise `stats:check` fails on one of the platforms.
    const match = output.match(new RegExp(`^(?:\\u2139|#) ${label} (\\d+)$`, "m"));
    if (!match) throw new Error(`could not find the summary line '${label}' in the output of node --test`);
    return Number(match[1]);
  };
  return { tests: read("tests"), pass: read("pass"), skip: read("skipped"), fail: read("fail") };
}

/** The publishable packages in the workspace (those with their own package.json). */
function countPackages(): number {
  return readdirSync(join(ROOT, "packages")).filter((name) =>
    existsSync(join(ROOT, "packages", name, "package.json")),
  ).length;
}

/**
 * The documented components = the entries in the site's catalog.
 *
 * We count the source, we don't import it: the catalog files are `.tsx`, so they
 * would require the bundler just to learn the length of a list.
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
 * The EXTERNAL runtime dependencies of the published packages. The thesis requires 0.
 *
 * Workspace links don't count: they are the same project, not foreign code.
 * We recognize them by the `workspace:*` version. `peerDependencies` (e.g. the
 * TypeScript compiler, used only at build time by `@raptorstack/engine`) are not shipped
 * runtime dependencies, so they don't count either. If we counted them, "zero dependencies"
 * would look different and the number would lose its exact meaning right where it matters.
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

/** The public UI entry points: the `./ui*` subpaths in `@raptorstack/raptorjs`. */
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
 * GENERATED BY \`pnpm stats\` - do not edit by hand.
 *
 * The numbers on the home page must come from the real suite, not from someone's
 * memory. \`pnpm stats --check\` fails in CI if the file has fallen behind.
 */
export const TEST_COUNT = ${stats.tests};
export const PACKAGE_COUNT = ${stats.packages};
export const CATALOG_COUNT = ${stats.components};
export const RUNTIME_DEPENDENCIES = ${stats.runtimeDependencies.length};
`;
}

/** The places in the README that carry a measurable number. */
const README_TEST_LINE = /^pnpm test( +)#.*$/m;
const README_CATALOG = /\*\*\d+ catalog entries\*\*/;
const README_ENTRIES = /\*\*\d+ entry points\*\*/;

function renderReadme(current: string, stats: Stats): string {
  // Only the total: how many tests pass vs. get skipped varies between platforms (file
  // symlinks run on Linux but are skipped on Windows, Rolldown is missing where it isn't
  // installed), so a `pass`/`skip` count fixed here would make `stats:check` fail on
  // the other platform. The total and zero-failures are stable everywhere.
  const line = `pnpm test             # ${stats.tests} tests`;
  if (!README_TEST_LINE.test(current)) throw new Error("could not find the 'pnpm test' line in README.md");
  if (!README_CATALOG.test(current)) throw new Error("could not find the catalog entry count in README.md");
  if (!README_ENTRIES.test(current)) throw new Error("could not find the entry-point count in README.md");
  return current
    .replace(README_TEST_LINE, line)
    .replace(README_CATALOG, `**${stats.components} catalog entries**`)
    .replace(README_ENTRIES, `**${stats.uiEntryPoints} entry points**`);
}

export function run(check: boolean): number {
  const stats = collect();

  // A number measured on a red suite is no better than a hand-typed one -
  // it's worse, because it looks measured. This tool exists so we don't publish
  // numbers we can't trust, so don't publish numbers from here either.
  if (stats.fail > 0) {
    console.error(
      `the suite has ${stats.fail} failing test(s) - I won't write numbers based on it.
` +
        "Run 'pnpm test', fix it, then 'pnpm stats'.",
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
      console.log(`the numbers are up to date: ${stats.tests} tests, ${stats.components} components, ${stats.runtimeDependencies.length} external dependencies`);
      return 0;
    }
    console.error(`stale numbers in: ${stale.join(", ")} - run 'pnpm stats'`);
    return 1;
  }

  writeFileSync(SITE_STATS, site);
  writeFileSync(README, readme);
  console.log(
    `stats: ${stats.tests} tests (${stats.pass} pass, ${stats.skip} skip, ${stats.fail} fail), ` +
      `${stats.packages} packages, ${stats.components} components, ` +
      `${stats.runtimeDependencies.length} external runtime dependencies` +
      (stats.runtimeDependencies.length > 0 ? ` (${stats.runtimeDependencies.join(", ")})` : ""),
  );
  if (stale.length > 0) console.log(`  updated: ${stale.join(", ")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv.includes("--check")));
}
