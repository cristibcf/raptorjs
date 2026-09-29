/**
 * Showcase: aplicatiile reale din monorepo. La un stack v0.1.0-alpha, cea mai
 * onesta vitrina sunt propriile exemple - fiecare cu comanda care il ruleaza.
 */
export interface ShowcaseItem {
  title: string;
  blurb: string;
  tags: string[];
  /** Comanda pnpm din radacina repo-ului. */
  run: string;
}
export interface ShowcaseGroup {
  title: string;
  blurb: string;
  items: ShowcaseItem[];
}

export const SHOWCASE: ShowcaseGroup[] = [
  {
    title: "Apps",
    blurb: "Reactive UIs, some of them realtime end-to-end over RaptorWire.",
    items: [
      { title: "Realtime dashboard", blurb: "The headline demo: a server pushes deltas to a live dashboard over RaptorWire from the same state graph.", tags: ["RaptorWire", "realtime", "SSR"], run: "pnpm dev:dashboard" },
      { title: "Realtime to-do", blurb: "Two windows, one authoritative store: add and toggle in one, watch the other update by delta.", tags: ["RaptorWire", "reconnect"], run: "pnpm dev:todo" },
      { title: "Chat", blurb: "Subscriptions and op-log resync in a small chat, no external realtime library.", tags: ["RaptorWire", "subscriptions"], run: "pnpm demo:chat" },
      { title: "Counter", blurb: "The smallest thing: one signal, one binding — builds to a static bundle with no runtime deps.", tags: ["RaptorJS", "bundle"], run: "pnpm demo:counter" },
    ],
  },
  {
    title: "Compiler, engine & test",
    blurb: "The build side of the stack, exercised end-to-end.",
    items: [
      { title: "RaptorEngine app", blurb: "A `.raptor` source compiled end-to-end into code that runs on the real runtime.", tags: ["RaptorEngine", "compiler"], run: "pnpm demo:engine" },
      { title: "RaptorTest CRUD", blurb: "Autonomous behavioural testing: observe, infer, synthesize and replay — bugs found without hand-written cases.", tags: ["RaptorTest", "digital twin"], run: "pnpm demo:raptortest" },
      { title: "This site", blurb: "The presentation site itself: RaptorJS UI, a live RaptorWire demo in-page, compiled with RaptorBundle.", tags: ["dogfood", "RaptorBundle"], run: "pnpm dev:site" },
    ],
  },
  {
    title: "One app, six hosts",
    blurb: "The same application running through each host adapter — the bridge gives portability, and the host can say no.",
    items: [
      { title: "Desktop shell", blurb: "Native window, menu, local storage, deep links and notifications through the capability bridge.", tags: ["@raptor/host/desktop"], run: "pnpm demo:desktop" },
      { title: "Mobile shell", blurb: "Adapter-driven navigation, secure storage, suspend/resume, optional native modules.", tags: ["@raptor/host/mobile"], run: "pnpm demo:mobile" },
      { title: "Web shell", blurb: "The browser as a host: History API, localStorage, permissioned notifications.", tags: ["@raptor/host/web"], run: "pnpm dev:web-shell" },
      { title: "Service shell", blurb: "The same app as an HTTP service: real `node:http`, supervisor config, clean drain on SIGTERM.", tags: ["@raptor/host/service"], run: "pnpm demo:service" },
      { title: "CLI shell", blurb: "As a command-line tool — `raptor-notes add/list/clear`, with confirmation refused when there is no TTY.", tags: ["@raptor/host/cli"], run: "pnpm demo:cli" },
      { title: "Device shell", blurb: "On a board: a sensor logger with an LED, I2C, sleep between reads and a watchdog.", tags: ["@raptor/host/device"], run: "pnpm demo:device" },
    ],
  },
  {
    title: "Native runtime",
    blurb: "TypeScript run by the Rust binary — no Node, no tsc.",
    items: [
      { title: "Native hello", blurb: "TypeScript executed by the native binary: types, generics, interfaces — plus proof a denied capability blocks a file that exists.", tags: ["runtime-native", "QuickJS"], run: "raptor-runtime run examples/native-hello" },
      { title: "Native HTTP server", blurb: "An HTTP server written in TypeScript that answers a real `curl`, on the native binary.", tags: ["runtime-native", "HTTP"], run: "raptor-runtime run examples/native-server" },
    ],
  },
];
