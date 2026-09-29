/**
 * @raptor/compiler - nucleul semantic stabil al RaptorEngine (whitepaper 6-9).
 *
 * Separat de bundler/engine: parseaza .raptor in Raptor IR, construieste graful
 * semantic si calculeaza diff-ul pentru HMR. @raptor/engine consuma acest API
 * pentru optimizare, codegen si dev loop.
 */
export {
  ExprKind,
  parseExpression,
  analyze,
  cloneExpr,
  countIdent,
  freeIdents,
  substituteIdent,
  exprToJs,
  type Expr,
  type ExprAnalysis,
} from "./expr.ts";

export {
  IRNodeKind,
  stableId,
  canonicalize,
  serializeIR,
  type IRModule,
  type IRComponent,
  type IRSignal,
  type IRDerived,
  type IRServerSignal,
  type IREffect,
  type IRElement,
  type IRChild,
  type IRAttrBinding,
  type IREventBinding,
  type IRTextBinding,
  type SourceSpan,
} from "./ir.ts";

export { parseModule, RaptorParseError } from "./parser.ts";

export {
  buildGraph,
  SemanticGraph,
  GraphNodeKind,
  EdgeType,
  type GraphNode,
  type GraphEdge,
} from "./graph.ts";

export {
  diffModules,
  type GraphDiff,
  type ComponentPatch,
  type WireChange,
} from "./diff.ts";
