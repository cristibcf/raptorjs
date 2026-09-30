/**
 * The host context that every `raptor:` module receives.
 *
 * The rule from spec section 5: "JavaScript never receives raw host handles".
 * Modules do not import `node:fs` directly in the public surface - they receive
 * this context, which ties every operation to a broker and to an observer.
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
  /** The application's arguments, after the launcher's own. */
  readonly args: readonly string[];
}
