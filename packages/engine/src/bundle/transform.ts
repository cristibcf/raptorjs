/**
 * Primitive transform: TSX/TS -> JS (CommonJS), with JSX wired to the fine-grained
 * @raptorstack/raptorjs/dom runtime. Type-stripping + JSX transform are done by the TypeScript
 * compiler, used STRICTLY as a build primitive (not at runtime).
 *
 * Why CommonJS: the bundler (bundle.ts) packs the modules into a registry with a
 * lazy `require`; tsc's CommonJS emit gives us exactly `require("spec")` /
 * `exports.x`, which we rewrite to internal IDs. Zero Vite/esbuild/Rolldown.
 */
import ts from "typescript";

/** Default jsxImportSource: the project's fine-grained DOM runtime. */
export const DEFAULT_JSX_IMPORT_SOURCE = "@raptorstack/raptorjs/dom";

export interface TranspileOptions {
  /** Source for the automatic JSX import (defaults to @raptorstack/raptorjs/dom). */
  jsxImportSource?: string;
  /** Emit an inline source map (useful in dev). */
  sourceMap?: boolean;
}

/**
 * The name we hand to the compiler for emit. A `.mjs`/`.mts` file is forced to
 * ES-module output by TypeScript *on its extension alone* (`impliedNodeFormat`),
 * which overrides our `module: CommonJS` and leaves bare `export`/`import` in
 * the result - illegal inside the IIFE the bundler packs every module into, so
 * the page dies at load with "Unexpected token 'export'". Every module in this
 * bundler must be CommonJS, so we present such a file under a format-neutral
 * extension (`.js`/`.ts`), where emit follows the `module` option. `.cjs` is
 * already CommonJS and is left alone. The content is untouched; only the name
 * tsc sees changes, so a `.mjs` dependency (tslib's `tslib.es6.mjs`, Firebase's
 * esm builds, …) is downlevelled to `require`/`exports` like any other file.
 */
function emitName(fileName: string): string {
  if (fileName.endsWith(".mts")) return fileName.slice(0, -4) + ".ts";
  if (fileName.endsWith(".mjs")) return fileName.slice(0, -4) + ".js";
  return fileName;
}

/** Transforms a .ts/.tsx source into browser-ready CommonJS (no types, JSX resolved). */
export function transpile(source: string, fileName: string, options: TranspileOptions = {}): string {
  const out = ts.transpileModule(source, {
    fileName: emitName(fileName),
    reportDiagnostics: false,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: options.jsxImportSource ?? DEFAULT_JSX_IMPORT_SOURCE,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      // In the bundler we don't want the verbatim/erasable restrictions: we transform fully.
      verbatimModuleSyntax: false,
      isolatedModules: true,
      inlineSourceMap: options.sourceMap === true,
      inlineSources: options.sourceMap === true,
    },
  });
  return out.outputText;
}
