/**
 * Transform primitiv: TSX/TS -> JS (CommonJS), cu JSX legat de runtime-ul
 * fine-grained @raptor/dom. Type-stripping + transform JSX sunt facute de
 * compilatorul TypeScript, folosit STRICT ca primitiva de build (nu la runtime).
 *
 * De ce CommonJS: bundler-ul (bundle.ts) impacheteaza modulele intr-un registru
 * cu `require` lazy; emisia CommonJS a lui tsc ne da exact `require("spec")` /
 * `exports.x`, pe care le rescriem la ID-uri interne. Zero Vite/esbuild/Rolldown.
 */
import ts from "typescript";

/** jsxImportSource implicit: runtime-ul DOM fine-grained al proiectului. */
export const DEFAULT_JSX_IMPORT_SOURCE = "raptorjs/dom";

export interface TranspileOptions {
  /** Sursa pentru importul automat de JSX (implicit @raptor/dom). */
  jsxImportSource?: string;
  /** Emite source map inline (util in dev). */
  sourceMap?: boolean;
}

/** Transforma o sursa .ts/.tsx in CommonJS browser-ready (fara tipuri, JSX rezolvat). */
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
      // In bundler nu vrem restrictiile de verbatim/erasable: transformam complet.
      verbatimModuleSyntax: false,
      isolatedModules: true,
      inlineSourceMap: options.sourceMap === true,
      inlineSources: options.sourceMap === true,
    },
  });
  return out.outputText;
}
