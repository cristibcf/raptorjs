/**
 * Analiza ESM a unui modul, INAINTE de transpilare.
 *
 * Bundler-ul emite CommonJS, unde `export * from "x"` devine
 * `__exportStar(require("x"), exports)` - o cerere dinamica, imposibil de
 * analizat static. Ca sa putem elimina re-exporturile nefolosite, citim graful
 * de importuri/exporturi din SURSA, cat timp mai e ESM.
 *
 * Folosim parserul TypeScript, deja dependinta de build a pachetului; nu adaugam
 * nimic nou si nu scriem un parser propriu.
 */
import ts from "typescript";

export interface ImportEdge {
  /** Specifierul din sursa (`"./x.ts"`, `"raptorjs/ui"`). */
  spec: string;
  /** Numele importate: numele EXPORTAT din modulul tinta. */
  names: string[];
  /** `import * as ns from "x"` - nu stim ce foloseste, deci luam tot. */
  namespace: boolean;
  /** `import "x"` - import doar pentru efecte secundare. */
  bare: boolean;
}

export interface ReExportEdge {
  spec: string;
  /** `null` pentru `export * from "x"`. */
  names: Array<{ exported: string; local: string }> | null;
  /** `export * as ns from "x"`: expune un namespace, deci are nevoie de tot. */
  namespaceAs: string | null;
  /** Pozitia in sursa, ca sa putem taia instructiunea daca nu e ceruta. */
  start: number;
  end: number;
}

export interface ModuleInfo {
  /** Numele exportate declarate CHIAR in acest modul. */
  localExports: Set<string>;
  imports: ImportEdge[];
  reExports: ReExportEdge[];
  /**
   * `true` daca modulul are instructiuni de nivel inalt care pot face ceva
   * observabil din afara (apeluri, atribuiri, control flow). Euristica; vezi
   * `isSideEffectFree` din treeshake.ts pentru cum e folosita.
   */
  hasTopLevelStatements: boolean;
}

function nameOf(node: ts.PropertyName | ts.Identifier | ts.BindingName): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  return null;
}

/** Numele legate de un pattern de destructurare (`export const { a, b } = ...`). */
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

/** Citeste graful ESM al unui modul. Nu emite nimic, doar parseaza. */
export function analyzeModule(source: string, fileName: string): ModuleInfo {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, scriptKind(fileName));

  const localExports = new Set<string>();
  const imports: ImportEdge[] = [];
  const reExports: ReExportEdge[] = [];
  let hasTopLevelStatements = false;

  for (const statement of sf.statements) {
    /* ---------------------------------------------------------- importuri */
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
            // `import { a as b }` -> avem nevoie de `a` din tinta.
            names.push((element.propertyName ?? element.name).text);
          }
        }
      }
      imports.push({ spec, names, namespace, bare: false });
      continue;
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      // `import x = require("y")` - tratat ca namespace (luam tot).
      const ref = statement.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        imports.push({ spec: ref.expression.text, names: [], namespace: true, bare: false });
      }
      continue;
    }

    /* ---------------------------------------------------------- exporturi */
    if (ts.isExportDeclaration(statement)) {
      const spec =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;

      if (spec === null) {
        // `export { a, b }` local, fara `from`.
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

    /* ------------------------------------------------------- declaratii -- */
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

    // Orice altceva la nivel inalt: apel, atribuire, if, for, try...
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
 * Sterge intervalele date din sursa, pastrand pozitiile: caracterele devin
 * spatii, dar liniile raman. Asa numerele de linie si coloana din source map
 * continua sa corespunda fisierului original.
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
