# @raptorstack/engine

**RaptorEngine** — the semantic-aware build/dev/runtime toolchain. Parses
`.raptor` into a **Raptor IR** with stable IDs, builds a Semantic Application
Graph and optimizes over it (Dead Signal Elimination, Dependency Fusion),
generates browser + server + wire from a single graph, with Stateful Reactive
HMR and reproducible caching. Ships its own bundler (no Vite/webpack).

`typescript` is a build-time **peer dependency** (the bundler's transform), not a
shipped runtime dependency.

Part of [**RaptorStack**](https://github.com/cristibcf/raptorjs).

## Install

```bash
npm install -D @raptorstack/engine
```

## CLIs

- `raptor` — the unified RaptorEngine CLI (build, optimize, codegen).
- `raptor-create` — project generator (RaptorForge).
- `raptor-run` — server runtime (RaptorRun): SSR/resume, routing, sessions.
- `raptor-bundle` — the zero-dependency TSX/ESM bundler + dev server.
- `raptor-profile` — runtime telemetry + profile-guided build planning.

## Subpaths

`@raptorstack/engine`, `/compiler`, `/bundle`, `/profile`, `/run`, `/forge`.

## License

MIT
