/**
 * Legarea uneltei de terminal.
 *
 * `createSession` primeste un terminal oarecare - in teste unul fals, in binar
 * cel real din `process`. Unealta nu vede diferenta.
 */
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createCliHost, terminalFromProcess } from "@raptor/host/cli";
import type { CliHost, ProcessLike, Terminal } from "@raptor/host/cli";
import { createCli } from "./app.ts";
import type { Cli } from "./app.ts";

export interface SessionOptions {
  readonly terminal: Terminal;
  /** Implicit: poate intreba utilizatorul. */
  readonly capabilities?: readonly string[];
  readonly storage?: Map<string, string>;
}

export interface Session {
  readonly manifest: HostManifest;
  readonly host: CliHost;
  readonly bridge: HostBridge;
  readonly cli: Cli;
  close(): void;
}

export function manifestFor(capabilities: readonly string[]): HostManifest {
  return requireHostManifest(
    JSON.stringify({
      target: "cli",
      bundleId: "com.raptor.notes",
      displayName: "raptor-notes",
      version: "0.1.0",
      entry: "./src/bin.ts",
      capabilities,
      allowedOrigins: [],
      deepLinkSchemes: [],
      update: { feed: null, channel: "stable" },
    }),
  );
}

export function createSession(options: SessionOptions): Session {
  const manifest = manifestFor(options.capabilities ?? ["tty.interact"]);
  const channel = createMemoryChannel();

  const host = createCliHost({
    manifest,
    transport: channel.host,
    terminal: options.terminal,
    ...(options.storage ? { storage: options.storage } : {}),
  });

  const bridge = createBridge({
    target: "cli",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 5000,
  });

  return {
    manifest,
    host,
    bridge,
    cli: createCli(bridge),
    close(): void {
      host.close();
      bridge.dispose("sesiune incheiata");
    },
  };
}

/**
 * O invocare completa: ruleaza comanda si intoarce codul de iesire.
 *
 * Codul nu este dat de aplicatie direct procesului, ci cerut host-ului prin
 * `cli.exit` - acelasi drum pe care il va face si cand host-ul va fi altul.
 */
export async function runOnce(options: SessionOptions): Promise<number> {
  const session = createSession(options);
  try {
    const code = await session.cli.run();
    await session.bridge.call("cli.exit", { code });
    return await session.host.finished();
  } finally {
    session.close();
  }
}

/** Sesiunea reala din binar. */
export function createProcessSession(proc: ProcessLike, storage?: Map<string, string>): Session {
  return createSession({
    terminal: terminalFromProcess(proc),
    ...(storage ? { storage } : {}),
  });
}
