/**
 * Headless demo: the same application, with the browser as the host.
 *
 *   node examples/web-shell/src/demo.ts
 *
 * The browser pieces are replaced with test equivalents, so the contract is
 * visible without needing a browser. The variant that actually runs in the page
 * is `src/main.tsx` (`pnpm dev:web-shell`).
 *
 * Run after `demo:desktop` and `demo:mobile`, it shows the third column of the matrix.
 */
import { createSession } from "./session.ts";
import type { WebPlatform } from "@raptorstack/host/web";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const store = new Map<string, string>();
const pushed: string[] = [];
// Carried in an object: TypeScript does not see the assignment in the callback
// below, so a plain variable would narrow to `null`.
const popstate: { fire: ((path: string) => void) | null } = { fire: null };
const shown: string[] = [];

const platform: WebPlatform = {
  storage: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    get length(): number {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
  },
  history: {
    pushState: (_data, _unused, url) => {
      pushed.push(url);
    },
    back: () => undefined,
    length: 1,
  },
  location: { pathname: "/note", search: "", hash: "", origin: "https://exemplu.com" },
  notifications: {
    requestPermission: async () => "granted",
    show: (title, body) => shown.push(`${title}: ${body}`),
  },
  onPopState: (listener) => {
    popstate.fire = listener;
  },
};

const session = createSession({ platform, capabilities: ["window.manage", "device.notifications"] });

console.log("=== RaptorJS with the browser as the host ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("After startup:", session.shell.summary());
console.log("  what the app can do:", JSON.stringify(await session.shell.abilities()));

await session.shell.addNote("read the docs");
await session.shell.announce("note saved");
await tick();

console.log("\nAfter one note:", session.shell.summary());
console.log("  localStorage       :", [...store.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
console.log("  notifications shown:", shown.join(", "));

console.log("\nNavigation requested by the app:", await session.shell.goTo("/arhiva"));
await tick();
console.log("  history.pushState :", pushed.join(", "));
console.log("  route             :", session.shell.route());

console.log("\nNavigation to a foreign origin:", await session.shell.goTo("https://atacator.example/x"));
console.log("  reason:", session.shell.lastError());

// The browser's back button: the route changes out from under the app.
popstate.fire?.("/note");
await tick();
console.log("\nAfter the back button:", session.shell.summary());

for (const method of ["process.spawn", "camera.capture"]) {
  console.log(`\n'${method}' on this host:`, session.bridge.allows(method) ? "allowed" : "unavailable");
}

console.log("\nUpdates:", JSON.stringify(await session.bridge.call("update.check")));

console.log(
  "\n-> The same app as in desktop-shell and mobile-shell. On web, the bridge gives",
);
console.log("   portability, not isolation: the real boundary stays the browser's sandbox.");

session.close();
