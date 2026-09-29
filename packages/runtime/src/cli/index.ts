/**
 * @raptor/runtime-cli - launcher-ul RaptorRuntime.
 *
 * Pachetul expune comenzile si ca API, nu doar ca binar: `raptor-create`,
 * testele de contract si, mai tarziu, host-ul nativ le apeleaza direct.
 */
export { main, runCli } from "./cli.ts";
export type { CliOptions } from "./cli.ts";

export { flagBool, flagString, parseArgs } from "./args.ts";
export type { ParsedArgs } from "./args.ts";

export { fail, formatMs, fromError, ok, table } from "./shared.ts";
export type { CommandInput, CommandResult } from "./shared.ts";

export {
  DEFAULT_POLICY,
  POLICY_FILENAME,
  describeUndeclared,
  loadPolicyFile,
  profileFor,
  renderPolicyFile,
  writeAudit,
} from "./policy.ts";
export type { PolicyFile, PolicyProfile, UndeclaredBehavior } from "./policy.ts";

export { doctorCommand } from "./commands/doctor.ts";
export { initCommand } from "./commands/init.ts";
export { BUNDLE_NAME, LOCKFILE_NAME, packCommand } from "./commands/pack.ts";
export { runCommand } from "./commands/run.ts";
export type { RunOptions, RunOutcome } from "./commands/run.ts";
export { discoverTests, testCommand } from "./commands/test.ts";
export type { CaseReport } from "./commands/test.ts";
export { toOtlp, traceCommand } from "./commands/trace.ts";
