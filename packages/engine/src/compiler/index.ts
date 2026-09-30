/**
 * @raptorstack/compiler - the stable semantic core of RaptorEngine (whitepaper 6-9).
 *
 * Separate from the bundler/engine: it parses .raptor into Raptor IR, builds the
 * semantic graph and computes the diff for HMR. @raptorstack/engine consumes this API
 * for optimization, codegen and the dev loop.
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
