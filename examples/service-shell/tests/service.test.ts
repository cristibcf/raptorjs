import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.ts";
import type { Session } from "../src/session.ts";

/** A started session, with a real server on a free port. */
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

test("startup requests the host's listener and declares itself ready for traffic", async () => {
  const session = await started();
  try {
    assert.match(session.service.url() ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(session.service.ready(), true);
    assert.equal(session.host.health, "ready");
    assert.equal(session.host.lifecycle.state, "foreground", "a service that is serving is in 'foreground'");
  } finally {
    await session.close();
  }
});

test("real HTTP requests cross the bridge and come back with a response", async () => {
  const session = await started();
  try {
    const health = (await (await get(session, "/health")).json()) as { status: string; notes: number };
    assert.equal(health.status, "ready");
    assert.equal(health.notes, 0);
  } finally {
    await session.close();
  }
});

test("a note goes through the host's storage before it is visible through the API", async () => {
  const storage = new Map<string, string>();
  const session = await started({ storage });
  try {
    const created = await post(session, "/note", { text: "write the report" });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { stored: 1 });

    assert.match(storage.get("notes") ?? "", /write the report/);
    const listed = (await (await get(session, "/note")).json()) as { notes: Array<{ text: string }> };
    assert.deepEqual(listed.notes.map((note) => note.text), ["write the report"]);
  } finally {
    await session.close();
  }
});

test("notes survive a restart, because they live at the host", async () => {
  const storage = new Map<string, string>();
  const first = await started({ storage });
  try {
    await post(first, "/note", { text: "persistent" });
  } finally {
    await first.close();
  }

  const second = await started({ storage });
  try {
    const listed = (await (await get(second, "/note")).json()) as { notes: Array<{ text: string }> };
    assert.deepEqual(listed.notes.map((note) => note.text), ["persistent"]);
  } finally {
    await second.close();
  }
});

test("configuration comes from the supervisor and shows up in the response", async () => {
  const session = await started({ config: { GREETING: "Hello from deployment" } });
  try {
    const listed = (await (await get(session, "/note")).json()) as { greeting: string };
    assert.equal(listed.greeting, "Hello from deployment");
  } finally {
    await session.close();
  }

  const fara = await started();
  try {
    const listed = (await (await get(fara, "/note")).json()) as { greeting: string };
    assert.equal(listed.greeting, "Raptor Service", "without configuration, the app's default stays");
  } finally {
    await fara.close();
  }
});

test("invalid inputs get 400, nonexistent routes 404", async () => {
  const session = await started();
  try {
    assert.equal((await post(session, "/note", {})).status, 400);
    assert.equal((await post(session, "/note", { text: "   " })).status, 400);
    assert.equal((await get(session, "/inexistent")).status, 404);

    const corupt = await fetch(`${session.service.url()}/note`, { method: "POST", body: "not json" });
    assert.equal(corupt.status, 400, "a corrupt body does not bring the service down");

    // After all the rejections, the service still responds normally.
    assert.equal((await get(session, "/health")).status, 200);
  } finally {
    await session.close();
  }
});

test("the service's reactive state tracks traffic", async () => {
  const session = await started();
  try {
    assert.equal(session.service.served(), 0);
    await get(session, "/health");
    await post(session, "/note", { text: "one" });
    assert.equal(session.service.served(), 2);
    assert.equal(session.service.summary(), "ready - 1 notes, 2 requests");
  } finally {
    await session.close();
  }
});

test("draining finishes in-flight requests and closes the port to new ones", async () => {
  const session = await started();
  try {
    const url = session.service.url()!;
    await post(session, "/note", { text: "before shutdown" });

    await session.host.requestDrain("SIGTERM");
    assert.equal(session.host.health, "draining");
    assert.deepEqual(session.host.lifecycle.history, [
      "launching",
      "ready",
      "foreground",
      "background",
      "stopped",
    ]);

    await assert.rejects(fetch(`${url}/health`), "the port no longer accepts new requests");
  } finally {
    await session.close();
  }
});

test("the service can also be stopped from the app, still through draining", async () => {
  const session = await started();
  try {
    await session.service.stop();
    assert.equal(session.service.ready(), false);
    assert.equal(session.host.health, "unhealthy", "declared unhealthy before closing the socket");
    assert.equal(session.host.listeners.length, 0);
  } finally {
    await session.close();
  }
});

test("a service is not allowed anything graphical-UI related", async () => {
  const session = await started();
  try {
    for (const method of ["window.open", "notify.show", "camera.capture", "device.files"]) {
      assert.equal(session.bridge.allows(method), false, `${method} has no business on a server`);
    }
    await assert.rejects(
      session.bridge.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    await session.close();
  }
});
