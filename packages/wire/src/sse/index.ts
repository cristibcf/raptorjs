/**
 * @raptorstack/wire/sse - Server-Sent Events, both ends.
 *
 * Isomorphic: the reader needs only a `fetch` body, and the writer only a sink
 * with `write`/`end`. Nothing from `node:`, so this subpath bundles for the
 * browser as-is.
 */
export {
  readEventStream,
  openEventStream,
  writeEventStream,
  EVENT_STREAM_HEADERS,
  type SseEvent,
  type EventStreamOptions,
  type EventStreamSink,
  type EventStreamWriter,
  type EventStreamWriterOptions,
} from "./sse.ts";
