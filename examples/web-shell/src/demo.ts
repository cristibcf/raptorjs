/**
 * Demo headless: aceeasi aplicatie, host-ul fiind browserul.
 *
 *   node examples/web-shell/src/demo.ts
 *
 * Bucatile de browser sunt inlocuite cu echivalente de test, ca sa se vada
 * contractul fara sa fie nevoie de un browser. Varianta care chiar ruleaza in
 * pagina este `src/main.tsx` (`pnpm dev:web-shell`).
 *
 * Rulat dupa `demo:desktop` si `demo:mobile`, arata a treia coloana a matricei.
 */
import { createSession } from "./session.ts";
import type { WebPlatform } from "@raptor/host/web";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const store = new Map<string, string>();
const pushed: string[] = [];
// Purtat intr-un obiect: TypeScript nu vede atribuirea din callback-ul de mai
// jos, deci o variabila simpla s-ar ingusta la `null`.
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

console.log("=== RaptorJS cu browserul pe post de host ===\n");

await session.shell.start();
session.host.lifecycle.to("ready");
session.host.lifecycle.to("foreground");
await tick();

console.log("Dupa pornire:", session.shell.summary());
console.log("  ce poate aplicatia:", JSON.stringify(await session.shell.abilities()));

await session.shell.addNote("de citit documentatia");
await session.shell.announce("nota salvata");
await tick();

console.log("\nDupa o nota:", session.shell.summary());
console.log("  localStorage      :", [...store.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
console.log("  notificari aratate:", shown.join(", "));

console.log("\nNavigare ceruta de aplicatie:", await session.shell.goTo("/arhiva"));
await tick();
console.log("  history.pushState :", pushed.join(", "));
console.log("  ruta              :", session.shell.route());

console.log("\nNavigare catre o origine straina:", await session.shell.goTo("https://atacator.example/x"));
console.log("  motiv:", session.shell.lastError());

// Butonul de back al browserului: ruta se schimba de sub aplicatie.
popstate.fire?.("/note");
await tick();
console.log("\nDupa butonul de back:", session.shell.summary());

for (const method of ["process.spawn", "camera.capture"]) {
  console.log(`\n'${method}' pe acest host:`, session.bridge.allows(method) ? "permisa" : "indisponibila");
}

console.log("\nActualizari:", JSON.stringify(await session.bridge.call("update.check")));

console.log(
  "\n-> Aceeasi aplicatie ca in desktop-shell si mobile-shell. Pe web, puntea da",
);
console.log("   portabilitate, nu izolare: granita reala ramane sandbox-ul browserului.");

session.close();
