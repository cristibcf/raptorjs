# Changelog

All notable changes to the `@raptorstack/*` packages are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All six packages are versioned in lockstep (`@raptorstack/raptorjs`, `/wire`,
`/engine`, `/runtime`, `/host`, `/test`), so one version number covers the set.

> **Alpha.** Nothing here is production-ready yet. The API can still change
> between alpha releases.

## [0.1.3] - 2026-10-03

Release tooling only — **no library or API changes** since 0.1.1.

### Added
- GitHub Actions release workflow: pushing a `vX.Y.Z` tag publishes all six
  packages to npm and creates a GitHub Release with auto-generated notes.
- `tools/bump.ts` — bumps the six package versions in lockstep
  (`pnpm bump <patch|minor|major|X.Y.Z>`).

### Fixed
- Pinned pnpm to v9 in the release workflow (matches CI) so the tag-triggered
  job sets up correctly.

> 0.1.2 was tagged but never published to npm; its changes are rolled into 0.1.3.

## [0.1.1] - 2026-09-30

Documentation and packaging polish — **no API changes**.

### Added
- A README for every package, so each one has install/usage docs on its npm page.
- npm version / CI / license badges and an "Install from npm" section in the
  root README.

## [0.1.0] - 2026-09-30

First public alpha on npm.

### Added
- **Consolidated 22 fine-grained packages into 6** under the `@raptorstack`
  scope. Granularity is preserved through subpath exports, e.g.
  `@raptorstack/raptorjs/ui`, `@raptorstack/wire/client`,
  `@raptorstack/engine/bundle`.
- **npm publishing**: each package ships a compiled `dist/` (`.js` + `.d.ts`)
  via `publishConfig`, while development stays TS-native (Node ≥ 22 type
  stripping). `pnpm -r publish` handles versions and `workspace:*` rewriting.
- **RaptorJS** — fine-grained, glitch-free reactivity (`state`, `derived`,
  `effect`, `batch`, ownership), a DOM runtime and JSX; no virtual DOM.
- **RaptorWire** — a state-aware binary protocol: opcodes, versioned document,
  snapshot + delta, a hand-written RFC 6455 WebSocket server (no `ws`).
- **RaptorEngine** — `.raptor` compiler, semantic optimizer, the project's own
  bundler (replaces Vite/esbuild), a profiler, and a server runtime with
  SSR/resume.
- **RaptorRuntime** — an application runtime where capabilities are a product
  feature: the `raptor:` namespace and a broker that denies everything
  undeclared.
- **Host adapters** — one contract across web, desktop, mobile, CLI, service
  and device.
- **RaptorTest** — autonomous behavioural testing with a backend digital twin.
- Presentation site with **search**, an **interactive tutorial**, a
  **showcase** and a **changelog** — all built with the stack.

### Changed
- `typescript` is a **build-time peer dependency** of `@raptorstack/engine`
  (the bundler's transform), so the libraries keep **zero runtime dependencies**.
- The entire codebase and documentation are in English.

### Fixed
- CI green on Node 22 and 24: `raptor:process` resolves spawned commands through
  the host `PATH` on Linux; stats are stable across platforms and read both the
  spec and TAP reporter output; removed a timer `unref` that left the Node 22
  test runner with a pending promise.

[0.1.3]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.3
[0.1.1]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.1
[0.1.0]: https://github.com/cristibcf/raptorjs/releases/tag/v0.1.0
