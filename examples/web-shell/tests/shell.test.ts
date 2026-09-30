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

test("at startup the app finds out which URL it was opened on", async () => {
  const context = await started();
  try {
    assert.equal(context.session.shell.route(), "/note");
    assert.equal(context.session.shell.summary(), "foreground - 0 notes on /note");
  } finally {
    context.session.close();
  }
});

test("the ability list tells the truth: capability granted AND method implemented", async () => {
  const context = await started();
  try {
    const abilities = await context.session.shell.abilities();
    assert.equal(abilities["window.navigate"], true);
    assert.equal(abilities["notify.show"], true);
    // The `window.manage` capability also covers menus, but a browser has no
    // application menu bar - so the honest answer is "no".
    assert.equal(abilities["menu.set"], false);
    assert.equal(context.session.bridge.allows("menu.set"), true, "the capability alone would have said 'yes'");
    assert.equal(abilities["process.spawn"], false);
    assert.equal(abilities["camera.capture"], false, "undeclared module");
  } finally {
    context.session.close();
  }
});

test("notes go into localStorage, under the app's prefix", async () => {
  const context = await started();
  try {
    await context.session.shell.addNote("first");
    assert.equal(
      context.store.get("com.raptor.web-shell:notes"),
      '[{"text":"first","route":"/note"}]',
      "the note also remembers the screen it was written on",
    );
  } finally {
    context.session.close();
  }
});

test("the app's navigation goes through the History API and updates the route", async () => {
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

test("a denied navigation is information for the UI, not a failure", async () => {
  const context = await started();
  try {
    assert.equal(await context.session.shell.goTo("https://atacator.example/x"), false);
    assert.match(String(context.session.shell.lastError()), /navigation denied/);
    assert.deepEqual(context.pushed, [], "nothing entered the history");
    // The app stays usable after the denial.
    assert.equal(await context.session.shell.goTo("/arhiva"), true);
    assert.equal(context.session.shell.lastError(), null);
  } finally {
    context.session.close();
  }
});

test("the back button changes the route out from under the app", async () => {
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

test("the user can deny notifications, even if the manifest declares them", async () => {
  const refuzat = await started({ permission: "denied" });
  try {
    assert.equal(refuzat.session.bridge.allows("notify.show"), true, "the manifest declares them");
    assert.equal(await refuzat.session.shell.announce("hello"), false, "the browser denies them");
    assert.match(String(refuzat.session.shell.lastError()), /permission/);
    assert.deepEqual(refuzat.shown, []);
  } finally {
    refuzat.session.close();
  }

  const acceptat = await started();
  try {
    assert.equal(await acceptat.session.shell.announce("hello"), true);
    assert.deepEqual(acceptat.shown, ["Raptor Web Shell: hello"]);
  } finally {
    acceptat.session.close();
  }
});

test("without the window capability, the app does not even try to navigate", async () => {
  const context = await started({ capabilities: [] });
  try {
    assert.equal(await context.session.shell.goTo("/arhiva"), false);
    assert.deepEqual(context.pushed, []);
    assert.equal(context.session.shell.lastError(), null, "it was not an error, but a nonexistent feature");
  } finally {
    context.session.close();
  }
});

test("same app, different host: the shell contract is identical to the native one", async () => {
  const context = await started();
  try {
    // The same methods as in desktop-shell and mobile-shell, with the same types.
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
