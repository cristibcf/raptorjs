# Hosts: desktop, mobile, browser, service, terminal and board

A guide to the "Host" layer from the roadmap (§4, §6, §8): what exists now, what
contract it honors, and where the current implementation stops.

The roadmap calls only desktop and mobile "native hosts". The other two targets
have a host too, just a different kind: for `web`, §4 states explicitly that **the
host is the browser**; for `server`, the host is the **process supervisor** that
opens the sockets, brings the configuration and requests shutdown — exactly the
"Platform services" row from stage 3 (§3); for `cli`, the host is the **terminal**,
which provides the arguments, the output streams, Ctrl-C and the exit code; and for
`embedded`, the **board's firmware**, which provides pins, buses and sleep — and
which, alone among them all, does not trust the application. The same contract is
implemented there too ([`@raptorstack/host/web`](../packages/web-host)), with a caveat
that must not be lost: in the browser the bridge provides **portability, not
isolation** — the page and the host are the same isolate, and the real boundary
remains the browser's origin sandbox. On desktop and mobile, where the bridge
crosses a process, the host's rejection really is a security boundary.

## What exists and what doesn't

| Part | Status | Where |
|---|---|---|
| The capability matrix (§6) | **Implemented**, transcribed as data and tested row by row | [`@raptorstack/host`](../packages/host) |
| The native-boundary manifest `raptor.host.json` | **Implemented**: parser with accumulated diagnostics, stable round-trip | `packages/host/src/manifest.ts` |
| The JS ↔ host bridge (protocol, transport, lifecycle) | **Implemented**, with an in-process reference host | `packages/host/src/{protocol,bridge,host-server}.ts` |
| Desktop adapter (windows, menus, deep links, notifications, storage, update) | **Implemented as a reference host** | [`@raptorstack/host/desktop`](../packages/desktop) |
| Mobile adapter (navigation, secure storage, lifecycle, deep links, optional modules) | **Implemented as a reference host** | [`@raptorstack/host/mobile`](../packages/mobile) |
| Browser adapter (History API, localStorage, Notification, Geolocation) | **Implemented**; portability, not isolation | [`@raptorstack/host/web`](../packages/web-host) |
| Service adapter (sockets, configuration, health, draining) | **Implemented**, with a real `node:http` server | [`@raptorstack/host/service`](../packages/service-host) |
| Terminal adapter (argv, streams, TTY, confirmations, exit code) | **Implemented**, with a runnable binary | [`@raptorstack/host/cli`](../packages/cli-host) |
| Board adapter (pins, buses, sleep, watchdog, OTA) | **Implemented**, with a simulated board | [`@raptorstack/host/device`](../packages/device-host) |
| Packaging + installer workflow | **Generated plan**, deterministic, from which CI is derived | `packages/*/src/packaging.ts`, `@raptorstack/engine/forge` |
| **The native Rust binary** — `doctor`/`init`/`pack` and **`run` with the QuickJS engine** | **Runs without Node** | [`packages/runtime-native`](../packages/runtime-native) |
| Native TypeScript stripping, `raptor:` modules as functions, native WebViews | **Doesn't exist** | — |
| **The `raptor-package` command** that actually builds the installers | **Doesn't exist** | — |

## The native binary really runs

The §3 stage 1 criterion — *"starts without Node.js installed"* — **is met** for
`run`. In an environment without Node (WSL Ubuntu, `which node` empty):

```
the app ran in 13.7ms
  project    native-hello@0.1.0
  engine     quickjs
  exports    default, izolat, motorChiarRuleaza, rezultat, runtime
```

The exports read from the module (`rezultat: "suma(1+2+3+4+5) = 15"`) prove the
module was **evaluated**, not just parsed. Details and limits in
[`packages/runtime-native/README.md`](../packages/runtime-native/README.md).

The `raptor:` modules are native functions that go through the capability broker,
and TypeScript is stripped with oxc before the engine — so `.ts` runs natively,
without Node and without `tsc`.

`net` and `serve` are native too: a Raptor server written in TypeScript runs on
the binary and responds to `curl` — the §3 stage 3 criterion.

What remains: the event loop (for async `fetch` and `serve({ fetch })`), TLS,
`tasks` bound to the isolate, and the WebViews in the desktop/mobile adapters.

## The two manifests

A native project has two files, not one, because they describe different things:

- **`raptor.runtime.json`** — what the *application* is allowed to do (entry point,
  policy, files, network, subprocesses). RaptorRuntime reads it.
- **`raptor.host.json`** — what the application asks of the *operating system*:
  target, bundle identity, window, deep-link schemes, update channel, signing
  identity, optional native modules. The adapter reads it.

They compose: the `process.spawn` capability in the host manifest says *whether*
the application may start processes; the `capabilities["process.spawn"]` list in
the runtime manifest says *which* commands. Without both, the call is rejected.

```bash
pnpm raptor:create "Notes Desk" --target desktop --bundle-id com.exemplu.notite
```

generates both files, plus `hosts/desktop/` (the boundary + the packaging
descriptor) and `.github/workflows/installers.yml`.

## The capability matrix (§6)

| Capability | Desktop | Mobile | Web | Server | CLI | Embedded |
|---|---|---|---|---|---|---|
| `app.storage` | yes | yes | yes | yes | yes | yes |
| `net.connect` | yes | yes | yes | yes | yes | optional |
| `window.manage` | yes | **no** | optional | **no** | **no** | **no** |
| `device.camera`, `device.location` | optional | optional | optional | **no** | **no** | **no** |
| `process.spawn` | optional | **no** | **no** | optional | optional | **no** |
| `device.notifications`, `device.files` | optional | optional | optional | **no** | **no** | **no** |
| `net.listen` | **no** | **no** | **no** | optional | optional | optional |
| `service.config` | **no** | **no** | **no** | optional | **no** | **no** |
| `tty.interact` | **no** | **no** | **no** | **no** | optional | **no** |
| `hw.gpio`, `hw.bus`, `power.sleep` | **no** | **no** | **no** | **no** | **no** | optional |

Each row's policy changes with the target — `app.storage` means the application
directory on desktop, the page origin on web, the config directory on CLI and an
NVS partition on the board; the code keeps them in `policies`, not in comments.

The Desktop and Mobile columns are a transcription of the §6 table. The Web,
Server, CLI and Embedded columns, plus the last four rows, are **derived** — marked
as such in the code (`NATIVE_TARGETS`, `source: "derived"`, `policies`), so they
aren't read as spec.

Three non-negotiable rules:

1. **`unavailable` cannot be declared.** A mobile `raptor.host.json` that asks for
   `process.spawn` is invalid — not "accepted and ignored".
2. **`optional` requires an explicit declaration.** An undeclared camera does not exist.
3. **The check happens twice.** The JS-side bridge rejects early, so the message
   is good; the host rejects again, because it is the real boundary — the bridge
   runs in the same isolate as the application and can be bypassed.

## The bridge

Line-delimited JSON protocol, with four frame types: `call`, `result`, `failure`,
`event`. Requests are correlated by id, so concurrent calls don't mix up their
responses; events (lifecycle, deep links, menu commands) flow from the host
without a request.

```ts
import { createBridge, createMemoryChannel } from "@raptorstack/host";
import { createDesktopHost } from "@raptorstack/host/desktop";

const channel = createMemoryChannel();          // in production: stdio / the WebView's messages
const host = createDesktopHost({ manifest, transport: channel.host });
const bridge = createBridge({ target: "desktop", capabilities: manifest.capabilities, transport: channel.app });

await bridge.call("window.open", { title: "Application" });
bridge.on("deeplink.received", (payload) => console.log(payload.url));
```

The application receives **only** the `bridge` object — never the transport. A
missing optional module is not a fatal error: `bridge.allows("notify.show")` says
in advance whether the function exists on the current install.

But `allows` answers only the capability question. What the host can *actually* do
comes from `bridge.supported()`, which also factors in what the adapter implements:
`menu.set` passes the `window.manage` capability on web too, but a browser has no
menu bar — an interface that draws its own options based on `allows` would promise
something that doesn't exist.

The same application, bound in turn to all six hosts:
[`desktop-shell`](../examples/desktop-shell) (`pnpm demo:desktop`),
[`mobile-shell`](../examples/mobile-shell) (`pnpm demo:mobile`),
[`web-shell`](../examples/web-shell) (`pnpm demo:web-host`, or `pnpm dev:web-shell`
for the in-browser variant) , [`service-shell`](../examples/service-shell)
(`pnpm demo:service`) , [`cli-shell`](../examples/cli-shell) (`pnpm demo:cli`)
and [`device-shell`](../examples/device-shell) (`pnpm demo:device`).
Run one after another, you can see what stays the same — the same bridge, the same
signals, the same reactive state — and what changes: who drives navigation, whether
suspension exists, and which modules are missing altogether.

## Lifecycle

`launching → ready → foreground ⇄ background → suspended → stopped`

The vocabulary is shared, the paths are not: the phone suspends and resumes, the
desktop usually doesn't. Illegal jumps are errors (`raptor:host/lifecycle`), not
new states, so the application never ends up in a state it didn't anticipate.

On mobile, `lifecycle.requestStop` sends the application to the background and lets
the system decide on suspension — a phone application doesn't close itself.

## Navigation: the essential difference between targets

On **desktop**, the application opens windows and navigates — but only to the
origins in `allowedOrigins` or to its own packaged unit. A navigation outside the
list is rejected and the window state stays unchanged.

On **mobile**, navigation belongs to the adapter. The application doesn't request
screens; it receives `navigation.changed` and reacts. The reason is the system
back button: if the stack lived in JavaScript, the adapter couldn't respond
correctly to a gesture that doesn't go through JavaScript.

**Reading** the route stays allowed — `navigation.current` — because otherwise the
application wouldn't know what it draws at startup (the adapter may start on a
different screen, for example after a deep link) or after a resume from suspension.
There is, however, no method by which the application can request a route: reading
is not control.

In the **browser**, navigation is split, and this is the third distinct situation:
the page can drive it (History API, via `window.navigate`, still bounded by
`allowedOrigins`), but the user can change it out from under the page with the
browser's back button. The adapter listens for `popstate` and emits
`navigation.changed` — exactly like on mobile — so the application writes route
logic once, for all three.

## The service: sockets instead of windows

On the server there is no graphical interface, so half the matrix is gone too.
What the host provides instead are three things, and each is a decision, not a
detail:

1. **The application doesn't open ports.** It requests a listener *by name*
   (`serve.listen { name: "public" }`), and the host knows the port from the
   deployment allocation. A service that picks its own port can't be placed inside
   a supervisor that hands it one already open (systemd socket activation, a sidecar).
2. **Shutdown is draining, not cutting.** `foreground` means "receiving traffic";
   SIGTERM moves the service into `background` — no new requests come in (503 for
   whatever manages to reach the socket), the in-flight ones finish — and only then `stopped`.
3. **The application declares health**, via `health.set`. The host doesn't guess
   whether the process is ready for traffic. The only state the application can't
   give itself is `draining`: that one is started by the supervisor's signal.

Requests cross the bridge as `serve.request` events and come back through
`serve.respond`, because the bridge carries only JSON. It looks like a detour
compared to a directly-called handler — and it is, in the reference host — but it
is exactly the path a request will take once the host is a separate process.

## The terminal: the question with no one to answer it

On `cli`, the host provides the arguments, two output streams, what it knows about
the terminal (width, color, `NO_COLOR`), Ctrl-C and the exit code. Two rules:

1. **Without an interactive terminal, a question is rejected, not assumed.**
   `tty.interact` can be declared in the manifest, but if stdin isn't a TTY (CI,
   pipe, cron) the call still fails — with `capability-unavailable`, so the tool can
   answer "run me with `--yes`" instead of assuming "yes" to a destructive command.
   It's the same discipline the runtime policy applies when it degrades `prompt`
   to `deny` in the absence of a terminal.
2. **Ctrl-C is an event, not execution.** The first press notifies the application
   (`cli.interrupt`), so it has a chance to clean up; the second stops with 130.

The exit code isn't given directly to the process: it's requested from the host
via `cli.exit`, and only the binary puts it into `process.exitCode`. That way the
tool can be tested in-process, without a terminal — [`examples/cli-shell`](../examples/cli-shell)
has both in-process tests and one that actually starts the binary.

## The board: the host that doesn't trust the application

`embedded` is the target furthest from the roadmap — it appears nowhere in it, and
its column is entirely derived. Its purpose isn't to cover a row from the spec, but
to test the model where it might break. Three things the other five targets don't
require at all:

1. **Watchdog.** On the other targets, a hung application just stays hung.
   On a board in a switchboard cabinet, that isn't an option. `watchdog.pet` is
   the only method in the entire contract that **cannot require a capability**: one
   that could be refused would turn the very mechanism that saves the product
   into an optional one. When the window expires, the host resets — and a late call
   from the vanished application gets a clean rejection, not a transition error.
2. **Per-instance peripherals.** Not "may use GPIO", but "may use pin 2, as an
   output". The capability opens the door, the hardware map says which pins and
   which direction — the same model as the command list for `process.spawn` on
   desktop. A write to a pin declared as an input is rejected *before* the
   hardware, because on a real board it can mean a short circuit.
3. **Real sleep.** `suspended` is no longer a metaphor: the application's clock
   stops, the watchdog doesn't tick, and the window restarts on wake. Otherwise
   any battery-saving board would reset itself.

Update has the sixth model of the whole set: OTA with **rollback**. The new image
starts unconfirmed, and if it doesn't confirm that it booted correctly, the next
reset rolls it back — otherwise broken firmware would turn the product into a brick.

## Packaging and CI

`packaging.json` comes out of the adapter, it isn't hand-written: for each platform
it lists the artifacts, the architectures, the CI runner and what **cannot be
published unsigned**. The artifact names are part of the contract
(`<bundleId>-<version>-<platform>-<architecture>.<ext>`), because both the update
feed and the signature check are tied to them.

The distinction between `required` and `store` matters: an `.msi` must be signed by
the team's CI, an `.ipa` is signed by the store's provisioning profile. The
generated workflow references the signing secrets, but never gives them a default
value — a build that silently produces unsigned artifacts is worse than one that fails.

## The roadmap order (§8)

1. ✅ The RaptorRuntime spike and its test contracts — on the bootstrap engine
2. ✅ `raptor.runtime.json` (runtime) and `raptor.host.json` (native boundary)
3. ✅ A RaptorJS application running through the bridge, with a reference host
4. ✅ The desktop adapter with a demo application
5. ✅ RaptorForge with packaging, then the mobile adapter
6. ⬜ **The native binary** (Rust + WebView + launcher) and `raptor-package`

Step 6 is the one that turns "reference host" into "host". Until then, the exit
criterion of §3 stage 1 — *"starts without Node.js installed"* — is not met and
must not be presented as met: everything that runs now runs on the engine already
present on the development machine.
