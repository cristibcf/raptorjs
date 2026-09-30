//! The commands of the `raptor-runtime` binary (spec section 4).
//!
//! Each command returns an [`Outcome`]: exit code, human-readable text and a
//! structured payload for `--json`. Nothing writes directly to output, so the
//! contract suite can run the commands in-process.
//!
//! State at milestone 0: `doctor`, `init` and `pack` are fully native, because
//! they don't need to evaluate JavaScript. `run`, `test` and `trace` reach the
//! edge of the engine adapter and stop there with an explicit message -
//! exit code 3 is reserved exactly for "not in this milestone".

use raptor_runtime_core::capabilities::Broker;
use raptor_runtime_core::digest;
use raptor_runtime_core::error::{ErrorCode, RaptorError, Result};
use raptor_runtime_core::graph;
use raptor_runtime_core::host::{load_project, Runtime, RuntimeOptions, HOST_MODULE_NAMES, RUNTIME_VERSION};
use raptor_runtime_core::json::{self, Json};
use raptor_runtime_core::manifest::{self, CapabilityKind, Grant, PolicyMode, MANIFEST_FILENAME};
use raptor_runtime_core::observe::Observer;
use raptor_runtime_core::paths;
use std::collections::BTreeMap;
use std::path::Path;

pub const EXIT_OK: i32 = 0;
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
/// The command is defined, but depends on a part arriving in a later
/// milestone. Distinct from an error, so automation can tell them apart.
pub const EXIT_NOT_YET: i32 = 3;

pub const POLICY_FILENAME: &str = "raptor.policy.json";
pub const LOCKFILE_NAME: &str = "raptor.lock.json";
pub const BUNDLE_NAME: &str = "raptor.bundle.json";

pub struct Outcome {
    pub code: i32,
    pub text: String,
    pub data: Json,
}

impl Outcome {
    fn ok(text: impl Into<String>, data: Json) -> Self {
        Self { code: EXIT_OK, text: text.into(), data }
    }

    fn fail(code: i32, text: impl Into<String>, data: Json) -> Self {
        Self { code, text: text.into(), data }
    }

    pub fn from_error(error: &RaptorError) -> Self {
        let mut detail = Json::object();
        for (key, value) in &error.detail {
            detail.insert(key.clone(), Json::string(value.clone()));
        }
        Self {
            code: EXIT_ERROR,
            text: format!("error {}: {}", error.code, error.message),
            data: Json::from_pairs([(
                "error",
                Json::from_pairs([
                    ("code", Json::string(error.code.as_str())),
                    ("message", Json::string(error.message.clone())),
                    ("detail", detail),
                ]),
            )]),
        }
    }
}

pub struct Input {
    pub cwd: String,
    pub positionals: Vec<String>,
    pub flags: BTreeMap<String, crate::args::Flag>,
    pub app_args: Vec<String>,
    pub policy_override: Option<PolicyMode>,
}

impl Input {
    fn flag(&self, name: &str) -> Option<&str> {
        match self.flags.get(name) {
            Some(crate::args::Flag::Value(value)) => Some(value),
            _ => None,
        }
    }
}

fn table(rows: &[(&str, String)]) -> String {
    let width = rows.iter().map(|(key, _)| key.len()).max().unwrap_or(0);
    rows.iter().map(|(key, value)| format!("  {key:<width$}  {value}")).collect::<Vec<_>>().join("\n")
}

// --- doctor ----------------------------------------------------------------

/// The modules published by this runtime; anything else is unsupported.
fn known_host_modules() -> Vec<String> {
    HOST_MODULE_NAMES.iter().map(|name| format!("raptor:{name}")).collect()
}

pub fn doctor(input: &Input) -> Outcome {
    let mut findings: Vec<(&str, String)> = Vec::new();

    let environment = Json::from_pairs([
        ("runtimeVersion", Json::string(RUNTIME_VERSION)),
        ("channel", Json::string("development")),
        ("binary", Json::string("raptor-runtime")),
        ("platform", Json::string(format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH))),
        ("engine", Json::string("stub (no JavaScript engine linked)")),
        ("host", Json::string("native")),
    ]);

    let loaded = load_project(&input.cwd);
    let mut payload = Json::object();
    payload.insert("environment", environment);

    let project = match loaded {
        Err(error) => {
            findings.push(("error", format!("{}: {}", error.code, error.message)));
            // An invalid manifest carries all its problems in the diagnostic; we
            // unpack them, so `doctor` shows them all at once instead of
            // sending the user back after each fix.
            if let Some(issues) = error.detail.get("issues") {
                for issue in issues.split("; ").filter(|issue| !issue.is_empty()) {
                    findings.push(("error", format!("{MANIFEST_FILENAME}: {issue}")));
                }
            }
            None
        }
        Ok(project) => {
            findings.push(("ok", format!("manifest found: {}", project.manifest_path)));
            Some(project)
        }
    };

    if let Some(project) = &project {
        let manifest = &project.manifest;
        let policy = input.policy_override.unwrap_or(manifest.policy);

        payload.insert(
            "project",
            Json::from_pairs([
                ("name", Json::string(manifest.name.clone())),
                ("version", Json::string(manifest.version.clone())),
                ("root", Json::string(project.project_root.clone())),
                ("entry", Json::string(manifest.entry.clone())),
                ("policy", Json::string(policy.as_str())),
            ]),
        );
        payload.insert("capabilities", manifest.capabilities_json());

        if manifest.capabilities.is_empty() {
            findings.push((
                if policy == PolicyMode::Production { "error" } else { "warn" },
                "no capability declared; in strict mode the application will not be able to read anything".to_string(),
            ));
        }
        if let Some(Grant::Targets(commands)) = manifest.capabilities.get(&CapabilityKind::ProcessSpawn) {
            if !commands.is_empty() {
                findings.push((
                    "warn",
                    format!("process.spawn is declared for: {}", commands.join(", ")),
                ));
            }
        }

        match graph::build(&project.project_root, &manifest.entry) {
            Err(error) => {
                findings.push(("error", format!("the static graph could not be built: {}", error.message)))
            }
            Ok(built) => {
                findings
                    .push(("ok", format!("static graph: {} modules from {}", built.modules.len(), built.entry)));
                payload.insert("modules", built.to_json());

                let known = known_host_modules();
                for specifier in &built.host_imports {
                    if specifier.starts_with("raptor:") && !known.contains(specifier) {
                        findings.push(("error", format!("unknown host module: {specifier}")));
                    }
                    if specifier.starts_with("node:") {
                        // Spec section 8: anything depending on internals is reported
                        // as unsupported, not emulated endlessly.
                        findings.push((
                            "warn",
                            format!(
                                "{specifier} bypasses the capability broker and does not exist in the native host"
                            ),
                        ));
                    }
                }
                for external in &built.external_imports {
                    findings
                        .push(("warn", format!("external package '{external}': requires the npm bridge (phase 3)")));
                }
                for problem in &built.unresolved {
                    findings.push((
                        "error",
                        format!("{}: {} - {}", problem.from, problem.specifier, problem.reason),
                    ));
                }
            }
        }
    }

    let errors = findings.iter().filter(|(level, _)| *level == "error").count();
    let warnings = findings.iter().filter(|(level, _)| *level == "warn").count();

    payload.insert(
        "findings",
        Json::array(findings.iter().map(|(level, message)| {
            Json::from_pairs([
                (
                    "level",
                    Json::string(if *level == "error" {
                        "error"
                    } else if *level == "warn" {
                        "warn"
                    } else {
                        "ok"
                    }),
                ),
                ("message", Json::string(message.clone())),
            ])
        })),
    );

    let header = format!(
        "RaptorRuntime {RUNTIME_VERSION} (native, development) - {}-{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let summary = table(&[
        ("binary", "raptor-runtime".to_string()),
        ("engine", engine_description()),
        (
            "project",
            project
                .as_ref()
                .map(|p| format!("{}@{}", p.manifest.name, p.manifest.version))
                .unwrap_or_else(|| "(not found)".to_string()),
        ),
    ]);
    let lines: Vec<String> =
        findings.iter().map(|(level, message)| format!("  [{level}] {message}")).collect();
    let text =
        format!("{header}\n{summary}\n\n{}\n\n  {errors} errors, {warnings} warnings", lines.join("\n"));

    if errors > 0 {
        Outcome::fail(EXIT_ERROR, text, payload)
    } else {
        Outcome::ok(text, payload)
    }
}

// --- init ------------------------------------------------------------------

const ENTRY_SOURCE: &str = r#"import { readText } from "raptor:files";
import observe from "raptor:observe";

/**
 * The application entry point. The runtime calls it after evaluating the
 * module and gives it the host context.
 */
export default async function main(): Promise<void> {
  const manifest: string = await readText("./raptor.runtime.json");
  observe.log("info", "app.started", { manifestBytes: manifest.length });
}
"#;

fn policy_file() -> String {
    json::to_string_pretty(&Json::from_pairs([
        (
            "development",
            Json::from_pairs([("onUndeclared", Json::string("prompt")), ("auditLog", Json::Null)]),
        ),
        (
            "production",
            Json::from_pairs([
                ("onUndeclared", Json::string("deny")),
                ("auditLog", Json::string("./.raptor/audit.jsonl")),
            ]),
        ),
    ])) + "\n"
}

fn manifest_for(name: &str) -> String {
    json::to_string_pretty(&Json::from_pairs([
        ("name", Json::string(name)),
        ("version", Json::string("0.1.0")),
        ("entry", Json::string("./src/main.ts")),
        ("policy", Json::string("development")),
        ("engines", Json::from_pairs([("raptorRuntime", Json::string(format!(">={RUNTIME_VERSION}")))])),
        (
            "capabilities",
            Json::from_pairs([
                ("files.read", Json::array([Json::string("./src"), Json::string("./raptor.runtime.json")])),
                ("files.write", Json::array([Json::string("./.raptor"), Json::string("./dist")])),
            ]),
        ),
        (
            "tasks",
            Json::from_pairs([("maxConcurrent", Json::from(64u64)), ("defaultDeadlineMs", Json::Null)]),
        ),
    ])) + "\n"
}

/// Writes only if the file doesn't exist: `init` never overwrites.
fn write_new(path: &str, contents: &str) -> Result<bool> {
    if Path::new(path).exists() {
        return Ok(false);
    }
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            RaptorError::new(ErrorCode::ModuleUnsupported, "could not create the directory")
                .with("path", path)
                .with("cause", error.to_string())
        })?;
    }
    std::fs::write(path, contents).map_err(|error| {
        RaptorError::new(ErrorCode::ModuleUnsupported, "could not write the file")
            .with("path", path)
            .with("cause", error.to_string())
    })?;
    Ok(true)
}

pub fn init(input: &Input) -> Result<Outcome> {
    let target = match input.positionals.first() {
        Some(name) => paths::resolve(&input.cwd, name),
        None => paths::normalize(&input.cwd),
    };
    let name = target.rsplit('/').find(|part| !part.is_empty()).unwrap_or("raptor-app").to_string();

    let files = [
        (MANIFEST_FILENAME, manifest_for(&name)),
        (POLICY_FILENAME, policy_file()),
        ("src/main.ts", ENTRY_SOURCE.to_string()),
        (".gitignore", ".raptor/\ndist/\n".to_string()),
    ];

    let mut written = Vec::new();
    let mut created = 0usize;
    for (path, contents) in &files {
        let full = paths::resolve(&target, path);
        let fresh = write_new(&full, contents)?;
        if fresh {
            created += 1;
        }
        written.push(Json::from_pairs([
            ("path", Json::string(*path)),
            ("status", Json::string(if fresh { "created" } else { "exists" })),
        ]));
    }

    let payload = Json::from_pairs([
        ("target", Json::string(target.clone())),
        ("name", Json::string(name)),
        ("written", Json::array(written)),
    ]);

    if created == 0 {
        return Ok(Outcome::fail(
            EXIT_ERROR,
            format!("the project already exists in {target}; nothing was overwritten"),
            payload,
        ));
    }

    let listing = files.iter().map(|(path, _)| format!("  {path}")).collect::<Vec<_>>().join("\n");
    Ok(Outcome::ok(
        format!(
            "RaptorRuntime project created in {target}\n{listing}\n\n  check: raptor-runtime doctor\n  package: raptor-runtime pack"
        ),
        payload,
    ))
}

// --- pack ------------------------------------------------------------------

pub fn pack(input: &Input) -> Result<Outcome> {
    let project = load_project(&input.cwd)?;
    let manifest = &project.manifest;
    let output = paths::resolve(&project.project_root, input.flag("out").unwrap_or("./dist"));

    let built = graph::build(&project.project_root, &manifest.entry)?;

    let blocking: Vec<_> =
        built.unresolved.iter().filter(|problem| !problem.specifier.starts_with("import(")).collect();
    if !blocking.is_empty() {
        let lines: Vec<String> =
            blocking.iter().map(|p| format!("  {}: {} - {}", p.from, p.specifier, p.reason)).collect();
        return Ok(Outcome::fail(
            EXIT_ERROR,
            format!("cannot package: unresolved imports\n{}", lines.join("\n")),
            built.to_json(),
        ));
    }
    if !built.external_imports.is_empty() {
        let lines: Vec<String> = built
            .external_imports
            .iter()
            .map(|name| format!("  {name} - requires the bridge to the npm registry (phase 3)"))
            .collect();
        return Ok(Outcome::fail(
            EXIT_ERROR,
            format!("cannot package: external packages unresolved in this phase\n{}", lines.join("\n")),
            built.to_json(),
        ));
    }

    let io = |error: std::io::Error, path: &str| {
        RaptorError::new(ErrorCode::ModuleUnsupported, "file operation failed")
            .with("path", path)
            .with("cause", error.to_string())
    };

    let _ = std::fs::remove_dir_all(Path::new(&output));
    std::fs::create_dir_all(Path::new(&paths::resolve(&output, "app"))).map_err(|e| io(e, &output))?;

    for module in &built.modules {
        let destination = paths::resolve(&output, &format!("app/{}", module.path.trim_start_matches("./")));
        if let Some(parent) = Path::new(&destination).parent() {
            std::fs::create_dir_all(parent).map_err(|e| io(e, &destination))?;
        }
        std::fs::copy(Path::new(&module.absolute_path), Path::new(&destination))
            .map_err(|e| io(e, &destination))?;
    }
    std::fs::copy(Path::new(&project.manifest_path), Path::new(&paths::resolve(&output, MANIFEST_FILENAME)))
        .map_err(|e| io(e, MANIFEST_FILENAME))?;

    let lockfile = Json::from_pairs([
        ("lockfileVersion", Json::from(1u64)),
        (
            "project",
            Json::from_pairs([
                ("name", Json::string(manifest.name.clone())),
                ("version", Json::string(manifest.version.clone())),
            ]),
        ),
        ("entry", Json::string(built.entry.clone())),
        (
            "modules",
            Json::array(built.modules.iter().map(|module| {
                Json::from_pairs([
                    ("path", Json::string(module.path.clone())),
                    ("integrity", Json::string(module.integrity.clone())),
                    ("byteLength", Json::from(module.byte_length)),
                    ("imports", Json::array(module.imports.iter().map(|i| Json::string(i.clone())))),
                    ("origin", Json::string("project")),
                ])
            })),
        ),
        (
            "dependencies",
            Json::array(manifest.dependencies.iter().map(|dependency| {
                Json::from_pairs([
                    ("name", Json::string(dependency.name.clone())),
                    ("range", Json::string(dependency.range.clone())),
                    ("integrity", dependency.integrity.clone().map_or(Json::Null, Json::string)),
                    ("origin", dependency.origin.clone().map_or(Json::Null, Json::string)),
                ])
            })),
        ),
        ("hostModules", Json::array(built.host_imports.iter().map(|i| Json::string(i.clone())))),
    ]);

    // Content fingerprint: depends only on the paths and hashes of the modules,
    // never on the clock or the filesystem order.
    let fingerprint = built
        .modules
        .iter()
        .map(|module| format!("{}\u{0}{}", module.path, module.integrity))
        .collect::<Vec<_>>()
        .join("\n");

    let bundle = Json::from_pairs([
        ("bundleVersion", Json::from(1u64)),
        ("name", Json::string(manifest.name.clone())),
        ("version", Json::string(manifest.version.clone())),
        ("entry", Json::string(format!("./app/{}", built.entry.trim_start_matches("./")))),
        ("policy", Json::string(manifest.policy.as_str())),
        ("engines", Json::from_pairs([("raptorRuntime", Json::string(manifest.raptor_runtime.clone()))])),
        ("capabilities", manifest.capabilities_json()),
        (
            "tasks",
            Json::from_pairs([
                ("maxConcurrent", Json::from(manifest.max_concurrent)),
                ("defaultDeadlineMs", manifest.default_deadline_ms.map_or(Json::Null, Json::from)),
            ]),
        ),
        ("contentIntegrity", Json::string(digest::integrity(fingerprint.as_bytes()))),
        ("lockfile", Json::string(format!("./{LOCKFILE_NAME}"))),
        ("builtWith", Json::string(format!("raptor-runtime@{RUNTIME_VERSION} (native)"))),
    ]);

    let lock_path = paths::resolve(&output, LOCKFILE_NAME);
    let bundle_path = paths::resolve(&output, BUNDLE_NAME);
    std::fs::write(Path::new(&lock_path), json::to_string_pretty(&lockfile) + "\n")
        .map_err(|e| io(e, &lock_path))?;
    std::fs::write(Path::new(&bundle_path), json::to_string_pretty(&bundle) + "\n")
        .map_err(|e| io(e, &bundle_path))?;

    let total: usize = built.modules.iter().map(|module| module.byte_length).sum();
    let text = format!(
        "unit packaged in {output}\n{}",
        table(&[
            ("modules", built.modules.len().to_string()),
            ("bytes", total.to_string()),
            (
                "host modules",
                if built.host_imports.is_empty() {
                    "(none)".to_string()
                } else {
                    built.host_imports.join(", ")
                }
            ),
            (
                "integrity",
                bundle.get("contentIntegrity").and_then(Json::as_str).unwrap_or_default().to_string()
            ),
            ("lockfile", LOCKFILE_NAME.to_string()),
        ])
    );

    Ok(Outcome::ok(
        text,
        Json::from_pairs([
            ("outputDirectory", Json::string(output)),
            ("bundle", bundle),
            ("lockfile", lockfile),
        ]),
    ))
}

// --- run / test / trace ----------------------------------------------------

/// Starts the native runtime. Everything that can be done without an engine is
/// done; module evaluation stops at the edge of the adapter, with an explicit message.
/// Which engine the binary has, for diagnostics.
///
/// The text comes from the same source as the engine actually used by `run`, so
/// `doctor` cannot end up reporting anything other than what happens.
#[cfg(feature = "quickjs")]
fn engine_description() -> String {
    // The two capabilities compose: a binary can have an engine without TypeScript,
    // and `doctor` must say exactly which is the case.
    let typescript = if cfg!(feature = "typescript") { "with TypeScript" } else { "JavaScript only" };
    format!("quickjs, {typescript}")
}

#[cfg(not(feature = "quickjs"))]
fn engine_description() -> String {
    "stub (no JavaScript evaluation)".to_string()
}

/// The engine used by `run`.
///
/// Without the `quickjs` feature, the binary stays free of external dependencies
/// and without an engine - `None` lets the host fall back to the stub, which
/// honestly says what is missing. With it, we get a real QuickJS isolate.
#[cfg(feature = "quickjs")]
fn engine_for_run() -> Result<Option<std::sync::Arc<dyn raptor_runtime_core::engine::EngineAdapter>>> {
    let engine = raptor_runtime_core::quickjs::QuickJsEngine::new("iso-run")?;
    Ok(Some(std::sync::Arc::new(engine)))
}

#[cfg(not(feature = "quickjs"))]
fn engine_for_run() -> Result<Option<std::sync::Arc<dyn raptor_runtime_core::engine::EngineAdapter>>> {
    Ok(None)
}

pub fn run(input: &Input) -> Result<Outcome> {
    let project = load_project(&input.cwd)?;
    let policy = input.policy_override.unwrap_or(project.manifest.policy);
    let mut manifest = project.manifest.clone();
    manifest.policy = policy;

    let observer = Observer::new();
    let runtime = Runtime::new(RuntimeOptions {
        project_root: project.project_root.clone(),
        manifest,
        args: input.app_args.clone(),
        observer: observer.clone(),
        engine: engine_for_run()?,
        strict: None,
    });

    let started = runtime.start();
    runtime.shutdown("run-complete");

    let diagnostics = runtime.diagnostics();
    match started {
        Ok(evaluation) => {
            // The exports are the only observable proof that the module was
            // *evaluated*, not just parsed: without them, `run` would look the same
            // even if the engine had skipped the module body.
            let exports = Json::Object(evaluation.exports.clone().into_iter().collect());
            let names: Vec<String> = evaluation.exports.keys().cloned().collect();
            let text = format!(
                "the application ran in {:.1}ms
{}",
                evaluation.duration_ms,
                table(&[
                    ("project", format!("{}@{}", project.manifest.name, project.manifest.version)),
                    ("engine", runtime.engine_name().to_string()),
                    (
                        "exports",
                        if names.is_empty() { "(none)".to_string() } else { names.join(", ") }
                    ),
                ]),
            );
            Ok(Outcome::ok(text, Json::from_pairs([("diagnostics", diagnostics), ("exports", exports)])))
        }
        Err(error) if error.code == ErrorCode::ModuleUnsupported => {
            let text = format!(
                "the native host is ready, but cannot yet evaluate modules\n{}\n\n  {}\n  {}",
                table(&[
                    ("project", format!("{}@{}", project.manifest.name, project.manifest.version)),
                    ("policy", format!("{}{}", policy.as_str(), if runtime.broker().strict() { ", strict" } else { "" })),
                    ("host modules", HOST_MODULE_NAMES.len().to_string()),
                    ("engine", "stub".to_string()),
                ]),
                error.message,
                "until then, use the TypeScript launcher: `raptor-runtime run` from packages/runtime-cli",
            );
            Ok(Outcome::fail(
                EXIT_NOT_YET,
                text,
                Json::from_pairs([
                    ("diagnostics", diagnostics),
                    (
                        "blocked",
                        Json::from_pairs([
                            ("reason", Json::string("engine-missing")),
                            ("milestone", Json::string("1 - developer core")),
                        ]),
                    ),
                ]),
            ))
        }
        Err(error) => Ok(Outcome::from_error(&error)),
    }
}

pub fn not_yet(command: &str, needs: &str) -> Outcome {
    Outcome::fail(
        EXIT_NOT_YET,
        format!(
            "`raptor-runtime {command}` exists in the native host, but needs {needs}.\n  \
             Until then, use the TypeScript launcher from packages/runtime-cli."
        ),
        Json::from_pairs([(
            "blocked",
            Json::from_pairs([
                ("command", Json::string(command)),
                ("reason", Json::string("engine-missing")),
                ("needs", Json::string(needs)),
            ]),
        )]),
    )
}

/// Capability check without running the application: answers "would the
/// application be allowed to do X?" using exactly the broker it would receive at runtime.
pub fn explain(input: &Input) -> Result<Outcome> {
    let project = load_project(&input.cwd)?;
    let policy = input.policy_override.unwrap_or(project.manifest.policy);
    let broker = Broker::new(
        &project.project_root,
        project.manifest.capabilities.clone(),
        policy,
        None,
        Observer::quiet(),
    );

    let Some(capability) = input.positionals.first().and_then(|name| CapabilityKind::parse(name)) else {
        let valid: Vec<String> =
            raptor_runtime_core::manifest::CAPABILITY_KINDS.iter().map(|k| k.as_str().to_string()).collect();
        return Ok(Outcome::fail(
            EXIT_USAGE,
            format!("explain requires a capability: {}", valid.join(", ")),
            Json::from_pairs([("valid", Json::array(valid.iter().map(|v| Json::string(v.clone()))))]),
        ));
    };
    let target = input.positionals.get(1).cloned().unwrap_or_default();

    let decision = broker.check(capability, &target);
    let text = format!(
        "{} {} '{}'\n{}",
        if decision.granted { "GRANTED " } else { "DENIED  " },
        capability,
        decision.target,
        table(&[
            ("reason", decision.reason.clone()),
            ("rule", decision.rule.clone().unwrap_or_else(|| "(none)".to_string())),
            ("policy", format!("{}{}", policy.as_str(), if broker.strict() { ", strict" } else { "" })),
            ("annotated in trace", decision.annotated.to_string()),
        ])
    );

    Ok(Outcome {
        code: if decision.granted { EXIT_OK } else { EXIT_ERROR },
        text,
        data: Json::from_pairs([
            ("granted", Json::Bool(decision.granted)),
            ("capability", Json::string(capability.as_str())),
            ("target", Json::string(decision.target)),
            ("reason", Json::string(decision.reason)),
            ("rule", decision.rule.map_or(Json::Null, Json::string)),
            ("policy", Json::string(policy.as_str())),
            ("strict", Json::Bool(broker.strict())),
        ]),
    })
}

pub fn parse_policy(value: &str) -> Option<PolicyMode> {
    manifest::PolicyMode::parse(value)
}
