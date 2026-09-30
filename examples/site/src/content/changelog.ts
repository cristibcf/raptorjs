/**
 * Changelog: facts, not marketing. Each entry is a `Release` with content
 * blocks, rendered by the same machinery as Learn/Docs. Putting "Unreleased"
 * first follows the Keep a Changelog convention.
 */
import type { Block } from "../lib/ui.tsx";

export interface Release {
  version: string;
  date: string;
  title: string;
  blocks: Block[];
}

export const RELEASES: Release[] = [
  {
    version: "Unreleased",
    date: "2026-09-27",
    title: "Six packages, publish-ready",
    blocks: [
      { t: "list", items: [
        "**Consolidated 22 fine-grained packages into 6**: `@raptorstack/raptorjs` (core + dom + ui), `@raptorstack/wire`, `@raptorstack/engine`, `@raptorstack/runtime`, `@raptorstack/host`, `@raptorstack/test`. Granularity is preserved through subpath exports — `import { Table } from \"@raptorstack/raptorjs/ui\"`, `import { RaptorClient } from \"@raptorstack/wire/client\"`.",
        "**npm publishing set up**: each package ships a compiled `dist/` (`.js` + `.d.ts`) via `publishConfig`, while development stays TS-native. `pnpm -r publish` handles versions and `workspace:*` rewriting.",
        "`typescript` is now a **build-time peer** of `@raptorstack/engine` (the bundler's transform), so the zero-runtime-dependency thesis stays literally true.",
        "Site additions: **search**, **interactive tutorial**, **showcase** and this **changelog** — all built with the stack, all zero-dep.",
      ] },
      { t: "note", kind: "info", title: "Still alpha", text: "Nothing here is production-ready. The shape is stabilising, but the API can still change between alpha builds." },
    ],
  },
  {
    version: "v0.1.0-alpha",
    date: "2026",
    title: "First public alpha",
    blocks: [
      { t: "p", text: "The first end-to-end cut of the stack: one state graph shared by the compiler, the runtime and the wire." },
      { t: "list", items: [
        "**RaptorJS** — fine-grained, glitch-free reactivity (`state`, `derived`, `effect`, `batch`, ownership) with a DOM runtime and JSX; no virtual DOM.",
        "**RaptorWire** — a state-aware binary protocol: opcodes, versioned document, snapshot + delta, a hand-written RFC 6455 WebSocket server, no `ws` dependency.",
        "**RaptorEngine** — `.raptor` compiler, semantic optimizer, the project's own bundler (replaces Vite/esbuild), a profiler and a server runtime with SSR/resume.",
        "**RaptorRuntime** — an application runtime where capabilities are a product feature: the `raptor:` namespace and a broker that denies everything undeclared.",
        "**Host adapters** — one contract across web, desktop, mobile, CLI, service and device.",
        "**RaptorTest** — autonomous behavioural testing with a backend digital twin.",
        "**196 UI components**, each with a live demo. **Zero runtime dependencies** across the shipped libraries.",
      ] },
    ],
  },
];
