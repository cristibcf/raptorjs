/**
 * Bundling pentru benchmark-ul din browser cu esbuild. Compileaza sursele TS
 * (inclusiv sursele native TS ale RaptorJS, cu type-stripping) + React/Preact/
 * Solid din node_modules intr-un singur bundle ESM. NODE_ENV=production ca sa
 * masuram build-urile de productie ale framework-urilor.
 */
import * as esbuild from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const options: esbuild.BuildOptions = {
  entryPoints: [join(here, "src/harness.ts")],
  bundle: true,
  format: "esm",
  outfile: join(here, "dist/bundle.js"),
  sourcemap: true,
  minify: true,
  target: ["es2020"],
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
  conditions: ["browser", "import", "default"],
  loader: { ".ts": "ts" },
  // Doar fisierele .tsx (app-ul Solid) trec prin babel-preset-solid; restul
  // (React/Preact/Raptor scrise fara JSX, in .ts) raman pe loader-ul TS al esbuild.
  plugins: [solidPlugin()],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild: watching…");
} else {
  await esbuild.build(options);
  console.log("esbuild: build gata → browser/dist/bundle.js");
}
