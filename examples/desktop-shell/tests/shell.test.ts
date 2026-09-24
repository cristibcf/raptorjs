import test from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, newStats, resetStats, stats } from "@raptor/dom/testing";
import { render } from "@raptor/dom";
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

test("pornirea cere host-ului o fereastra si un meniu, din aceeasi aplicatie RaptorJS", async () => {
  const session = await started();
  try {
    assert.equal(session.host.windows.length, 1);
    assert.equal(session.host.windows[0]?.title, "Raptor Desktop Shell");
    assert.equal(session.host.windows[0]?.width, 1024, "dimensiunile vin din raptor.host.json");
    assert.deepEqual(session.host.menu.map((item) => item.id), ["note.new", "app.quit"]);
    assert.equal(session.shell.lifecycle(), "foreground", "starea host-ului a ajuns in semnal");
  } finally {
    session.close();
  }
});

test("o nota trece prin stocarea host-ului inainte sa devina stare a aplicatiei", async () => {
  const storage = new Map<string, string>();
  const session = await started({ storage });
  try {
    await session.shell.addNote("prima");
    assert.deepEqual(session.shell.notes(), ["prima"]);
    assert.equal(storage.get("notes"), '["prima"]');
    assert.equal(session.host.windows[0]?.title, "Raptor Desktop Shell (1)");
  } finally {
    session.close();
  }
});

test("notele scrise supravietuiesc repornirii, pentru ca traiesc la host", async () => {
  const storage = new Map<string, string>();
  const first = await started({ storage });
  try {
    await first.shell.addNote("persistenta");
  } finally {
    first.close();
  }

  const second = await started({ storage });
  try {
    assert.deepEqual(second.shell.notes(), ["persistenta"], "a doua pornire citeste ce a scris prima");
  } finally {
    second.close();
  }
});

test("un modul optional lipsa lasa aplicatia sa functioneze, doar fara acea functie", async () => {
  const fara = await started({ capabilities: [] });
  try {
    assert.equal(await fara.shell.announce("salut"), false, "aplicatia afla ca nu poate, fara sa crape");
    assert.deepEqual(fara.host.notifications, []);
    await fara.shell.addNote("merge oricum");
    assert.deepEqual(fara.shell.notes(), ["merge oricum"]);
  } finally {
    fara.close();
  }

  const cu = await started({ capabilities: ["device.notifications"] });
  try {
    assert.equal(await cu.shell.announce("salut"), true);
    assert.equal(cu.host.notifications[0]?.body, "salut");
  } finally {
    cu.close();
  }
});

test("deep link-urile si comenzile de meniu ajung in aplicatie ca evenimente", async () => {
  const session = await started();
  try {
    session.host.deliverDeepLink("raptor-shell://nota/7");
    await tick();
    assert.equal(session.shell.lastLink(), "raptor-shell://nota/7");

    session.host.invokeMenu("note.new");
    await tick();
    await tick();
    assert.deepEqual(session.shell.notes(), ["nota 1"], "comanda de meniu a scris prin punte");
  } finally {
    session.close();
  }
});

test("randarea ramane fine-grained: evenimentele host-ului muta text, nu recreeaza noduri", async () => {
  const session = await started();
  try {
    const root = doc.createElement("div");
    render(() => session.shell.view(doc as never) as never, root);
    const before = { ...stats };
    assert.ok(before.createElement > 0, "prima randare chiar construieste ceva");

    resetStats();
    await session.shell.addNote("una");
    session.host.deliverDeepLink("raptor-shell://nota/1");
    session.host.lifecycle.to("background");
    await tick();

    assert.equal(stats.createElement, 0, "niciun element nou dupa trei schimbari de stare");
    assert.ok(stats.textUpdate > 0, "dar textul legat s-a actualizat");
    assert.match(root.toHTML(), /stare: background - 1 note/);
    assert.match(root.toHTML(), /raptor-shell:\/\/nota\/1/);
  } finally {
    resetStats();
    Object.assign(stats, newStats());
    session.close();
  }
});

test("aplicatia nu poate atinge ce nu i s-a acordat", async () => {
  const session = await started({ capabilities: ["device.notifications"] });
  try {
    await assert.rejects(
      session.bridge.call("camera.capture"),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
    await assert.rejects(
      session.bridge.call("window.navigate", { id: "w1", url: "https://atacator.example" }),
      /navigare refuzata/,
    );
  } finally {
    session.close();
  }
});
