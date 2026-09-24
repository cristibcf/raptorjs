/**
 * @raptor/cli-host - terminalul ca host Raptor.
 *
 * Roadmap-ul §4 pune uneltele intr-un strat propriu (`raptor-create`,
 * `raptor-bundle`, `raptor-runtime`). Pachetul acesta le da acelasi contract ca
 * aplicatiilor: o unealta scrisa pe punte primeste argumente, fluxuri si
 * intrebari de la host, si nu atinge `process` direct - deci poate fi testata
 * fara terminal si mutata pe alt host fara sa se schimbe.
 *
 * Ca si `web` si `server`, coloana `cli` din matricea de capabilitati este
 * derivata, nu citita din tabelul sectiunii 6.
 */
export { createCliHost } from "./host.ts";
export type { CliHost, CliHostOptions } from "./host.ts";

export { terminalFromProcess } from "./terminal.ts";
export type { ProcessLike, Stream, Terminal } from "./terminal.ts";
