# @raptorstack/runtime

**RaptorRuntime** — an application runtime where permissions are a product
feature. The `raptor:` module namespace (`files`, `net`, `serve`, `process`,
`kv`, `observe`, `capabilities`, `tasks`) plus a **capability broker**: every
path, host, variable and command is declared in a manifest, and everything
undeclared is denied. Zero runtime dependencies.

Part of [**RaptorStack**](https://github.com/cristibcf/raptorjs).

## Install

```bash
npm install -D @raptorstack/runtime
```

## CLI

- `raptor-runtime` — the launcher: `init`, `run`, `doctor`, `test`, `pack`, `trace`.

## Subpaths

- `@raptorstack/runtime` — host contracts, capability broker, `raptor:` modules.
- `@raptorstack/runtime/cli` — the launcher implementation.

## License

MIT
