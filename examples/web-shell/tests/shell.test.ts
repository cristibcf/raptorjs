import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";
import type { WebPlatform } from "@raptor/host/web";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

interface Harness {
  readonly session: Session;
  readonly store: Map<string, string>;
  readonly pushed: string[];
  readonly shown: string[];
  popstate(path: string): void;
}

function harness(options: { capabilities?: readonly string[]; permission?: "granted" | "denied" } = {}): Harness {
  const store = new Map<string, string>();
  const pushed: string[] = [];
  const shown: string[] = [];
  let listener: ((path: string) => void) | null = null;

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
      requestPermission: async () => options.permission ?? "granted",
      show: (title, body) => shown.push(`${title}: ${body}`),
    },
    onPopState: (fn) => {
      listener = fn;
    },
  };

  const session = createSession({
    platform,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });

  return {
    session,
    store,
    pushed,
    shown,
    popstate: (path: string) => listener?.(path),
  };
}

async function started(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const context = harness(options);
  await context.session.shell.start();
  context.session.host.lifecycle.to("ready");
  context.session.host.lifecycle.to("foreground");
  await tick();
  return context;
}

test("aplicatia afla la pornire pe ce URL a fost deschisa", async () => {
  const context = await started();
  try {
    assert.equal(context.session.shell.route(), "/note");
    assert.equal(context.session.shell.summary(), "foreground - 0 note pe /note");
  } finally {
    context.session.close();
  }
});

test("lista de posibilitati spune adevarul: capabilitate acordata SI metoda implementata", async () => {
  const context = await started();
  try {
    const abilities = await context.session.shell.abilities();
    assert.equal(abilities["window.navigate"], true);
    assert.equal(abilities["notify.show"], true);
    // Capabilitatea `window.manage` acopera si meniurile, dar un browser nu are
    // bara de meniu a aplicatiei - deci raspunsul onest este "nu".
    assert.equal(abilities["menu.set"], false);
    assert.equal(context.session.bridge.allows("menu.set"), true, "capabilitatea singura ar fi spus 'da'");
    assert.equal(abilities["process.spawn"], false);
    assert.equal(abilities["camera.capture"], false, "modul nedeclarat");
  } finally {
    context.session.close();
  }
});

test("notele merg in localStorage, sub prefixul aplicatiei", async () => {
  const context = await started();
  try {
    await context.session.shell.addNote("prima");
    assert.equal(
      context.store.get("com.raptor.web-shell:notes"),
      '[{"text":"prima","route":"/note"}]',
      "nota retine si ecranul pe care a fost scrisa",
    );
  } finally {
    context.session.close();
  }
});

test("navigarea aplicatiei trece prin History API si actualizeaza ruta", async () => {
  const context = await started();
  try {
    assert.equal(await context.session.shell.goTo("/arhiva"), true);
    await tick();
    assert.deepEqual(context.pushed, ["/arhiva"]);
    assert.equal(context.session.shell.route(), "/arhiva");
    assert.equal(context.session.shell.lastError(), null);
  } finally {
    context.session.close();
  }
});

test("o navigare refuzata este informatie pentru interfata, nu o avarie", async () => {
  const context = await started();
  try {
    assert.equal(await context.session.shell.goTo("https://atacator.example/x"), false);
    assert.match(String(context.session.shell.lastError()), /navigare refuzata/);
    assert.deepEqual(context.pushed, [], "nimic nu a intrat in istoric");
    // Aplicatia ramane utilizabila dupa refuz.
    assert.equal(await context.session.shell.goTo("/arhiva"), true);
    assert.equal(context.session.shell.lastError(), null);
  } finally {
    context.session.close();
  }
});

test("butonul de back schimba ruta de sub aplicatie", async () => {
  const context = await started();
  try {
    await context.session.shell.goTo("/arhiva");
    await tick();
    context.popstate("/note");
    await tick();
    assert.equal(context.session.shell.route(), "/note");
  } finally {
    context.session.close();
  }
});

test("utilizatorul poate refuza notificarile, chiar daca manifestul le declara", async () => {
  const refuzat = await started({ permission: "denied" });
  try {
    assert.equal(refuzat.session.bridge.allows("notify.show"), true, "manifestul le declara");
    assert.equal(await refuzat.session.shell.announce("salut"), false, "browserul le refuza");
    assert.match(String(refuzat.session.shell.lastError()), /permisiunea/);
    assert.deepEqual(refuzat.shown, []);
  } finally {
    refuzat.session.close();
  }

  const acceptat = await started();
  try {
    assert.equal(await acceptat.session.shell.announce("salut"), true);
    assert.deepEqual(acceptat.shown, ["Raptor Web Shell: salut"]);
  } finally {
    acceptat.session.close();
  }
});

test("fara capabilitatea de ferestre, aplicatia nici nu incearca sa navigheze", async () => {
  const context = await started({ capabilities: [] });
  try {
    assert.equal(await context.session.shell.goTo("/arhiva"), false);
    assert.deepEqual(context.pushed, []);
    assert.equal(context.session.shell.lastError(), null, "nu a fost o eroare, ci o functie inexistenta");
  } finally {
    context.session.close();
  }
});

test("aceeasi aplicatie, alt host: contractul de shell este identic cu cel nativ", async () => {
  const context = await started();
  try {
    // Aceleasi metode ca in desktop-shell si mobile-shell, cu aceleasi tipuri.
    const shell = context.session.shell;
    assert.equal(typeof shell.start, "function");
    assert.equal(typeof shell.addNote, "function");
    assert.equal(typeof shell.announce, "function");
    assert.equal(typeof shell.route, "function");
    assert.equal(typeof shell.lifecycle, "function");

    const description = await context.session.bridge.describe();
    assert.equal(description.target, "web");
    assert.ok(description.implemented.includes("storage.set"));
    assert.ok(!description.implemented.includes("menu.set"));
  } finally {
    context.session.close();
  }
});
