import { createProject, defaultBundleId } from "./project.ts";
import { APP_TARGETS, TARGETS, isAppTarget } from "./targets.ts";

export interface ForgeCliResult { code: number; out: string; }
const usage = [
  "usage:",
  "  raptor-create <name> [--target web|desktop|mobile] [--dir path] [--bundle-id com.example.app]",
  "  raptor-create targets",
].join("\n");

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

export function runForgeCli(args: string[]): ForgeCliResult {
  if (args[0] === "targets") return { code: 0, out: APP_TARGETS.join("\n") };
  const name = args.find((arg) => !arg.startsWith("-"));
  if (!name) return { code: 1, out: usage };
  const targetValue = valueAfter(args, "--target") ?? "web";
  if (!isAppTarget(targetValue)) return { code: 1, out: `Unknown target: ${targetValue}\n${usage}` };

  const bundleId = valueAfter(args, "--bundle-id");
  if (bundleId !== undefined && TARGETS[targetValue].hostTarget === null) {
    // Saying yes here would quietly write an id nothing reads.
    return { code: 1, out: `The web target has no native host, so --bundle-id does not apply.\n${usage}` };
  }

  try {
    const project = createProject({
      name,
      target: targetValue,
      ...(valueAfter(args, "--dir") === undefined ? {} : { directory: valueAfter(args, "--dir")! }),
      ...(bundleId === undefined ? {} : { bundleId }),
    });
    return {
      code: 0,
      out: `Created ${targetValue} project in ${project.root}\n${project.files.map((file) => `  ${file}`).join("\n")}`,
    };
  } catch (error) {
    return { code: 1, out: error instanceof Error ? error.message : String(error) };
  }
}

export { defaultBundleId };
