/**
 * @raptorstack/cli-host - the terminal as a Raptor host.
 *
 * Roadmap §4 puts the tools in a layer of their own (`raptor-create`,
 * `raptor-bundle`, `raptor-runtime`). This package gives them the same contract
 * as the apps: a tool written to the bridge gets arguments, streams and
 * questions from the host, and does not touch `process` directly - so it can be
 * tested without a terminal and moved to another host without changing.
 *
 * Like `web` and `server`, the `cli` column in the capability matrix is derived,
 * not read from the section 6 table.
 */
export { createCliHost } from "./host.ts";
export type { CliHost, CliHostOptions } from "./host.ts";

export { terminalFromProcess } from "./terminal.ts";
export type { ProcessLike, Stream, Terminal } from "./terminal.ts";
