# Publishing the libraries to npm

The stack is published as **6 packages** (grouped by category), not one per
module. Each one exposes its internal granularity through **subpath exports**, so
the consumer imports exactly what they need:

| Package | Contains | Subpaths |
|---|---|---|
| `raptorjs` | reactivity + DOM + UI | `raptorjs`, `raptorjs/dom`, `raptorjs/dom/jsx-runtime`, `raptorjs/dom/testing`, `raptorjs/ui`, `raptorjs/ui/*` |
| `@raptor/wire` | the binary protocol | `@raptor/wire`, `/codec`, `/client`, `/server` |
| `@raptor/engine` | compiler + build + server runtime | `@raptor/engine`, `/compiler`, `/bundle`, `/profile`, `/run`, `/forge` (+ 5 bins) |
| `@raptor/runtime` | runtime contracts + launcher | `@raptor/runtime`, `/cli` (bin `raptor-runtime`) |
| `@raptor/host` | host contract + adapters | `@raptor/host`, `/web`, `/desktop`, `/mobile`, `/cli`, `/service`, `/device` |
| `@raptor/test` | behavioral testing | `@raptor/test` |

`@raptor/runtime-native` (Rust) is not published to npm.

## TS-native dev vs. compiled dist

Development stays **TS-native** (Node runs `.ts` directly, and the `exports` in
each `package.json` point to `./src/*.ts`). Publishing points to `dist/` without
touching the development workflow:

- `exports` / `types` stay pointed at `./src/*.ts` → `pnpm dev`, the tests and
  type-stripping keep working unchanged.
- `publishConfig.exports` / `main` / `types` / `bin` point to `./dist/*.js`.
  **pnpm** applies these overrides only in the published manifest.
- `tsc` (already in devDependencies, so **zero shipped runtime dependency**)
  compiles with `rewriteRelativeImportExtensions`, which rewrites relative
  imports `./x.ts` → `./x.js`. Bare subpaths (`@raptor/wire/codec`,
  `raptorjs/dom`) are left untouched and resolve through `exports` on the consumer side.
- `prepack` in each package runs the build automatically before `pack`/`publish`.
- `pnpm publish` automatically turns `workspace:*` into real versions.

`typescript` is a **peerDependency** of `@raptor/engine` (the bundler uses it as a
build-time transform, not as a shipped dependency), so the "zero runtime
dependencies" claim stays true — `pnpm stats:check` verifies it.

## How to publish

```bash
# 1. Authenticate (once)
npm login

# 2. (optional) dry-run check without upload — requires being logged in
pnpm -r --filter "./packages/*" run build
npm run prepublish:check

# 3. Publish everything that changed, in topological order
pnpm -r --filter "./packages/*" publish --access public
```

`publishConfig.access` is already `public` in every package.

## Versioning

npm refuses to republish an existing version. Bump before publishing:

```bash
pnpm -r --filter "./packages/*" exec npm version patch --no-git-tag-version
```

or individually with `npm version patch|minor|major` in the package folder.

## Repository metadata

`repository` (with a per-package `directory`), `homepage`, `bugs` and `author`
are set in every package, tied to <https://github.com/cristibcf/raptorjs>.
Each package's npm page thus links directly to its folder in the monorepo.
