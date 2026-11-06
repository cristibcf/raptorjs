/**
 * Server-Sent Events, both ends (v0.2.1).
 *
 * The parser is small; what makes it worth shipping once rather than writing
 * per application is that the failure modes are invisible until production.
 * Every test here is one of them: a frame cut in half by a chunk boundary, a
 * multi-line `data:` reassembled with the newlines the protocol specifies, the
 * comment lines a proxy needs and a consumer must not see, the `[DONE]`
 * sentinel nobody standardized, and an abort that has to release the body
 * rather than leak it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  EVENT_STREAM_HEADERS,
  openEventStream,
  readEventStream,
  writeEventStream,
  type EventStreamSink,
  type SseEvent,
} from "../../src/sse/index.ts";

/** A body delivered exactly in the chunks given, so boundaries are the test's. */
function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i++]!;
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
  });
}

async function collect(
  chunks: (string | Uint8Array)[],
  options?: Parameters<typeof readEventStream>[1],
): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const event of readEventStream(streamOf(chunks), options)) out.push(event);
  return out;
}

/** A sink that records exactly what was written, as one string. */
function recordingSink(): EventStreamSink & { readonly text: () => string; readonly ended: () => boolean } {
  const parts: string[] = [];
  let ended = false;
  const headers: Record<string, string> = {};
  return {
    write: (chunk) => void parts.push(chunk),
    end: () => void (ended = true),
    writeHead: (_status, given) => void Object.assign(headers, given),
    text: () => parts.join(""),
    ended: () => ended,
  };
}

/* ----------------------------------------------------------------- reader - */

test("sse: a frame split across two chunks is one event", async () => {
  // The split lands mid-field name, mid-payload and mid-terminator in turn.
  const events = await collect(["event: delta\nda", 'ta: {"text":"he', 'llo"}\n', "\n"]);
  assert.deepEqual(events, [{ event: "delta", data: '{"text":"hello"}' }]);
});

test("sse: a multi-byte character straddling a chunk boundary survives", async () => {
  const bytes = new TextEncoder().encode("data: café — naïve\n\n");
  const cut = 9; // inside the combining acute accent
  const events = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
  assert.deepEqual(events, [{ event: "message", data: "café — naïve" }]);
});

test("sse: multi-line data is joined with newlines, not concatenated", async () => {
  const events = await collect(["data: first\ndata: second\ndata:\ndata: fourth\n\n"]);
  assert.deepEqual(events, [{ event: "message", data: "first\nsecond\n\nfourth" }]);
});

test("sse: comment heartbeats are ignored unless asked for", async () => {
  const body = [": keep-alive\n", "data: one\n\n", ":\n", ":\n", "data: two\n\n"];
  assert.deepEqual(
    (await collect(body)).map((e) => e.data),
    ["one", "two"],
    "a heartbeat is not a message",
  );
  assert.deepEqual(
    (await collect(body, { includeComments: true })).map((e) => `${e.event}:${e.data}`),
    ["comment:keep-alive", "message:one", "comment:", "comment:", "message:two"],
  );
});

test("sse: the [DONE] sentinel ends the iteration without being yielded", async () => {
  const events = await collect(
    ["data: one\n\n", "data: two\n\n", "data: [DONE]\n\n", "data: never\n\n"],
    { doneSentinel: "[DONE]" },
  );
  assert.deepEqual(
    events.map((e) => e.data),
    ["one", "two"],
  );
  // Without the option it is just another event: the sentinel is a convention,
  // not part of the protocol.
  const raw = await collect(["data: one\n\n", "data: [DONE]\n\n"]);
  assert.deepEqual(
    raw.map((e) => e.data),
    ["one", "[DONE]"],
  );
});

test("sse: id and retry are carried, and id persists as stream state", async () => {
  const events = await collect(["id: 7\nretry: 2500\ndata: one\n\n", "data: two\n\n", "id: bad\u0000id\ndata: three\n\n"]);
  assert.deepEqual(events[0], { event: "message", data: "one", id: "7", retry: 2500 });
  assert.deepEqual(events[1], { event: "message", data: "two", id: "7" }, "the last id is stream state");
  assert.equal(events[2]!.id, "7", "an id containing NUL is ignored, per the protocol");
});

test("sse: all three line terminators are accepted, and an unterminated event is discarded", async () => {
  assert.deepEqual(
    (await collect(["data: a\r\n\r\ndata: b\n\ndata: c\r\rdata: d"])).map((e) => e.data),
    ["a", "b", "c"],
    "the trailing frame never got its blank line",
  );
});

test("sse: breaking out of the loop cancels the body", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(encoder.encode("data: tick\n\n"));
    },
    cancel() {
      cancelled = true;
    },
  });

  const seen: string[] = [];
  for await (const event of readEventStream(body)) {
    seen.push(event.data);
    if (seen.length === 3) break; // the consumer aborts mid-stream
  }
  assert.deepEqual(seen, ["tick", "tick", "tick"]);
  assert.equal(cancelled, true, "an abandoned stream must not leak the connection");
});

test("sse: a response without a body is a clear error, not an empty stream", async () => {
  await assert.rejects(
    async () => {
      for await (const _ of readEventStream(new Response(null, { status: 204 }))) break;
    },
    /no body/,
  );
});

/* ----------------------------------------------------------------- writer - */

test("sse: the writer frames events the way the reader expects", () => {
  const sink = recordingSink();
  const stream = writeEventStream(sink, { heartbeatMs: 0 });

  stream.send({ delta: "hi" });
  stream.send("plain text", { event: "note", id: "9", retry: 1000 });
  stream.comment("keep-alive");
  stream.close("[DONE]");

  assert.equal(
    sink.text(),
    'data: {"delta":"hi"}\n\n' +
      "event: note\nid: 9\nretry: 1000\ndata: plain text\n\n" +
      ": keep-alive\n\n" +
      "data: [DONE]\n\n",
  );
  assert.equal(sink.ended(), true);
  assert.equal(stream.open, false);
  // Sending after close is a no-op, not a throw: a stream that ended early
  // should not take the request handler down with it.
  stream.send("late");
  assert.ok(!sink.text().includes("late"));
});

test("sse: a payload with newlines becomes several data lines", async () => {
  const sink = recordingSink();
  const stream = writeEventStream(sink, { heartbeatMs: 0 });
  stream.send("line one\nline two\r\nline three");
  stream.close();

  assert.equal(sink.text(), "data: line one\ndata: line two\ndata: line three\n\n");
  // And it round-trips: a raw newline inside `data` would have ended the line.
  const events = await collect([sink.text()]);
  assert.deepEqual(events, [{ event: "message", data: "line one\nline two\nline three" }]);
});

test("sse: the headers include what a proxy needs", () => {
  assert.equal(EVENT_STREAM_HEADERS["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(EVENT_STREAM_HEADERS["x-accel-buffering"], "no", "or nginx buffers the whole stream");
  assert.equal(EVENT_STREAM_HEADERS["cache-control"], "no-cache, no-transform");
});

/* -------------------------------------------------------- end to end, POST - */

test("sse: a POST that returns an event stream, over a real server", async () => {
  const http: Server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const body = await new Promise<string>((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += String(chunk)));
      req.on("end", () => resolve(raw));
    });
    const { prompt } = JSON.parse(body) as { prompt: string };
    // A node:http ServerResponse satisfies EventStreamSink structurally.
    const stream = writeEventStream(res, { heartbeatMs: 0 });
    stream.comment("keep-alive");
    for (const word of prompt.split(" ")) stream.send({ delta: word });
    stream.close("[DONE]");
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;

  try {
    const events = await openEventStream(
      `http://127.0.0.1:${port}/chat`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "one two three" }) },
      { doneSentinel: "[DONE]" },
    );
    const deltas: string[] = [];
    for await (const event of events) deltas.push((JSON.parse(event.data) as { delta: string }).delta);
    assert.deepEqual(deltas, ["one", "two", "three"], "the heartbeat and the sentinel stayed out of the way");
  } finally {
    http.close();
  }
});

test("sse: a non-2xx fails where the stream started, with the body in the message", async () => {
  const http: Server = createServer((_req, res) => {
    res.writeHead(402, { "content-type": "text/plain" }).end("out of credits");
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;
  try {
    await assert.rejects(() => openEventStream(`http://127.0.0.1:${port}/chat`), /402.*out of credits/);
  } finally {
    http.close();
  }
});
