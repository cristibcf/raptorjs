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
    version: "0.1.3",
    date: "2026-10-03",
    title: "Release automation",
    blocks: [
      { t: "p", text: "Release tooling only — no library or API changes since 0.1.1." },
      { t: "list", items: [
        "**Tag-driven releases**: pushing a `vX.Y.Z` tag now publishes all six packages to npm and creates a GitHub Release automatically.",
        "**`pnpm bump`** (`tools/bump.ts`) bumps the six package versions in lockstep — `pnpm bump patch | minor | major | X.Y.Z`.",
      ] },
      { t: "note", kind: "info", title: "0.1.2", text: "0.1.2 was tagged but never published to npm; its changes are rolled into 0.1.3." },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-09-30",
    title: "Docs and packaging polish",
    blocks: [
      { t: "p", text: "Documentation and packaging polish — no API changes." },
      { t: "list", items: [
        "A **README for every package**, so each one has install and usage docs on its npm page.",
        "npm / CI / license **badges** and an **\"Install from npm\"** section in the root README.",
      ] },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-30",
    title: "First public alpha",
    blocks: [
      { t: "p", text: "The first end-to-end cut of the stack on npm: one state graph shared by the compiler, the runtime and the wire." },
      { t: "list", items: [
        "**Consolidated 22 fine-grained packages into 6**: `@raptorstack/raptorjs` (core + dom + ui), `@raptorstack/wire`, `@raptorstack/engine`, `@raptorstack/runtime`, `@raptorstack/host`, `@raptorstack/test`. Granularity is preserved through subpath exports — `import { Table } from \"@raptorstack/raptorjs/ui\"`, `import { RaptorClient } from \"@raptorstack/wire/client\"`.",
        "**npm publishing**: each package ships a compiled `dist/` (`.js` + `.d.ts`) via `publishConfig`, while development stays TS-native. `pnpm -r publish` handles versions and `workspace:*` rewriting.",
        "**RaptorJS** — fine-grained, glitch-free reactivity (`state`, `derived`, `effect`, `batch`, ownership) with a DOM runtime and JSX; no virtual DOM.",
        "**RaptorWire** — a state-aware binary protocol: opcodes, versioned document, snapshot + delta, a hand-written RFC 6455 WebSocket server, no `ws` dependency.",
        "**RaptorEngine** — `.raptor` compiler, semantic optimizer, the project's own bundler (replaces Vite/esbuild), a profiler and a server runtime with SSR/resume.",
        "**RaptorRuntime** — an application runtime where capabilities are a product feature: the `raptor:` namespace and a broker that denies everything undeclared.",
        "**Host adapters** — one contract across web, desktop, mobile, CLI, service and device.",
        "**RaptorTest** — autonomous behavioural testing with a backend digital twin.",
        "`typescript` is a **build-time peer** of `@raptorstack/engine`, so the shipped libraries keep **zero runtime dependencies**.",
        "Presentation site with **search**, an **interactive tutorial**, a **showcase** and this **changelog** — all built with the stack.",
      ] },
      { t: "note", kind: "info", title: "Still alpha", text: "Nothing here is production-ready. The shape is stabilising, but the API can still change between alpha builds." },
    ],
  },
];
