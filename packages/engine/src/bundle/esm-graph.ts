/**
 * ESM analysis of a module, BEFORE transpilation.
 *
 * The bundler emits CommonJS, where `export * from "x"` becomes
 * `__exportStar(require("x"), exports)` - a dynamic call, impossible to analyze
 * statically. So that we can remove unused re-exports, we read the graph of
 * imports/exports from the SOURCE, while it is still ESM.
 *
 * We use the TypeScript parser, already a build dependency of the package; we add
 * nothing new and do not write our own parser.
 */
import ts from "typescript";

export interface ImportEdge {
  /** The specifier from the source (`"./x.ts"`, `"raptorjs/ui"`). */
  spec: string;
  /** The imported names: the name EXPORTED from the target module. */
  names: string[];
  /** `import * as ns from "x"` - we don't know what it uses, so we take everything. */
  namespace: boolean;
  /** `import "x"` - an import purely for side effects. */
  bare: boolean;
}

export interface ReExportEdge {
  spec: string;
  /** `null` for `export * from "x"`. */
  names: Array<{ exported: string; local: string }> | null;
  /** `export * as ns from "x"`: exposes a namespace, so it needs everything. */
  namespaceAs: string | null;
  /** Position in the source, so we can cut the statement if it is not requested. */
  start: number;
  end: number;
}

export interface ModuleInfo {
  /** The exported names declared IN this module itself. */
  localExports: Set<string>;
  imports: ImportEdge[];
  reExports: ReExportEdge[];
  /**
   * `true` if the module has top-level statements that can do something
   * observable from the outside (calls, assignments, control flow). A heuristic;
   * see `isSideEffectFree` in treeshake.ts for how it is used.
   */
  hasTopLevelStatements: boolean;
}

function nameOf(node: ts.PropertyName | ts.Identifier | ts.BindingName): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  return null;
}

/** The names bound by a destructuring pattern (`export const { a, b } = ...`). */
function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, out);
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/** Reads a module's ESM graph. Emits nothing, only parses. */
export function analyzeModule(source: string, fileName: string): ModuleInfo {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, scriptKind(fileName));

  const localExports = new Set<string>();
  const imports: ImportEdge[] = [];
  const reExports: ReExportEdge[] = [];
  let hasTopLevelStatements = false;

  for (const statement of sf.statements) {
    /* ------------------------------------------------------------- imports */
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const spec = statement.moduleSpecifier.text;
      const clause = statement.importClause;

      if (!clause) {
        imports.push({ spec, names: [], namespace: false, bare: true });
        continue;
      }
      const names: string[] = [];
      let namespace = false;
      if (clause.name) names.push("default");
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) namespace = true;
        else {
          for (const element of clause.namedBindings.elements) {
            // `import { a as b }` -> we need `a` from the target.
            names.push((element.propertyName ?? element.name).text);
          }
        }
      }
      imports.push({ spec, names, namespace, bare: false });
      continue;
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      // `import x = require("y")` - treated as a namespace (take everything).
      const ref = statement.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        imports.push({ spec: ref.expression.text, names: [], namespace: true, bare: false });
      }
      continue;
    }

    /* ------------------------------------------------------------- exports */
    if (ts.isExportDeclaration(statement)) {
      const spec =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;

      if (spec === null) {
        // `export { a, b }` local, without `from`.
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) localExports.add(element.name.text);
        }
        continue;
      }

      if (!statement.exportClause) {
        reExports.push({ spec, names: null, namespaceAs: null, start: statement.getStart(sf), end: statement.getEnd() });
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        const ns = statement.exportClause.name.text;
        localExports.add(ns);
        reExports.push({ spec, names: null, namespaceAs: ns, start: statement.getStart(sf), end: statement.getEnd() });
      } else {
        const names = statement.exportClause.elements.map((element) => ({
          exported: element.name.text,
          local: (element.propertyName ?? element.name).text,
        }));
        for (const n of names) localExports.add(n.exported);
        reExports.push({ spec, names, namespaceAs: null, start: statement.getStart(sf), end: statement.getEnd() });
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      localExports.add("default");
      continue;
    }

    /* ---------------------------------------------------- declarations -- */
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      if (hasExportModifier(statement)) {
        const isDefault = (statement as { modifiers?: readonly ts.ModifierLike[] }).modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
        );
        if (isDefault) localExports.add("default");
        const name = statement.name ? nameOf(statement.name as ts.Identifier) : null;
        if (name) localExports.add(name);
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      if (hasExportModifier(statement)) {
        for (const decl of statement.declarationList.declarations) bindingNames(decl.name, localExports);
      }
      continue;
    }

    // Anything else at the top level: a call, assignment, if, for, try...
    hasTopLevelStatements = true;
  }

  return { localExports, imports, reExports, hasTopLevelStatements };
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * Erases the given ranges from the source, preserving positions: characters
 * become spaces, but the lines stay. That way the line and column numbers in the
 * source map keep matching the original file.
 */
export function blankRanges(source: string, ranges: ReadonlyArray<readonly [number, number]>): string {
  if (ranges.length === 0) return source;
  const chars = [...source];
  for (const [start, end] of ranges) {
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  }
  return chars.join("");
}
