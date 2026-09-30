import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { MANIFEST_FILENAME, RUNTIME_VERSION, stableStringify } from "@raptor/runtime";
import { HOST_MANIFEST_FILENAME, requireHostManifest } from "@raptor/host";
import type { HostManifest } from "@raptor/host";
import { planFor, renderPackaging, renderWorkflow } from "./packaging.ts";
import { type AppTarget, TARGETS } from "./targets.ts";

export interface CreateProjectOptions {
  name: string;
  target: AppTarget;
  directory?: string;
  /** Reverse-DNS application id; derived from the name when omitted. */
  bundleId?: string;
}

export interface CreatedProject {
  root: string;
  files: readonly string[];
}

function appSource(name: string, target: AppTarget): string {
  return `import { render, state } from "raptorjs/dom";\n\nconst count = state(0);\n\nfunction App() {\n  return <main>\n    <h1>${name}</h1>\n    <p>Raptor ${target} application</p>\n    <button onClick={() => count.update((value) => value + 1)}>Count: {count}</button>\n  </main>;\n}\n\nrender(App, document.getElementById("app")!);\n`;
}

function html(title: string): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head><body><div id="app"></div><script type="module" src="./src/main.tsx"></script></body></html>\n`;
}

/** A manifest the RaptorRuntime parser actually accepts, not a look-alike. */
function runtimeManifest(packageName: string, target: AppTarget): string {
  return (
    stableStringify({
      name: packageName,
      version: "0.1.0",
      entry: "./src/main.tsx",
      policy: "development",
      engines: { raptorRuntime: `>=${RUNTIME_VERSION}` },
      capabilities: TARGETS[target].runtimeCapabilities,
      tasks: { maxConcurrent: 64, defaultDeadlineMs: null },
    }) + "\n"
  );
}

/** `Phone App` -> `com.raptor.phone-app`; overridable for real organisations. */
export function defaultBundleId(packageName: string): string {
  return `com.raptor.${packageName}`;
}

function hostManifest(options: { name: string; packageName: string; target: AppTarget; bundleId: string }): HostManifest {
  const definition = TARGETS[options.target];
  const source = {
    target: definition.hostTarget,
    bundleId: options.bundleId,
    displayName: options.name,
    version: "0.1.0",
    entry: "./index.html",
    capabilities: definition.hostCapabilities,
    allowedOrigins: ["http://localhost:5173"],
    deepLinkSchemes: [options.packageName],
    ...(options.target === "desktop"
      ? { window: { title: options.name, width: 1024, height: 768, resizable: true } }
      : {}),
    update: { feed: null, channel: "stable" },
  };
  // Parsed rather than trusted: a generator that emits an invalid manifest is a
  // bug we want to see here, not in the user's first `doctor` run.
  return requireHostManifest(JSON.stringify(source));
}

function hostReadme(target: AppTarget, manifest: HostManifest): string {
  const native = target === "desktop" ? "Windows, macOS and Linux" : "Android and iOS";
  const adapter = target === "desktop" ? "@raptor/host/desktop" : "@raptor/host/mobile";
  return [
    `# ${TARGETS[target].displayName} host`,
    "",
    `This folder is the native-host boundary for ${native}. It contains no platform`,
    "implementation: the window, WebView, lifecycle, deep links and packaging all come",
    `from the Raptor ${TARGETS[target].displayName} Adapter (\`${adapter}\`), and the capability`,
    "broker decides what JavaScript is allowed to reach.",
    "",
    "## Contract",
    "",
    `- Application id: \`${manifest.bundleId}\``,
    `- Optional host modules: ${manifest.capabilities.length > 0 ? manifest.capabilities.join(", ") : "(none)"}`,
    `- Deep link schemes: ${manifest.deepLinkSchemes.join(", ")}`,
    `- Updates: ${manifest.update.feed ?? "distributed through the platform store"}`,
    "",
    "Declared in `../../" + HOST_MANIFEST_FILENAME + "`. Change it there, then regenerate",
    "`packaging.json` and the installer workflow so the three stay in step.",
    "",
    "## Packaging",
    "",
    "`packaging.json` lists every artifact this target produces, which runner builds it",
    "and which ones cannot be published unsigned. The CI workflow in",
    "`.github/workflows/installers.yml` is generated from that same file.",
    "",
  ].join("\n");
}

/** Creates source files only; it never installs packages or changes global state. */
export function createProject(options: CreateProjectOptions): CreatedProject {
  const root = resolve(options.directory ?? options.name);
  if (existsSync(root)) throw new Error(`Cannot create project: ${root} already exists.`);
  const files: string[] = [];
  const write = (relative: string, contents: string): void => {
    const destination = join(root, relative);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
    files.push(relative);
  };

  const packageName = basename(root).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const definition = TARGETS[options.target];

  write(
    "package.json",
    JSON.stringify(
      {
        name: packageName,
        private: true,
        type: "module",
        scripts: {
          dev: "raptor-bundle dev src/main.tsx",
          build: `raptor-bundle build src/main.tsx --out ${definition.outputDirectory}/app.js --html index.html`,
        },
        dependencies: { "raptorjs": "workspace:*", "raptorjs/dom": "workspace:*" },
      },
      null,
      2,
    ) + "\n",
  );
  write(MANIFEST_FILENAME, runtimeManifest(packageName, options.target));
  write("index.html", html(options.name));
  write("src/main.tsx", appSource(options.name, options.target));

  const readme = [
    `# ${options.name}`,
    "",
    `Generated by RaptorForge for the ${options.target} target.`,
    "",
    "- Develop: `raptor-bundle dev src/main.tsx`",
    `- Build: \`raptor-bundle build src/main.tsx --out ${definition.outputDirectory}/app.js --html index.html\``,
  ];

  if (definition.hostTarget) {
    const manifest = hostManifest({
      name: options.name,
      packageName,
      target: options.target,
      bundleId: options.bundleId ?? defaultBundleId(packageName),
    });
    const plan = planFor(manifest);

    write(HOST_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2) + "\n");
    write(`hosts/${options.target}/README.md`, hostReadme(options.target, manifest));
    write(`hosts/${options.target}/packaging.json`, renderPackaging(plan));
    write(".github/workflows/installers.yml", renderWorkflow(plan, options.name));

    readme.push(
      "- Package: see `hosts/" + options.target + "/packaging.json`",
      "",
      `This target runs inside a native WebView host. \`${HOST_MANIFEST_FILENAME}\` declares the`,
      "system boundary; `raptor.runtime.json` declares what the application itself may do.",
    );
  }

  write("README.md", readme.join("\n") + "\n");
  return { root, files };
}
