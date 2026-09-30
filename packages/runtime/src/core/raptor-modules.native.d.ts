/**
 * The type declarations for the `raptor:` namespace for the **native binary**.
 *
 * There are TWO `raptor:` surfaces, not one, and this is not an oversight:
 *
 *  - **bootstrap** (`raptor-modules.d.ts`) runs on Node, has an event loop, so
 *    `files.readText` returns `Promise<string>` and the server is started with
 *    `serve.serve({ fetch })`;
 *  - **native** (this file) runs on QuickJS, where there is not yet an event
 *    loop nor host-bound promises. There everything is **synchronous**, and the
 *    server's accept loop belongs to the application:
 *    `serve.listen()` / `serve.next()` / `serve.respond()`.
 *
 * The same names, two profiles. We keep them in separate files because two
 * `declare module "raptor:files"` blocks in the same TypeScript program would
 * **merge**, and the result would be a type that describes neither of the two
 * targets. So the programs are separate: `tsconfig.json` checks everything that
 * runs on Node, `tsconfig.native.json` checks the native examples. `pnpm
 * typecheck` runs both.
 *
 * The types here are hand-written after the real contracts in
 * `packages/runtime-native/crates/raptor-runtime-core/src/modules.rs`. When the
 * event loop reaches the native host, this profile moves closer to the other -
 * the contract does not change, it is added on top of it.
 */

declare module "raptor:files" {
  export interface NativeFileEntry {
    readonly name: string;
    readonly path: string;
    readonly kind: "file" | "directory" | "other";
  }

  export interface NativeFiles {
    readText(path: string): string;
    write(path: string, contents: string): boolean;
    exists(path: string): boolean;
    /** The entry names, sorted. Does not return objects: the host gives strings. */
    list(path: string): string[];
  }

  const files: NativeFiles;
  export default files;
  export const readText: NativeFiles["readText"];
  export const write: NativeFiles["write"];
  export const exists: NativeFiles["exists"];
  export const list: NativeFiles["list"];
}

declare module "raptor:observe" {
  export type NativeSeverity = "debug" | "info" | "warn" | "error";

  export interface NativeObserver {
    log(severity: NativeSeverity, name: string, attributes?: Record<string, unknown>): void;
    metric(name: string, value: number): void;
  }

  const observe: NativeObserver;
  export default observe;
  export const log: NativeObserver["log"];
  export const metric: NativeObserver["metric"];
}

declare module "raptor:process" {
  export interface NativeProcess {
    readonly args: readonly string[];
    readonly platform: string;
    /** `null` when the variable does not exist; throws if `env.read` does not cover it. */
    env(name: string): string | null;
    /**
     * Deliberately denied in the native host: the capability may pass, but
     * execution requires process isolation the host does not have yet, and an
     * explicit denial is better than a `Command::new` without boundaries.
     */
    spawn(command: string): never;
  }

  const proc: NativeProcess;
  export default proc;
}

declare module "raptor:kv" {
  export interface NativeKv {
    get(key: string): string | null;
    set(key: string, value: string): boolean;
    /** `delete` is a reserved word, so it is not exported as a separate name too. */
    delete(key: string): boolean;
    keys(): string[];
  }

  const kv: NativeKv;
  export default kv;
  export const get: NativeKv["get"];
  export const set: NativeKv["set"];
  export const keys: NativeKv["keys"];
}

declare module "raptor:capabilities" {
  export interface NativeDecision {
    readonly granted: boolean;
    readonly capability: string;
    readonly target: string;
    readonly reason: string;
    readonly rule: string | null;
    readonly annotated: boolean;
  }

  export interface NativeCapabilities {
    check(capability: string, target?: string): NativeDecision;
    diagnostics(): Record<string, unknown>;
  }

  const capabilities: NativeCapabilities;
  export default capabilities;
  export const check: NativeCapabilities["check"];
  export const diagnostics: NativeCapabilities["diagnostics"];
}

declare module "raptor:net" {
  export interface NativeResponse {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string;
  }

  export interface NativeFetchOptions {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly timeoutMs?: number;
  }

  export interface NativeNet {
    /** Synchronous, deliberately: without an event loop there is no other form. */
    fetch(url: string, options?: NativeFetchOptions): NativeResponse;
    allows(url: string): boolean;
  }

  const net: NativeNet;
  export default net;
  export const fetch: NativeNet["fetch"];
  export const allows: NativeNet["allows"];
}

declare module "raptor:serve" {
  export interface NativeListenOptions {
    readonly port?: number;
    readonly hostname?: string;
  }

  export interface NativeServer {
    readonly port: number;
    readonly url: string;
  }

  export interface NativeRequest {
    readonly id: number;
    readonly method: string;
    /** The raw path from the request line, query string included. */
    readonly target: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  }

  export interface NativeReply {
    readonly status: number;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  }

  export interface NativeStatus {
    readonly listening: boolean;
    readonly port: number | null;
    readonly served: number;
  }

  export interface NativeServe {
    /** Requires `net.listen` for `host:port`, before `bind`. */
    listen(options?: NativeListenOptions): NativeServer;
    /**
     * The next request, or `null` if none arrived within the requested window.
     * **Blocks** - the accept loop belongs to the application, because without
     * an event loop the host cannot call a JS function back.
     */
    next(options?: { readonly timeoutMs?: number }): NativeRequest | null;
    respond(id: number, reply: NativeReply): boolean;
    status(): NativeStatus;
    close(): boolean;
  }

  const serve: NativeServe;
  export default serve;
  export const listen: NativeServe["listen"];
  export const next: NativeServe["next"];
  export const respond: NativeServe["respond"];
  export const status: NativeServe["status"];
  export const close: NativeServe["close"];
}
