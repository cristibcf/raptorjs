/**
 * Host-ul de linie de comanda.
 *
 * A cincea forma a aceluiasi contract. Ce da host-ul aici: argumentele, doua
 * fluxuri de iesire, ce stie despre terminal, intrebarile catre utilizator si
 * codul de iesire. Nu exista ferestre, ecrane sau socketi.
 *
 * Doua reguli merita spuse pe fata:
 *
 *  1. **Fara terminal interactiv, o intrebare este refuzata, nu presupusa.**
 *     O unealta rulata din CI nu trebuie sa "presupuna da" la o confirmare
 *     distructiva. Capabilitatea `tty.interact` poate fi declarata in manifest,
 *     dar daca terminalul nu poate citi, apelul tot pica - cu un cod distinct,
 *     ca aplicatia sa poata spune "ruleaza-ma cu --yes" in loc sa crape.
 *  2. **Ctrl-C este eveniment, nu executie.** Host-ul nu opreste procesul; il
 *     anunta pe cel care lucreaza, ca sa apuce sa curete. Abia a doua apasare
 *     forteaza oprirea, exact ca in uneltele obisnuite.
 */
import { HostError, createLifecycle, serveHost } from "@raptor/host";
import type { AuditEntry, HostManifest, HostServer, HostTransport, LifecycleMachine, MethodHandler } from "@raptor/host";
import type { Stream, Terminal } from "./terminal.ts";

export interface CliHostOptions {
  readonly manifest: HostManifest;
  readonly transport: HostTransport;
  readonly terminal: Terminal;
  readonly storage?: Map<string, string>;
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface CliHost {
  readonly server: HostServer;
  readonly lifecycle: LifecycleMachine;
  /** Codul cerut de aplicatie, sau `null` cat timp inca lucreaza. */
  readonly exitCode: number | null;
  /** Ctrl-C: prima data anunta, a doua oara opreste. */
  interrupt(): void;
  /** Se incheie cand aplicatia a cerut iesirea (sau a fost intrerupta). */
  finished(): Promise<number>;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new HostError("raptor:host/protocol", `parametrul '${key}' lipseste sau nu este sir`, { key });
  }
  return value;
}

/** Aceeasi politica de chei ca pe celelalte host-uri: spatiu plat, fara cai. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.length === 0 || key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `cheie de stocare invalida: ${key}`, {
      key,
      policy: "limitata la directorul de configuratie al uneltei",
    });
  }
  return key;
}

export function createCliHost(options: CliHostOptions): CliHost {
  const manifest = options.manifest;
  if (manifest.target !== "cli") {
    throw new HostError("raptor:host/manifest-invalid", "createCliHost cere un manifest cu target 'cli'", {
      target: manifest.target,
    });
  }

  const terminal = options.terminal;
  const store = options.storage ?? new Map<string, string>();
  const lifecycle = createLifecycle();
  let exitCode: number | null = null;
  let interrupted = false;
  let settle: ((code: number) => void) | null = null;

  const done = new Promise<number>((resolve) => {
    settle = resolve;
  });

  const finish = (code: number, reason: string): void => {
    if (exitCode !== null) return;
    exitCode = code;
    lifecycle.settle("ready", reason);
    lifecycle.settle("foreground", reason);
    lifecycle.settle("stopped", reason);
    settle?.(code);
  };

  /** Intrebarile cer si capabilitate, si un terminal care chiar poate citi. */
  const ask = async (question: string): Promise<string> => {
    if (!terminal.interactive || !terminal.ask) {
      throw new HostError("raptor:host/capability-unavailable", "terminalul nu este interactiv; intrebarea a fost refuzata", {
        question,
        interactive: terminal.interactive,
      });
    }
    return await terminal.ask(question);
  };

  const methods: Record<string, MethodHandler> = {
    "cli.args": () => [...terminal.args],

    "cli.write": (params) => {
      const stream = params["stream"] === "err" ? "err" : "out";
      const text = requireString(params, "text");
      terminal.write(stream as Stream, text);
      return { written: text.length, stream };
    },

    "cli.exit": (params) => {
      const code = params["code"];
      if (code !== undefined && (typeof code !== "number" || !Number.isInteger(code) || code < 0 || code > 255)) {
        throw new HostError("raptor:host/protocol", "codul de iesire trebuie sa fie un intreg intre 0 si 255", { code });
      }
      finish(typeof code === "number" ? code : 0, "aplicatia a cerut iesirea");
      return { code: exitCode };
    },

    "tty.info": () => ({
      isTTY: terminal.isTTY,
      interactive: terminal.interactive,
      columns: terminal.columns,
      color: terminal.color,
    }),

    "cli.prompt": async (params) => ({ answer: await ask(requireString(params, "question")) }),

    "cli.confirm": async (params) => {
      const answer = (await ask(`${requireString(params, "question")} [d/N] `)).trim().toLowerCase();
      return { confirmed: answer === "d" || answer === "da" || answer === "y" || answer === "yes" };
    },

    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      finish(0, "aplicatia a cerut oprirea");
      return { state: lifecycle.state };
    },

    "storage.get": (params) => store.get(requireKey(params)) ?? null,
    "storage.set": (params) => {
      const key = requireKey(params);
      store.set(key, requireString(params, "value"));
      return { key };
    },
    "storage.delete": (params) => ({ deleted: store.delete(requireKey(params)) }),
    "storage.keys": () => [...store.keys()].sort(),

    "update.check": () => ({ available: false, version: manifest.version, managedBy: "package-manager" }),
    "update.apply": () => {
      throw new HostError("raptor:host/unimplemented", "o unealta se actualizeaza prin managerul de pachete", {});
    },
  };

  const serverOptions = {
    target: "cli" as const,
    capabilities: manifest.capabilities,
    transport: options.transport,
    methods,
  };
  const server: HostServer = serveHost(
    options.onAudit ? { ...serverOptions, onAudit: options.onAudit } : serverOptions,
  );

  lifecycle.onChange((state, reason) => {
    server.emit("lifecycle.changed", { state, reason });
  });

  const host: CliHost = {
    server,
    lifecycle,
    get exitCode(): number | null {
      return exitCode;
    },

    interrupt(): void {
      if (exitCode !== null) return;
      if (interrupted) {
        // A doua apasare: nu mai asteptam curatenia.
        finish(130, "a doua intrerupere");
        return;
      }
      interrupted = true;
      server.emit("cli.interrupt", { attempt: 1 });
    },

    finished(): Promise<number> {
      return done;
    },

    close(): void {
      finish(exitCode ?? 0, "host inchis");
      server.close();
    },
  };

  terminal.onInterrupt?.(() => host.interrupt());
  return host;
}
