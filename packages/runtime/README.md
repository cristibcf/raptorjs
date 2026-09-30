# RaptorRuntime - the host contracts

The implementation of the *RaptorRuntime Product and Architecture Specification*
for **milestone 0 (architecture spike)**, plus the foundation of milestone 1.

The package starts nothing on its own and has no dependencies. It exposes the contracts
that the `@raptor/runtime/cli` launcher consumes and, later, the native host.

## What it contains

| Component (spec §5) | Module | State |
| --- | --- | --- |
| Launcher | `@raptor/runtime/cli` | `run`, `test`, `init`, `pack`, `doctor`, `trace` |
| Engine adapter | `src/engine-adapter.ts` | bootstrap adapter, with per-isolate isolation |
| Module graph | `src/graph.ts` | static graph for `doctor` and `pack` |
| Capability broker | `src/capabilities.ts` | granular, revocable, explicit delegation |
| Task fabric | `src/tasks.ts` | cancellation, deadlines, quotas, draining |
| Platform services | `src/modules/` | `files`, `net`, `process`, `kv`, `serve` |
| Telemetry core | `src/observe.ts` | logs, spans, metrics; OTLP export |

The `raptor:` namespace (spec §6) is exposed as real modules, with types in
[`src/raptor-modules.d.ts`](src/raptor-modules.d.ts) - so `import { readText }
from "raptor:files"` is type-checked by `tsc`, without hand-written declarations.

## The security model (spec §7)

By default everything is denied, with two exceptions annotated in the trace (`clock.real`,
`crypto.random`) and a single implicit domain: reading in the project root.
`policy: "production"` - or `--policy production` - moves the broker into **strict
mode**, where even that implicit domain no longer exists.

```json
{
  "capabilities": {
    "files.read": ["./src", "./assets"],
    "files.write": ["./.raptor", "./dist"],
    "net.connect": ["api.example.com:443", "*.intern.example.com:*"],
    "env.read": ["DATABASE_URL", "RAPTOR_*"],
    "process.spawn": ["git"]
  }
}
```

Delegation to a child isolate passes **only** the explicitly requested subset;
nothing is inherited ambiently, and a revoked capability cannot be revived
through delegation.

## What is not yet implemented

Spec §13 recommends Rust + V8 for the native host. This is the next step,
not what this package delivers. Concretely, the following remain open:

- **Native host and standalone binary** (§5, §10). The bootstrap adapter runs on
  the engine already present on the development machine. The "starts without Node.js
  installed" criterion is the exit criterion of milestone 0 and is not met here.
- **The npm bridge** (§8). `pack` explicitly refuses projects with external packages, instead
  of partially bundling them.
- **Interactive confirmation** of undeclared access (§7). The `prompt` policy
  behaves like `deny` until the native host has its own prompt channel.
- **Signed distribution** (§10): installers, update channels, provenance.

## Commands

```bash
pnpm runtime doctor           # environment, project, capabilities, static graph
pnpm runtime -- --help        # full command surface
pnpm spike                    # run the architecture spike (spec §14)
pnpm spike:checks             # acceptance list, via `raptor-runtime test`
pnpm test:runtime             # the contract suites of the two packages
```

## Integration with the repository (spec §9)

Additive, with no changes to the existing packages: the binary is named
`raptor-runtime`, not `raptor`, and `@raptor/engine/run`, `@raptor/engine/bundle`, and
`@raptor/engine` keep their commands and import paths. The rename comes
only after the compatibility audit (§2, §13).
