# @raptorstack/host

The common **host contract** for Raptor applications plus platform adapters. One
application runs unchanged across web, desktop, mobile, CLI, service and device —
each adapter maps the contract (capabilities, the `raptor.host.json` manifest, the
JS↔host bridge, lifecycle, packaging) to its platform. The bridge gives
portability, and the host can say no. Zero runtime dependencies.

Part of [**RaptorStack**](https://github.com/cristibcf/raptorjs).

## Install

```bash
npm install @raptorstack/host
```

## Subpaths

- `@raptorstack/host` — the contract: capability matrix, manifest, bridge, lifecycle, packaging.
- `@raptorstack/host/web` — browser host (History, localStorage, Notification, Geolocation).
- `@raptorstack/host/desktop` — WebView2 / WKWebView / WebKitGTK, windows, menus, installers.
- `@raptorstack/host/mobile` — Android/iOS bridge, secure storage, optional native modules.
- `@raptorstack/host/cli` — the terminal as a host.
- `@raptorstack/host/service` — a process supervisor as a host (listen sockets, SIGTERM drain).
- `@raptorstack/host/device` — firmware on a board (declared pins, OTA, watchdog).

## License

MIT
