/**
 * Declaratiile de tip ale spatiului `raptor:` pentru **binarul nativ**.
 *
 * Exista DOUA suprafete `raptor:`, nu una, si asta nu e o scapare:
 *
 *  - **bootstrap** (`raptor-modules.d.ts`) ruleaza pe Node, are bucla de
 *    evenimente, deci `files.readText` intoarce `Promise<string>` si serverul se
 *    porneste cu `serve.serve({ fetch })`;
 *  - **nativ** (acest fisier) ruleaza pe QuickJS, unde inca nu exista bucla de
 *    evenimente si nici promisiuni legate la host. Acolo totul e **sincron**,
 *    iar bucla de acceptare a serverului apartine aplicatiei:
 *    `serve.listen()` / `serve.next()` / `serve.respond()`.
 *
 * Aceleasi nume, doua profiluri. Le tinem in fisiere separate pentru ca doua
 * blocuri `declare module "raptor:files"` in acelasi program TypeScript s-ar
 * **contopi**, iar rezultatul ar fi un tip care nu descrie niciuna dintre cele
 * doua tinte. Deci programele sunt separate: `tsconfig.json` verifica tot ce
 * ruleaza pe Node, `tsconfig.native.json` verifica exemplele native. `pnpm
 * typecheck` le ruleaza pe amandoua.
 *
 * Tipurile de aici sunt scrise de mana dupa contractele reale din
 * `packages/runtime-native/crates/raptor-runtime-core/src/modules.rs`. Cand
 * bucla de evenimente ajunge in host-ul nativ, profilul asta se apropie de
 * celalalt - contractul nu se schimba, se adauga peste el.
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
    /** Numele intrarilor, sortate. Nu intoarce obiecte: host-ul da siruri. */
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
    /** `null` cand variabila nu exista; arunca daca `env.read` nu o acopera. */
    env(name: string): string | null;
    /**
     * Refuzat deliberat in host-ul nativ: capabilitatea poate trece, dar
     * executia cere izolare de proces pe care host-ul nu o are inca, iar un
     * refuz explicit e mai bun decat un `Command::new` fara granite.
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
    /** `delete` e cuvant rezervat, deci nu e exportat si ca nume separat. */
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
    /** Sincron, deliberat: fara bucla de evenimente nu exista alta forma. */
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
    /** Calea cruda din linia de cerere, interogarea inclusa. */
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
    /** Cere `net.listen` pentru `gazda:port`, inainte de `bind`. */
    listen(options?: NativeListenOptions): NativeServer;
    /**
     * Urmatoarea cerere, sau `null` daca niciuna nu a venit in fereastra
     * ceruta. **Blocheaza** - bucla de acceptare apartine aplicatiei, pentru ca
     * fara bucla de evenimente host-ul nu poate chema inapoi o functie JS.
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
