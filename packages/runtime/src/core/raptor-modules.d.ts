/**
 * Declaratiile de tip ale spatiului de nume `raptor:` (spec sectiunile 1 si 6).
 *
 * Spec-ul cere ca TypeScript sa fie format de sursa de rang intai, nu un pas de
 * compilare separat. Asta inseamna si ca `import { readText } from "raptor:files"`
 * trebuie sa se verifice in editor si in `tsc`, fara declaratii scrise de mana in
 * fiecare proiect. Fisierul de aici este acea punte: tipurile vin din contractele
 * reale ale host-ului, deci nu pot ramane in urma fata de implementare.
 */

declare module "raptor:files" {
  import type { RaptorFiles } from "@raptor/runtime";
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
  import type { RaptorNet } from "@raptor/runtime";
  const net: RaptorNet;
  export default net;
  export const fetch: RaptorNet["fetch"];
  export const allows: RaptorNet["allows"];
}

declare module "raptor:process" {
  import type { RaptorProcess } from "@raptor/runtime";
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
  import type { RaptorKv } from "@raptor/runtime";
  const kv: RaptorKv;
  export default kv;
  export const get: RaptorKv["get"];
  export const set: RaptorKv["set"];
  export const list: RaptorKv["list"];
  export const clear: RaptorKv["clear"];
  export const namespace: RaptorKv["namespace"];
}

declare module "raptor:serve" {
  import type { RaptorServe } from "@raptor/runtime";
  const serve: RaptorServe;
  export default serve;
  export const route: RaptorServe["route"];
}

declare module "raptor:tasks" {
  import type { TaskFabric } from "@raptor/runtime";
  const tasks: TaskFabric;
  export default tasks;
  export const spawn: TaskFabric["spawn"];
  export const drain: TaskFabric["drain"];
  export const shutdown: TaskFabric["shutdown"];
  export const stats: TaskFabric["stats"];
}

declare module "raptor:observe" {
  import type { Observer } from "@raptor/runtime";
  const observe: Observer;
  export default observe;
  export const log: Observer["log"];
  export const startSpan: Observer["startSpan"];
  export const metric: Observer["metric"];
  export const events: Observer["events"];
  export const child: Observer["child"];
}

declare module "raptor:capabilities" {
  import type { CapabilityBroker } from "@raptor/runtime";
  const capabilities: CapabilityBroker;
  export default capabilities;
  export const check: CapabilityBroker["check"];
  export const require: CapabilityBroker["require"];
  export const revoke: CapabilityBroker["revoke"];
  export const delegate: CapabilityBroker["delegate"];
  export const diagnostics: CapabilityBroker["diagnostics"];
}
