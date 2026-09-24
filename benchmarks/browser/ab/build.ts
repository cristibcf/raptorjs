/**
 * Construieste doua bundle-uri care difera printr-un singur fisier, ca sa poata
 * fi masurate INTERCALAT in aceeasi pagina.
 *
 * De ce asa: masuratorile facute in navigari separate s-au dovedit
 * necomparabile - acelasi cod a dat 40 ms si 106 ms la `create 10k`, pentru ca
 * intre rulari s-a schimbat incarcarea masinii, nu codul. Singurul mod onest de
 * a compara doua variante e sa le pui in acelasi proces, in aceeasi pagina, si
 * sa alternezi intre ele; zgomotul cade atunci pe amandoua deodata.
 *
 * Un plugin de rezolvare schimba implementarea lui `control.ts` (unde sta `For`)
 * fara sa atinga restul grafului, deci diferenta dintre bundle-uri este exact
 * schimbarea testata.
 *
 * Rulare: node browser/ab/build.ts <caleA> <caleB>
 */
import * as esbuild from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const control = resolve(here, "../../../packages/dom/src/control.ts");

const [variantA, variantB] = process.argv.slice(2);
if (!variantA || !variantB) {
  console.error("folosire: node browser/ab/build.ts <control-A.ts> <control-B.ts>");
  process.exit(1);
}

const normalize = (p: string): string => resolve(p).replace(/\\/g, "/").toLowerCase();

/** Redirecteaza orice import de `control.ts` catre implementarea ceruta. */
function swapControl(implementation: string): esbuild.Plugin {
  const target = normalize(control);
  const replacement = resolve(implementation);
  return {
    name: "swap-control",
    setup(build) {
      build.onResolve({ filter: /control\.ts$/ }, (args) => {
        const candidate = normalize(join(args.resolveDir, args.path));
        return candidate === target ? { path: replacement } : null;
      });
    },
  };
}

async function build(name: string, controlImpl: string): Promise<void> {
  await esbuild.build({
    entryPoints: [join(here, "entry.ts")],
    bundle: true,
    format: "esm",
    outfile: join(here, `dist/${name}.js`),
    minify: true,
    target: ["es2020"],
    logLevel: "warning",
    define: { "process.env.NODE_ENV": '"production"' },
    conditions: ["browser", "import", "default"],
    loader: { ".ts": "ts" },
    plugins: [swapControl(controlImpl)],
  });
  console.log(`  ${name}.js  <- ${controlImpl}`);
}

await build("a", variantA);
await build("b", variantB);
console.log("gata");
