/**
 * Contextul de host pe care il primeste fiecare modul `raptor:`.
 *
 * Regula din spec sectiunea 5: "JavaScript nu primeste niciodata handle-uri brute
 * de host". Modulele nu importa `node:fs` direct in suprafata publica - primesc
 * acest context, care leaga fiecare operatie de un broker si de un observer.
 */
import type { CapabilityBroker } from "./capabilities.ts";
import type { RuntimeManifest } from "./manifest.ts";
import type { Observer } from "./observe.ts";
import type { TaskFabric } from "./tasks.ts";

export interface HostContext {
  readonly projectRoot: string;
  readonly manifest: RuntimeManifest;
  readonly broker: CapabilityBroker;
  readonly observer: Observer;
  readonly tasks: TaskFabric;
  /** Argumentele aplicatiei, dupa cele ale launcher-ului. */
  readonly args: readonly string[];
}
