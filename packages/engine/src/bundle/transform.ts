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

/** Transforms a .ts/.tsx source into browser-ready CommonJS (no types, JSX resolved). */
export function transpile(source: string, fileName: string, options: TranspileOptions = {}): string {
  const out = ts.transpileModule(source, {
    fileName,
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
