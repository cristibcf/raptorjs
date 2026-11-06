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

## Bundling for the browser

```bash
raptor-bundle build src/main.tsx --out dist/bundle.js --html index.html
raptor-bundle build src/main.tsx --platform node          # a bundle that runs on Node
```

A dependency is resolved with **browser** export conditions by default
(`browser`, `module`, `import`, `default`), in that priority order rather than
the order the package's `exports` map happens to list them, and the legacy
top-level `browser` field is honoured as well. Before 0.2.1 resolution went
through Node's own resolver, which applies the `node` condition and cannot be
told otherwise, so a dual-published dependency had its Node build packed into
the browser bundle.

A Node builtin reached from a browser graph **fails the build**, naming the
importer and the specifier, rather than being emitted as `require("net")` and
becoming a blank page. Pass `--platform node` when the bundle really is for
Node, where a builtin is a legitimate external.

## Subpaths

`@raptorstack/engine`, `/compiler`, `/bundle`, `/profile`, `/run`, `/forge`.

## License

MIT
