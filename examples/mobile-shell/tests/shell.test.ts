import test from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, newStats, resetStats, stats } from "raptorjs/dom/testing";
import { render } from "raptorjs/dom";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";

const doc = installMiniDom();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

async function started(options: Parameters<typeof createSession>[0] = {}): Promise<Session> {
  const session = createSession(options);
  await session.shell.start();
  session.host.lifecycle.to("ready");
  session.host.lifecycle.to("foreground");
  await tick();
  return session;
}

test("aplicatia afla la pornire pe ce ecran a deschis-o adaptorul", async () => {
  const session = await started({ initialRoute: "/note/7" });
  try {
    assert.equal(session.shell.route(), "/note/7", "ruta initiala nu se presupune, se cere");
    assert.equal(session.shell.lifecycle(), "foreground");
  } finally {
    session.close();
  }
});

test("navigarea vine de la adaptor, inclusiv back-ul sistemului", async () => {
  const session = await started({ initialRoute: "/note" });
  try {
    session.host.navigate("/note/1");
    await tick();
    assert.equal(session.shell.route(), "/note/1");

    session.host.navigate("/note/1/poza");
    await tick();
    assert.equal(session.shell.route(), "/note/1/poza");

    assert.equal(session.host.back(), true);
    await tick();
    assert.equal(session.shell.route(), "/note/1", "gestul de back a mutat ecranul, fara sa treaca prin JS");

    assert.equal(session.host.back(), true);
    await tick();
    assert.equal(session.host.back(), false, "din ecranul radacina nu se mai iese");
    assert.deepEqual(session.host.stack, ["/note"]);
  } finally {
    session.close();
  }
});

test("aplicatia nu are voie sa conduca ea navigarea", async () => {
  const session = await started();
  try {
    // Sectiunea 6: ferestrele si meniurile nu exista pe mobil, iar ruta este a
    // adaptorului. A citi ruta este permis; a o schimba nu are nici macar metoda.
    assert.equal(session.bridge.allows("window.open"), false);
    assert.equal(session.bridge.allows("window.navigate"), false);
    assert.equal(session.bridge.allows("menu.set"), false);
    assert.equal(session.bridge.allows("navigation.current"), true);

    await assert.rejects(
      session.bridge.call("window.navigate", { id: "w1", url: "/altundeva" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
    await assert.rejects(
      session.bridge.call("navigation.push", { route: "/altundeva" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/method-unknown",
    );
  } finally {
    session.close();
  }
});

test("notele traiesc in magazinul securizat al platformei si supravietuiesc repornirii", async () => {
  const secureStore = new Map<string, string>();
  const first = await started({ secureStore });
  try {
    await first.shell.addNote("prima");
    assert.equal(secureStore.get("notes"), '[{"text":"prima","photo":null}]');
  } finally {
    first.close();
  }

  const second = await started({ secureStore });
  try {
    assert.deepEqual(second.shell.notes(), [{ text: "prima", photo: null }]);
  } finally {
    second.close();
  }
});

test("camera este un modul optional: fara ea aplicatia merge, doar fara poze", async () => {
  const fara = await started({ capabilities: ["device.notifications"] });
  try {
    await fara.shell.addNote("fara poza");
    assert.equal(await fara.shell.attachPhoto(), false, "aplicatia afla ca nu poate, fara sa crape");
    assert.equal(fara.shell.notes()[0]?.photo, null);
  } finally {
    fara.close();
  }

  const cu = await started({ capabilities: ["device.notifications", "device.camera"] });
  try {
    await cu.shell.addNote("cu poza");
    assert.equal(await cu.shell.attachPhoto(), true);
    assert.match(String(cu.shell.notes()[0]?.photo), /^foto-\d+$/);
  } finally {
    cu.close();
  }
});

test("ciclul de viata al telefonului: fundal, suspendare si reluare, fara oprire", async () => {
  const session = await started();
  try {
    const stari: string[] = [];
    session.bridge.on("lifecycle.changed", (payload) => stari.push(String(payload["state"])));

    session.host.lifecycle.to("background");
    session.host.lifecycle.to("suspended");
    await tick();
    assert.equal(session.shell.lifecycle(), "suspended");

    session.host.lifecycle.to("foreground");
    await tick();
    assert.deepEqual(stari, ["background", "suspended", "foreground"]);
    assert.notEqual(session.host.lifecycle.state, "stopped", "suspendarea nu inchide aplicatia");
  } finally {
    session.close();
  }
});

test("o cerere de oprire trimite aplicatia in fundal, nu o inchide", async () => {
  const session = await started();
  try {
    const raspuns = (await session.bridge.call("lifecycle.requestStop")) as { state: string };
    assert.equal(raspuns.state, "background", "sistemul decide suspendarea, nu aplicatia");
  } finally {
    session.close();
  }
});

test("deep link-urile declarate ajung in aplicatie, restul nu", async () => {
  const session = await started();
  try {
    session.host.deliverDeepLink("raptor-shell://nota/3");
    await tick();
    assert.equal(session.shell.lastLink(), "raptor-shell://nota/3");
    assert.throws(() => session.host.deliverDeepLink("altceva://nota/3"), /nu este declarata/);
  } finally {
    session.close();
  }
});

test("actualizarile sunt ale magazinului, nu ale aplicatiei", async () => {
  const session = await started();
  try {
    assert.deepEqual(await session.bridge.call("update.check"), {
      available: false,
      version: "0.1.0",
      managedBy: "store",
    });
  } finally {
    session.close();
  }
});

test("randarea ramane fine-grained cand adaptorul schimba ecranul si starea", async () => {
  const session = await started({ initialRoute: "/note" });
  try {
    const root = doc.createElement("div");
    render(() => session.shell.view(doc as never) as never, root);
    assert.ok(stats.createElement > 0, "prima randare chiar construieste ceva");

    resetStats();
    await session.shell.addNote("una");
    session.host.navigate("/note/1");
    session.host.lifecycle.to("background");
    session.host.deliverDeepLink("raptor-shell://nota/1");
    await tick();

    assert.equal(stats.createElement, 0, "niciun element nou dupa patru schimbari");
    assert.ok(stats.textUpdate > 0);
    assert.match(root.toHTML(), /ecran: \/note\/1/);
    assert.match(root.toHTML(), /stare: background - 1 note/);
  } finally {
    resetStats();
    Object.assign(stats, newStats());
    session.close();
  }
});
