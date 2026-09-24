import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";

/** Sesiune pornita, cu server real pe un port liber. */
async function started(options: Parameters<typeof createSession>[0] = {}): Promise<Session> {
  const session = createSession({ ports: { public: 0 }, ...options });
  await session.service.start();
  return session;
}

const get = async (session: Session, path: string): Promise<Response> =>
  await fetch(`${session.service.url()}${path}`);

const post = async (session: Session, path: string, body: unknown): Promise<Response> =>
  await fetch(`${session.service.url()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("pornirea cere listenerul host-ului si se declara gata de trafic", async () => {
  const session = await started();
  try {
    assert.match(session.service.url() ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(session.service.ready(), true);
    assert.equal(session.host.health, "ready");
    assert.equal(session.host.lifecycle.state, "foreground", "un serviciu care serveste este in 'foreground'");
  } finally {
    await session.close();
  }
});

test("cererile HTTP reale traverseaza puntea si se intorc cu raspuns", async () => {
  const session = await started();
  try {
    const health = (await (await get(session, "/health")).json()) as { status: string; notes: number };
    assert.equal(health.status, "ready");
    assert.equal(health.notes, 0);
  } finally {
    await session.close();
  }
});

test("o nota trece prin stocarea host-ului inainte sa fie vizibila prin API", async () => {
  const storage = new Map<string, string>();
  const session = await started({ storage });
  try {
    const created = await post(session, "/note", { text: "de scris raportul" });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { stored: 1 });

    assert.match(storage.get("notes") ?? "", /de scris raportul/);
    const listed = (await (await get(session, "/note")).json()) as { notes: Array<{ text: string }> };
    assert.deepEqual(listed.notes.map((note) => note.text), ["de scris raportul"]);
  } finally {
    await session.close();
  }
});

test("notele supravietuiesc repornirii, pentru ca traiesc la host", async () => {
  const storage = new Map<string, string>();
  const first = await started({ storage });
  try {
    await post(first, "/note", { text: "persistenta" });
  } finally {
    await first.close();
  }

  const second = await started({ storage });
  try {
    const listed = (await (await get(second, "/note")).json()) as { notes: Array<{ text: string }> };
    assert.deepEqual(listed.notes.map((note) => note.text), ["persistenta"]);
  } finally {
    await second.close();
  }
});

test("configuratia vine de la supervizor si se vede in raspuns", async () => {
  const session = await started({ config: { GREETING: "Salut din deployment" } });
  try {
    const listed = (await (await get(session, "/note")).json()) as { greeting: string };
    assert.equal(listed.greeting, "Salut din deployment");
  } finally {
    await session.close();
  }

  const fara = await started();
  try {
    const listed = (await (await get(fara, "/note")).json()) as { greeting: string };
    assert.equal(listed.greeting, "Raptor Service", "fara configuratie, ramane implicitul aplicatiei");
  } finally {
    await fara.close();
  }
});

test("intrarile invalide primesc 400, rutele inexistente 404", async () => {
  const session = await started();
  try {
    assert.equal((await post(session, "/note", {})).status, 400);
    assert.equal((await post(session, "/note", { text: "   " })).status, 400);
    assert.equal((await get(session, "/inexistent")).status, 404);

    const corupt = await fetch(`${session.service.url()}/note`, { method: "POST", body: "nu e json" });
    assert.equal(corupt.status, 400, "un corp corupt nu darama serviciul");

    // Dupa toate refuzurile, serviciul raspunde in continuare normal.
    assert.equal((await get(session, "/health")).status, 200);
  } finally {
    await session.close();
  }
});

test("starea reactiva a serviciului urmareste traficul", async () => {
  const session = await started();
  try {
    assert.equal(session.service.served(), 0);
    await get(session, "/health");
    await post(session, "/note", { text: "una" });
    assert.equal(session.service.served(), 2);
    assert.equal(session.service.summary(), "ready - 1 note, 2 cereri");
  } finally {
    await session.close();
  }
});

test("drenarea termina cererile in zbor si inchide portul pentru cele noi", async () => {
  const session = await started();
  try {
    const url = session.service.url()!;
    await post(session, "/note", { text: "inainte de oprire" });

    await session.host.requestDrain("SIGTERM");
    assert.equal(session.host.health, "draining");
    assert.deepEqual(session.host.lifecycle.history, [
      "launching",
      "ready",
      "foreground",
      "background",
      "stopped",
    ]);

    await assert.rejects(fetch(`${url}/health`), "portul nu mai accepta cereri noi");
  } finally {
    await session.close();
  }
});

test("serviciul poate fi oprit si din aplicatie, tot prin drenare", async () => {
  const session = await started();
  try {
    await session.service.stop();
    assert.equal(session.service.ready(), false);
    assert.equal(session.host.health, "unhealthy", "declarat nesanatos inainte de a inchide socketul");
    assert.equal(session.host.listeners.length, 0);
  } finally {
    await session.close();
  }
});

test("un serviciu nu are voie la ce tine de interfata grafica", async () => {
  const session = await started();
  try {
    for (const method of ["window.open", "notify.show", "camera.capture", "device.files"]) {
      assert.equal(session.bridge.allows(method), false, `${method} nu are ce cauta pe un server`);
    }
    await assert.rejects(
      session.bridge.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    await session.close();
  }
});
