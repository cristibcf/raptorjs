/**
 * Primele teste ale lui `@raptor/wire-client`.
 *
 * Pachetul a stat fara niciun test pana la auditul din 2026-09-24 (S10), desi e
 * tocmai componentul care ia octeti de la un peer si ii aplica pe starea locala.
 * Consecinta directa: fixul #3 din auditul din 21 septembrie - clientul
 * fail-closed la cadre corupte - nu avea nimic care sa-l apere de un refactor.
 *
 * Testele folosesc un server fals scris direct peste `Transport`, nu
 * `@raptor/server`: aici ne intereseaza ce face CLIENTUL cand primeste ceva,
 * inclusiv ceva ce un server cinstit n-ar trimite niciodata.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { effect, createRoot } from "raptorjs";
import { Document, encodeMessage, encodeOpsFrame, AddressBook, type Operation } from "@raptor/wire";
import { RaptorClient, createLoopback, flushLoopback, type Transport } from "../../src/client/index.ts";

/**
 * Celalalt capat al firului, sub controlul testului.
 *
 * `received` pastreaza tot ce a trimis clientul, ca sa putem verifica si ce NU
 * a trimis - de exemplu ca nu confirma un cadru pe care l-a aruncat.
 */
interface Peer {
  readonly client: RaptorClient;
  readonly received: Uint8Array[];
  send(bytes: Uint8Array): void;
  close(): void;
}

function peer(options: ConstructorParameters<typeof RaptorClient>[1] = {}): Peer {
  const loop = createLoopback();
  const received: Uint8Array[] = [];
  loop.server.onMessage((bytes) => received.push(bytes));
  const client = new RaptorClient(loop.client, options);
  return {
    client,
    received,
    send: (bytes) => loop.server.send(bytes),
    close: () => {
      loop.client.close();
      loop.server.close();
    },
  };
}

/** Un WELCOME minim, ca handshake-ul sa se poata incheia. */
function welcome(sessionId = "s1", epoch = 1): Uint8Array {
  return encodeMessage({ type: "welcome", sessionId, epoch, serverBuild: "test" });
}

async function connected(options: ConstructorParameters<typeof RaptorClient>[1] = {}): Promise<Peer> {
  const p = peer(options);
  const handshake = p.client.connect();
  await flushLoopback();
  p.send(welcome());
  await handshake;
  return p;
}

/* ------------------------------------------------------------- handshake -- */

test("handshake-ul se incheie abia la WELCOME, nu la trimiterea lui HELLO", async () => {
  const p = peer();
  try {
    let gata = false;
    const handshake = p.client.connect().then(() => (gata = true));

    await flushLoopback();
    assert.equal(gata, false, "HELLO trimis nu inseamna sesiune deschisa");
    assert.equal(p.received.length, 1, "clientul a trimis exact un HELLO");

    p.send(welcome("sesiune-7", 3));
    await handshake;

    assert.equal(gata, true);
    assert.equal(p.client.sessionId, "sesiune-7");
    assert.equal(p.client.epoch, 3);
  } finally {
    p.close();
  }
});

/* -------------------------------------------------- fail-closed (audit #3) -- */

test("un cadru corupt este ignorat, nu arunca (fail-closed, §21)", async () => {
  const p = await connected();
  const erori: unknown[] = [];
  const onUnhandled = (error: unknown): void => {
    erori.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);

  // `console.warn` e inlocuit ca iesirea testului sa ramana curata, dar si ca sa
  // verificam ca refuzul chiar e raportat, nu inghitit in tacere.
  const avertismente: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void avertismente.push(args.map(String).join(" "));

  try {
    // Trei forme de gunoi: octeti fara sens, un frame trunchiat, si unul gol.
    p.send(new Uint8Array([0xff, 0xfe, 0xfd, 0x07, 0x42]));
    p.send(new Uint8Array([0x01]));
    p.send(new Uint8Array([]));
    await flushLoopback();

    assert.deepEqual(erori, [], "nicio exceptie nu a scapat in microtask");
    assert.ok(avertismente.length >= 1, "cadrul aruncat e raportat, nu inghitit");
    assert.ok(avertismente.every((line) => line.includes("[raptor]")), avertismente.join(" | "));
  } finally {
    console.warn = realWarn;
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
    p.close();
  }
});

test("dupa un cadru corupt, sesiunea ramane utilizabila", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  const p = await connected();
  try {
    p.send(new Uint8Array([0xff, 0xff, 0xff]));
    await flushLoopback();

    // Acelasi client primeste acum un snapshot valid si il aplica.
    const doc = new Document();
    doc.set("cpu", 41);
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: doc.encodeSnapshot() }));
    await flushLoopback();

    assert.equal(p.client.signal("cpu")(), 41, "un cadru aruncat nu otraveste sesiunea");
  } finally {
    console.warn = realWarn;
    p.close();
  }
});

/* ------------------------------------------------------------- replica ---- */

test("snapshot-ul umple replica, iar semnalele cerute dinainte se actualizeaza", async () => {
  const p = await connected();
  try {
    // Semnalul e cerut INAINTE sa existe valoarea: cazul real dintr-o componenta
    // montata inainte sa soseasca snapshot-ul.
    const cpu = p.client.signal<number>("cpu");
    assert.equal(cpu(), undefined);

    const doc = new Document();
    doc.set("cpu", 12);
    doc.set("mem", 64);
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: doc.encodeSnapshot() }));
    await flushLoopback();

    assert.equal(cpu(), 12);
    assert.equal(p.client.signal("mem")(), 64);
    assert.equal(p.client.snapshotsReceived, 1);
  } finally {
    p.close();
  }
});

test("un frame de operatii produce UN singur commit, oricate handle-uri atinge", async () => {
  const p = await connected();
  try {
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: new Document().encodeSnapshot() }));
    await flushLoopback();

    // Numaram rulari de effect peste TREI semnale atinse de acelasi frame.
    let rulari = 0;
    const dispose = createRoot((dispose) => {
      effect(() => {
        p.client.signal("a")();
        p.client.signal("b")();
        p.client.signal("c")();
        rulari++;
      });
      return dispose;
    });
    const dupaMontare = rulari;

    const book = new AddressBook();
    // `replace` pentru ca handle-urile astea sunt scalari: `set` tinteste un
    // FIELD dintr-un obiect (`handle.field`), nu handle-ul insusi.
    const ops: Operation[] = [
      { kind: "replace", handle: "a", value: 1 },
      { kind: "replace", handle: "b", value: 2 },
      { kind: "replace", handle: "c", value: 3 },
    ];
    p.send(
      encodeOpsFrame(book, {
        type: "ops",
        queryId,
        sequence: 1,
        batch: { baseVersion: 0, resultVersion: 3, atomic: true, ops },
      }),
    );
    await flushLoopback();

    assert.equal(p.client.signal("a")(), 1);
    assert.equal(p.client.signal("c")(), 3);
    assert.equal(
      rulari - dupaMontare,
      1,
      "tranzactia de retea trebuie sa fie un singur commit UI, nu unul per handle",
    );
    dispose();
  } finally {
    p.close();
  }
});

test("o gaura de secventa este raportata, nu ascunsa", async () => {
  const gauri: Array<{ expected: number; received: number }> = [];
  const p = await connected({ onGap: (_queryId, expected, received) => void gauri.push({ expected, received }) });
  try {
    const queryId = p.client.subscribe("metrics");
    await flushLoopback();
    p.send(encodeMessage({ type: "snapshot", queryId, snapshot: new Document().encodeSnapshot() }));
    await flushLoopback();

    const book = new AddressBook();
    const frame = (sequence: number, value: number, base: number): Uint8Array =>
      encodeOpsFrame(book, {
        type: "ops",
        queryId,
        sequence,
        batch: { baseVersion: base, resultVersion: base + 1, ops: [{ kind: "replace", handle: "a", value }] },
      });

    p.send(frame(1, 1, 0));
    await flushLoopback();
    // Sarim peste 2: exact situatia in care replica ar diverge tacut.
    p.send(frame(3, 3, 1));
    await flushLoopback();

    assert.deepEqual(gauri, [{ expected: 2, received: 3 }]);
  } finally {
    p.close();
  }
});

/* -------------------------------------------------------------- mutatii --- */

test("mutatia se rezolva cu rezultatul corelat, nu cu primul care vine", async () => {
  const p = await connected();
  try {
    const prima = p.client.mutate("adauga", { text: "a" });
    const aDoua = p.client.mutate("adauga", { text: "b" });
    await flushLoopback();

    // Raspunsurile vin INVERSATE fata de ordinea cererilor.
    p.send(encodeMessage({ type: "mutationResult", requestId: 2, ok: true, value: "al-doilea" }));
    p.send(encodeMessage({ type: "mutationResult", requestId: 1, ok: false, value: "primul" }));
    await flushLoopback();

    assert.deepEqual(await aDoua, { ok: true, value: "al-doilea" });
    assert.deepEqual(await prima, { ok: false, value: "primul" }, "corelarea se face pe requestId, nu pe ordine");
  } finally {
    p.close();
  }
});

/* -------------------------------------------------------------- transport - */

test("transportul inchis nu mai livreaza nimic in niciun sens", async () => {
  const loop = createLoopback();
  const primite: Uint8Array[] = [];
  loop.server.onMessage((bytes) => primite.push(bytes));

  loop.client.send(new Uint8Array([1]));
  await flushLoopback();
  assert.equal(primite.length, 1);

  loop.client.close();
  loop.client.send(new Uint8Array([2]));
  await flushLoopback();
  assert.equal(primite.length, 1, "un capat inchis nu mai trimite");
});

test("loopback-ul copiaza octetii, deci o mutatie dupa send nu se vede la celalalt capat", async () => {
  const loop = createLoopback();
  let vazut: Uint8Array | null = null;
  loop.server.onMessage((bytes) => (vazut = bytes));

  const bytes = new Uint8Array([1, 2, 3]);
  loop.client.send(bytes);
  bytes[0] = 99; // reutilizarea bufferului dupa trimitere
  await flushLoopback();

  assert.deepEqual([...(vazut as unknown as Uint8Array)], [1, 2, 3], "receptorul vede ce s-a trimis, nu ce a urmat");
});

test("statisticile numara ambele sensuri separat", async () => {
  const loop = createLoopback();
  loop.server.onMessage(() => {});
  loop.client.onMessage(() => {});

  loop.client.send(new Uint8Array(10));
  loop.server.send(new Uint8Array(4));
  loop.server.send(new Uint8Array(6));
  await flushLoopback();

  assert.equal(loop.stats.clientToServerBytes, 10);
  assert.equal(loop.stats.clientToServerMessages, 1);
  assert.equal(loop.stats.serverToClientBytes, 10);
  assert.equal(loop.stats.serverToClientMessages, 2);
});

test("un transport propriu are nevoie de exact trei metode", async () => {
  // Contractul e mic dinadins: cine vrea WebSocket real, QUIC sau un canal de
  // worker implementeaza asta, nu o clasa de baza.
  const trimise: Uint8Array[] = [];
  let livreaza: ((data: Uint8Array) => void) | null = null;
  const propriu: Transport = {
    send: (data) => void trimise.push(data),
    onMessage: (handler) => void (livreaza = handler),
    close: () => {},
  };

  const client = new RaptorClient(propriu);
  const handshake = client.connect();
  assert.equal(trimise.length, 1, "HELLO a plecat prin transportul propriu");

  (livreaza as unknown as (data: Uint8Array) => void)(welcome("prin-transport-propriu"));
  await handshake;
  assert.equal(client.sessionId, "prin-transport-propriu");
});
