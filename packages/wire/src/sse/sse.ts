/**
 * Server-Sent Events: a reader for the browser and a framer for the server.
 *
 * Why it lives in `wire`: this is the stack's networking package, and SSE is
 * the other wire protocol a Raptor application needs. RaptorWire carries
 * state - a known document plus semantic deltas - and is the right answer for
 * anything the server owns. A token stream from a model is not that: it is a
 * one-shot, one-way byte stream with no base state to delta against, and the
 * request that starts it is a POST with a body. Which is exactly where
 * `EventSource` is unusable: it only does GET, and cannot set a header. So the
 * frame parser gets hand-written, on both ends, in every application - and the
 * mistakes are always the same ones: a frame split across two chunks, a
 * multi-line `data:`, the comment lines proxies need.
 *
 * Zero dependencies and nothing from `node:`: the reader works on a `fetch`
 * body, and the writer frames into any sink with `write`/`end` - which a
 * `node:http` ServerResponse satisfies structurally, without being imported.
 */

/** One decoded event. The field names are the protocol's own. */
export interface SseEvent {
  /** The `event:` field, or `"message"` when the stream sent none. */
  event: string;
  /** The `data:` lines, joined with `"\n"` as the protocol specifies. */
  data: string;
  /** The `id:` field, when the stream sent one. */
  id?: string;
  /** The `retry:` field in ms, when the stream sent one. */
  retry?: number;
}

export interface EventStreamOptions {
  /**
   * Stop the iteration when an event's `data` equals this, without yielding
   * it. `"[DONE]"` is the de-facto sentinel every model API ends with; it is
   * not part of the protocol, which is why it is opt-in.
   */
  doneSentinel?: string;
  /** Yield comment lines too (`: keep-alive`), as `{ event: "comment" }`. */
  includeComments?: boolean;
}

/** The `event: comment` name used when `includeComments` is on. */
const COMMENT = "comment";

function streamOf(source: Response | ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  if (source instanceof ReadableStream) return source;
  if (!source.body) throw new Error("[raptor] sse: the response has no body");
  return source.body;
}

/**
 * Turns a `fetch` body into an async iterable of events.
 *
 * ```ts
 * const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify(prompt) });
 * for await (const event of readEventStream(res, { doneSentinel: "[DONE]" })) {
 *   append(JSON.parse(event.data).delta);
 * }
 * ```
 *
 * Breaking out of the loop cancels the body, so an abort mid-stream releases
 * the connection rather than leaking it. An event that the stream never
 * terminated with a blank line is discarded, as the protocol requires - a
 * half-received frame is not a message, and handing a consumer truncated JSON
 * would be worse than losing it.
 */
export async function* readEventStream(
  source: Response | ReadableStream<Uint8Array>,
  options: EventStreamOptions = {},
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = streamOf(source).getReader();
  const decoder = new TextDecoder();
  // Bytes received but not yet a complete line. The whole point of the parser:
  // a chunk boundary falls wherever the network puts it, not on a line.
  let buffer = "";
  let eventName = "";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  let sawFields = false;

  function flush(): SseEvent | null {
    if (!sawFields) return null;
    const event: SseEvent = { event: eventName || "message", data: data.join("\n") };
    if (id !== undefined) event.id = id;
    if (retry !== undefined) event.retry = retry;
    eventName = "";
    data = [];
    retry = undefined;
    sawFields = false;
    // `id` deliberately persists: the protocol keeps the last event id as
    // stream state, so a resume can send it back as `Last-Event-ID`.
    return event;
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      // `stream: true` keeps a multi-byte character that straddles two chunks
      // whole; decoding each chunk on its own would split it into mojibake.
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      // The protocol accepts "\r\n", "\n" and a lone "\r" as a line break.
      let match = /\r\n|\n|\r/.exec(buffer);
      while (match) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (line === "") {
          const event = flush();
          if (event) {
            if (options.doneSentinel !== undefined && event.data === options.doneSentinel) return;
            yield event;
          }
        } else if (line.startsWith(":")) {
          // A comment. This is what a heartbeat is: bytes that keep a proxy
          // from closing an idle stream, and that carry no message.
          if (options.includeComments) yield { event: COMMENT, data: line.slice(1).replace(/^ /, "") };
        } else {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          // Exactly one optional space after the colon is part of the framing.
          const raw = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          sawFields = true;
          if (field === "data") data.push(raw);
          else if (field === "event") eventName = raw;
          else if (field === "id") {
            // An id containing NUL must be ignored (protocol rule).
            if (!raw.includes("\u0000")) id = raw;
          } else if (field === "retry") {
            if (/^\d+$/.test(raw)) retry = Number(raw);
          }
          // Any other field name is ignored, as the protocol says to.
        }
        match = /\r\n|\n|\r/.exec(buffer);
      }

      if (done) return;
    }
  } finally {
    // Runs on `break`, on `return` and on a throw: the generator's cleanup is
    // where an abort mid-stream actually releases the connection.
    await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
}

/**
 * Opens an event stream over any request - a POST with a JSON body included,
 * which is what `EventSource` cannot do and the reason this exists.
 *
 * Throws on a non-2xx, with the response body in the message, so a failed
 * stream fails where it started instead of looking like an empty one.
 */
export async function openEventStream(
  url: string,
  init: RequestInit = {},
  options: EventStreamOptions = {},
): Promise<AsyncGenerator<SseEvent, void, undefined>> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "text/event-stream", ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`[raptor] sse: ${response.status} ${response.statusText}${detail ? " - " + detail : ""}`);
  }
  return readEventStream(response, options);
}

// --- Server side -----------------------------------------------------------

/**
 * The headers an event stream needs. `x-accel-buffering` is not decoration:
 * without it nginx buffers the response and the stream arrives all at once,
 * at the end, which looks exactly like a server that is not streaming.
 */
export const EVENT_STREAM_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/**
 * What the writer needs from a response. Structural on purpose: a `node:http`
 * ServerResponse satisfies it, and so does a test double, without this file
 * importing anything from `node:`.
 */
export interface EventStreamSink {
  write(chunk: string): unknown;
  end?(): unknown;
  writeHead?(status: number, headers: Record<string, string>): unknown;
  flushHeaders?(): unknown;
}

export interface EventStreamWriterOptions {
  /**
   * Heartbeat interval in ms (default 15000). A comment line every so often is
   * what keeps a proxy or a load balancer from closing a quiet stream. `0`
   * turns it off.
   */
  heartbeatMs?: number;
  /** Extra response headers, merged over `EVENT_STREAM_HEADERS`. */
  headers?: Record<string, string>;
  /** Send the headers immediately (default `true`). */
  writeHead?: boolean;
}

export interface EventStreamWriter {
  /**
   * Sends one event. A non-string payload is JSON-encoded; a payload with
   * newlines becomes several `data:` lines, which is required - a raw newline
   * inside `data` would be read as the end of the line.
   */
  send(data: unknown, options?: { event?: string; id?: string; retry?: number }): void;
  /** Sends a comment line - a heartbeat, or a note for a human reading the stream. */
  comment(text?: string): void;
  /** Sends `sentinel` as a final event if given, stops the heartbeat and ends the response. */
  close(sentinel?: string): void;
  /** Stops the heartbeat without ending the response (for a stream you keep). */
  stop(): void;
  /** False once `close()` has run; sending after that is a no-op, not a throw. */
  readonly open: boolean;
}

/**
 * Frames events into `sink`, heartbeats included.
 *
 * ```ts
 * const stream = writeEventStream(res);
 * for await (const token of model.stream(prompt)) stream.send({ delta: token });
 * stream.close("[DONE]");
 * ```
 */
export function writeEventStream(sink: EventStreamSink, options: EventStreamWriterOptions = {}): EventStreamWriter {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  let open = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  if (options.writeHead !== false && typeof sink.writeHead === "function") {
    sink.writeHead(200, { ...EVENT_STREAM_HEADERS, ...options.headers });
  }
  sink.flushHeaders?.();

  function comment(text = ""): void {
    if (!open) return;
    sink.write(":" + (text ? " " + text : "") + "\n\n");
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  const writer: EventStreamWriter = {
    get open() {
      return open;
    },
    send(data, frame) {
      if (!open) return;
      const payload = typeof data === "string" ? data : JSON.stringify(data) ?? "";
      let out = "";
      if (frame?.event) out += "event: " + frame.event + "\n";
      if (frame?.id !== undefined) out += "id: " + frame.id + "\n";
      if (frame?.retry !== undefined) out += "retry: " + frame.retry + "\n";
      for (const line of payload.split(/\r\n|\n|\r/)) out += "data: " + line + "\n";
      sink.write(out + "\n");
    },
    comment,
    stop,
    close(sentinel) {
      if (!open) return;
      if (sentinel !== undefined) writer.send(sentinel);
      stop();
      open = false;
      sink.end?.();
    },
  };

  if (heartbeatMs > 0) {
    timer = setInterval(comment, heartbeatMs);
    // A heartbeat must not be the reason a process stays alive: the response
    // itself holds the connection open, and an unref'd timer lets a test or a
    // shutdown finish instead of hanging on it.
    (timer as { unref?: () => void }).unref?.();
  }

  return writer;
}
