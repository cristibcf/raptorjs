/**
 * The type declarations for the `raptor:` namespace (spec sections 1 and 6).
 *
 * The spec requires TypeScript to be a first-class source format, not a separate
 * compile step. That also means `import { readText } from "raptor:files"` must
 * type-check in the editor and in `tsc`, with no hand-written declarations in
 * every project. This file is that bridge: the types come from the host's real
 * contracts, so they cannot fall behind the implementation.
 */

declare module "raptor:files" {
  import type { RaptorFiles } from "@raptorstack/runtime";
  const files: RaptorFiles;
  export default files;
  export const readText: RaptorFiles["readText"];
  export const readBytes: RaptorFiles["readBytes"];
  export const write: RaptorFiles["write"];
  export const append: RaptorFiles["append"];
  export const list: RaptorFiles["list"];
  export const stat: RaptorFiles["stat"];
  export const exists: RaptorFiles["exists"];
  export const remove: RaptorFiles["remove"];
  export const makeDir: RaptorFiles["makeDir"];
}

declare module "raptor:net" {
  import type { RaptorNet } from "@raptorstack/runtime";
  const net: RaptorNet;
  export default net;
  export const fetch: RaptorNet["fetch"];
  export const allows: RaptorNet["allows"];
}

declare module "raptor:process" {
  import type { RaptorProcess } from "@raptorstack/runtime";
  const proc: RaptorProcess;
  export default proc;
  export const args: RaptorProcess["args"];
  export const platform: RaptorProcess["platform"];
  export const pid: RaptorProcess["pid"];
  export const env: RaptorProcess["env"];
  export const envKeys: RaptorProcess["envKeys"];
  export const spawn: RaptorProcess["spawn"];
  export const requestExit: RaptorProcess["requestExit"];
  export const onExitRequest: RaptorProcess["onExitRequest"];
}

declare module "raptor:kv" {
  import type { RaptorKv } from "@raptorstack/runtime";
  const kv: RaptorKv;
  export default kv;
  export const get: RaptorKv["get"];
  export const set: RaptorKv["set"];
  export const list: RaptorKv["list"];
  export const clear: RaptorKv["clear"];
  export const namespace: RaptorKv["namespace"];
}

declare module "raptor:serve" {
  import type { RaptorServe } from "@raptorstack/runtime";
  const serve: RaptorServe;
  export default serve;
  export const route: RaptorServe["route"];
}

declare module "raptor:tasks" {
  import type { TaskFabric } from "@raptorstack/runtime";
  const tasks: TaskFabric;
  export default tasks;
  export const spawn: TaskFabric["spawn"];
  export const drain: TaskFabric["drain"];
  export const shutdown: TaskFabric["shutdown"];
  export const stats: TaskFabric["stats"];
}

declare module "raptor:observe" {
  import type { Observer } from "@raptorstack/runtime";
  const observe: Observer;
  export default observe;
  export const log: Observer["log"];
  export const startSpan: Observer["startSpan"];
  export const metric: Observer["metric"];
  export const events: Observer["events"];
  export const child: Observer["child"];
}

declare module "raptor:capabilities" {
  import type { CapabilityBroker } from "@raptorstack/runtime";
  const capabilities: CapabilityBroker;
  export default capabilities;
  export const check: CapabilityBroker["check"];
  export const require: CapabilityBroker["require"];
  export const revoke: CapabilityBroker["revoke"];
  export const delegate: CapabilityBroker["delegate"];
  export const diagnostics: CapabilityBroker["diagnostics"];
}
