/**
 * The command-line host.
 *
 * The fifth form of the same contract. What the host gives here: the arguments,
 * two output streams, what it knows about the terminal, the questions to the
 * user and the exit code. There are no windows, screens or sockets.
 *
 * Two rules are worth stating plainly:
 *
 *  1. **Without an interactive terminal, a question is denied, not assumed.**
 *     A tool run from CI must not "assume yes" on a destructive confirmation.
 *     The `tty.interact` capability can be declared in the manifest, but if the
 *     terminal cannot read, the call still fails - with a distinct code, so the
 *     app can say "run me with --yes" instead of crashing.
 *  2. **Ctrl-C is an event, not an execution.** The host does not stop the
 *     process; it notifies whoever is working, so they can clean up in time.
 *     Only the second press forces the stop, exactly like in ordinary tools.
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
  /** The code requested by the app, or `null` while it is still working. */
  readonly exitCode: number | null;
  /** Ctrl-C: the first time it notifies, the second time it stops. */
  interrupt(): void;
  /** Resolves when the app has requested the exit (or was interrupted). */
  finished(): Promise<number>;
  close(): void;
}

function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new HostError("raptor:host/protocol", `the '${key}' parameter is missing or is not a string`, { key });
  }
  return value;
}

/** The same key policy as on the other hosts: a flat space, no paths. */
function requireKey(params: Readonly<Record<string, unknown>>): string {
  const key = requireString(params, "key");
  if (key.length === 0 || key.includes("/") || key.includes("\\") || key.includes("..") || key.startsWith(".")) {
    throw new HostError("raptor:host/capability-unavailable", `invalid storage key: ${key}`, {
      key,
      policy: "limited to the tool's configuration directory",
    });
  }
  return key;
}

export function createCliHost(options: CliHostOptions): CliHost {
  const manifest = options.manifest;
  if (manifest.target !== "cli") {
    throw new HostError("raptor:host/manifest-invalid", "createCliHost requires a manifest with target 'cli'", {
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

  /** Questions require both a capability and a terminal that can actually read. */
  const ask = async (question: string): Promise<string> => {
    if (!terminal.interactive || !terminal.ask) {
      throw new HostError("raptor:host/capability-unavailable", "the terminal is not interactive; the question was denied", {
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
        throw new HostError("raptor:host/protocol", "the exit code must be an integer between 0 and 255", { code });
      }
      finish(typeof code === "number" ? code : 0, "the app requested the exit");
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
      const answer = (await ask(`${requireString(params, "question")} [y/N] `)).trim().toLowerCase();
      return { confirmed: answer === "d" || answer === "da" || answer === "y" || answer === "yes" };
    },

    "lifecycle.state": () => lifecycle.state,
    "lifecycle.requestStop": () => {
      finish(0, "the app requested a stop");
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
      throw new HostError("raptor:host/unimplemented", "a tool updates through the package manager", {});
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
        // The second press: we no longer wait for cleanup.
        finish(130, "second interrupt");
        return;
      }
      interrupted = true;
      server.emit("cli.interrupt", { attempt: 1 });
    },

    finished(): Promise<number> {
      return done;
    },

    close(): void {
      finish(exitCode ?? 0, "host closed");
      server.close();
    },
  };

  terminal.onInterrupt?.(() => host.interrupt());
  return host;
}
