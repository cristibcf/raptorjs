//! The RaptorRuntime host: ties manifest, capabilities, task fabric, telemetry
//! and the engine adapter into a single object with an explicit lifecycle.
//!
//! It is the same contract the TypeScript variant implements, so that migration
//! is a replacement, not a rewrite. The launcher knows nothing about the engine
//! - it knows only this API.

use crate::capabilities::Broker;
use crate::engine::{EngineAdapter, HostModules, StubEngine};
use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use crate::manifest::{Manifest, PolicyMode, MANIFEST_FILENAME};
use crate::observe::{Observer, Severity};
use crate::paths;
use crate::tasks::TaskFabric;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const RUNTIME_VERSION: &str = "0.1.0";

/// The names of the modules published under `raptor:` (spec section 6).
pub const HOST_MODULE_NAMES: [&str; 8] =
    ["files", "net", "process", "kv", "serve", "tasks", "observe", "capabilities"];

static ISOLATE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct Runtime {
    project_root: String,
    manifest: Manifest,
    broker: Arc<Broker>,
    tasks: Arc<TaskFabric>,
    observer: Observer,
    engine: Arc<dyn EngineAdapter>,
    args: Vec<String>,
    started: std::sync::Mutex<bool>,
    stopped: std::sync::Mutex<bool>,
}

pub struct RuntimeOptions {
    pub project_root: String,
    pub manifest: Manifest,
    pub args: Vec<String>,
    pub observer: Observer,
    pub engine: Option<Arc<dyn EngineAdapter>>,
    /// Forces strict mode, regardless of the manifest policy.
    pub strict: Option<bool>,
}

impl Runtime {
    pub fn new(options: RuntimeOptions) -> Self {
        let project_root = paths::normalize(&options.project_root);
        let observer = options.observer;

        let broker = Arc::new(Broker::new(
            &project_root,
            options.manifest.capabilities.clone(),
            options.manifest.policy,
            Some(options.strict.unwrap_or(options.manifest.policy == PolicyMode::Production)),
            observer.child("capability"),
        ));

        let tasks = Arc::new(TaskFabric::new(
            options.manifest.max_concurrent,
            options.manifest.default_deadline_ms,
            observer.child("tasks"),
        ));

        let engine = options.engine.unwrap_or_else(|| {
            let id = ISOLATE_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
            Arc::new(StubEngine::new(format!("iso{id}")))
        });

        Self {
            project_root,
            manifest: options.manifest,
            broker,
            tasks,
            observer,
            engine,
            args: options.args,
            started: std::sync::Mutex::new(false),
            stopped: std::sync::Mutex::new(false),
        }
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn broker(&self) -> &Arc<Broker> {
        &self.broker
    }

    pub fn tasks(&self) -> &Arc<TaskFabric> {
        &self.tasks
    }

    pub fn observer(&self) -> &Observer {
        &self.observer
    }

    pub fn project_root(&self) -> &str {
        &self.project_root
    }

    /// The description of the `raptor:` modules published to the isolate. Once
    /// the engine exists, this same list becomes the importable namespace.
    /// The `raptor:` modules published to the isolate.
    ///
    /// Until the engine is bound, these were descriptors: names and nothing
    /// more. Now they are native functions that pass through *this* broker and
    /// write to *this* observer - so the capabilities declared in the manifest
    /// really do affect what the application code can do.
    fn host_modules(&self) -> HostModules {
        crate::modules::build(
            Arc::clone(&self.broker),
            self.observer.clone(),
            self.project_root.clone(),
            self.args.clone(),
        )
    }

    /// The name of the engine bound to this runtime; `doctor` and `run` report it.
    pub fn engine_name(&self) -> &str {
        self.engine.name()
    }

    pub fn start(&self) -> Result<crate::engine::Evaluation> {
        {
            let mut started = self.started.lock().expect("the state is not poisoned");
            if *started {
                return Err(RaptorError::new(ErrorCode::EngineEvaluation, "the runtime has already been started"));
            }
            *started = true;
        }

        let entry_path = paths::resolve(&self.project_root, &self.manifest.entry);
        if !paths::contains(&self.project_root, &entry_path) {
            return Err(RaptorError::new(
                ErrorCode::ModuleNotFound,
                "the entry point must be inside the project root",
            )
            .with("entry", self.manifest.entry.clone())
            .with("projectRoot", self.project_root.clone()));
        }

        self.observer.log(
            Severity::Info,
            "runtime.start",
            BTreeMap::from([
                ("project".to_string(), Json::string(self.manifest.name.clone())),
                ("version".to_string(), Json::string(self.manifest.version.clone())),
                ("entry".to_string(), Json::string(self.manifest.entry.clone())),
                ("policy".to_string(), Json::string(self.manifest.policy.as_str())),
                ("runtimeVersion".to_string(), Json::string(RUNTIME_VERSION)),
                ("engine".to_string(), Json::string(self.engine.name())),
                ("args".to_string(), Json::array(self.args.iter().map(|a| Json::string(a.clone())))),
            ]),
        );

        self.engine.install(self.host_modules())?;
        self.engine.evaluate(&entry_path)
    }

    /// Clean shutdown: cancels in-flight work, drains, releases the isolate.
    /// Idempotent.
    pub fn shutdown(&self, reason: &str) {
        {
            let mut stopped = self.stopped.lock().expect("the state is not poisoned");
            if *stopped {
                return;
            }
            *stopped = true;
        }
        self.observer.log(
            Severity::Info,
            "runtime.shutdown",
            BTreeMap::from([("reason".to_string(), Json::string(reason))]),
        );
        self.tasks.shutdown(reason);
        self.engine.dispose();
    }

    pub fn diagnostics(&self) -> Json {
        Json::from_pairs([
            ("runtimeVersion", Json::string(RUNTIME_VERSION)),
            (
                "engine",
                Json::from_pairs([
                    ("name", Json::string(self.engine.name())),
                    ("version", Json::string(self.engine.version())),
                    ("isolate", Json::string(self.engine.isolate_id())),
                ]),
            ),
            (
                "project",
                Json::from_pairs([
                    ("name", Json::string(self.manifest.name.clone())),
                    ("version", Json::string(self.manifest.version.clone())),
                    ("root", Json::string(self.project_root.clone())),
                    ("entry", Json::string(self.manifest.entry.clone())),
                ]),
            ),
            ("capabilities", self.broker.diagnostics()),
            ("tasks", self.tasks.stats().to_json()),
            (
                "hostModules",
                Json::array(HOST_MODULE_NAMES.iter().map(|name| Json::string(format!("raptor:{name}")))),
            ),
        ])
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.shutdown("drop");
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoadedProject {
    pub project_root: String,
    pub manifest_path: String,
    pub manifest: Manifest,
}

/// Searches for `raptor.runtime.json` upward, from `from` to the disk root.
pub fn load_project(from: &str) -> Result<LoadedProject> {
    let mut current = paths::normalize(from);
    loop {
        let candidate = paths::resolve(&current, MANIFEST_FILENAME);
        if let Ok(source) = std::fs::read_to_string(Path::new(&candidate)) {
            // A present but invalid manifest is an error here, not a reason to
            // keep going up and find another project by accident.
            let manifest = crate::manifest::require(&source)?;
            return Ok(LoadedProject { project_root: current, manifest_path: candidate, manifest });
        }
        let parent = paths::parent(&current);
        if parent == current {
            return Err(RaptorError::new(
                ErrorCode::ManifestMissing,
                format!("did not find {MANIFEST_FILENAME} starting from {from}"),
            )
            .with("from", from));
        }
        current = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest;

    struct Fixture {
        root: String,
    }

    impl Fixture {
        fn new(manifest_source: &str, files: &[(&str, &str)]) -> Self {
            let unique = format!(
                "raptor-host-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            );
            let root = paths::normalize(std::env::temp_dir().join(unique).to_str().expect("path"));
            std::fs::create_dir_all(Path::new(&root)).expect("root");
            std::fs::write(Path::new(&paths::resolve(&root, MANIFEST_FILENAME)), manifest_source)
                .expect("manifest");
            for (path, contents) in files {
                let full = paths::resolve(&root, path);
                std::fs::create_dir_all(Path::new(&paths::parent(&full))).expect("directory");
                std::fs::write(Path::new(&full), contents).expect("file");
            }
            Self { root }
        }

        fn runtime(&self, manifest: Manifest) -> Runtime {
            Runtime::new(RuntimeOptions {
                project_root: self.root.clone(),
                manifest,
                args: vec!["--port".to_string(), "8080".to_string()],
                observer: Observer::frozen(),
                engine: None,
                strict: None,
            })
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(Path::new(&self.root));
        }
    }

    const BASIC: &str = r#"{"name":"fixture","version":"1.0.0","entry":"./src/main.ts"}"#;

    #[test]
    fn load_project_urca_pana_la_manifest() {
        let fixture = Fixture::new(BASIC, &[("src/adanc/mai-adanc/nota.txt", "x")]);
        let deep = paths::resolve(&fixture.root, "./src/adanc/mai-adanc");
        let loaded = load_project(&deep).expect("project found");
        assert_eq!(loaded.project_root, fixture.root);
        assert_eq!(loaded.manifest.name, "fixture");
    }

    #[test]
    fn lipsa_manifestului_este_raportata_cu_cod_stabil_nu_prin_ciclare() {
        let root = paths::normalize(std::env::temp_dir().to_str().expect("temp"));
        let orphan = paths::resolve(&root, &format!("raptor-orfan-{}", std::process::id()));
        std::fs::create_dir_all(Path::new(&orphan)).expect("directory");
        let error = load_project(&orphan).expect_err("no manifest");
        assert_eq!(error.code, ErrorCode::ManifestMissing);
        let _ = std::fs::remove_dir_all(Path::new(&orphan));
    }

    #[test]
    fn un_manifest_invalid_nu_este_sarit_in_favoarea_unuia_de_mai_sus() {
        let fixture = Fixture::new(r#"{"version":3}"#, &[]);
        let error = load_project(&fixture.root).expect_err("invalid manifest");
        assert_eq!(error.code, ErrorCode::ManifestInvalid);
    }

    #[test]
    fn start_publica_modulele_raptor_inainte_de_evaluare() {
        let fixture = Fixture::new(BASIC, &[("src/main.ts", "export default () => undefined;")]);
        let engine = Arc::new(StubEngine::new("iso-test"));
        let runtime = Runtime::new(RuntimeOptions {
            project_root: fixture.root.clone(),
            manifest: manifest::require(BASIC).expect("manifest"),
            args: Vec::new(),
            observer: Observer::frozen(),
            engine: Some(engine.clone()),
            strict: None,
        });

        // Without an engine, evaluation fails, but the modules are already installed.
        let error = runtime.start().expect_err("stub without engine");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
        assert_eq!(engine.installed_modules().len(), HOST_MODULE_NAMES.len());
        assert!(engine.installed_modules().contains(&"files".to_string()));
        runtime.shutdown("test");
    }

    #[test]
    fn un_punct_de_intrare_din_afara_radacinii_este_refuzat() {
        let source = r#"{"name":"fixture","entry":"../escape.ts"}"#;
        let fixture = Fixture::new(source, &[]);
        let runtime = fixture.runtime(manifest::require(source).expect("manifest"));
        let error = runtime.start().expect_err("deny");
        assert_eq!(error.code, ErrorCode::ModuleNotFound);
    }

    #[test]
    fn runtime_ul_nu_poate_fi_pornit_de_doua_ori() {
        let fixture = Fixture::new(BASIC, &[("src/main.ts", "export default () => undefined;")]);
        let runtime = fixture.runtime(manifest::require(BASIC).expect("manifest"));
        let _ = runtime.start();
        let error = runtime.start().expect_err("second start");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }

    #[test]
    fn shutdown_este_idempotent_si_dreneaza_task_urile() {
        let fixture = Fixture::new(BASIC, &[("src/main.ts", "export default () => undefined;")]);
        let runtime = fixture.runtime(manifest::require(BASIC).expect("manifest"));

        runtime
            .tasks()
            .spawn("background", Default::default(), |context| {
                context.sleep(std::time::Duration::from_secs(30));
                context.check()
            })
            .expect("launch");

        runtime.shutdown("test");
        runtime.shutdown("test");
        assert!(runtime.tasks().is_closed());
        assert_eq!(runtime.tasks().stats().active, 0);
    }

    #[test]
    fn politica_de_productie_trece_host_ul_in_regim_strict() {
        let source = r#"{"name":"fixture","entry":"./src/main.ts","policy":"production"}"#;
        let fixture = Fixture::new(source, &[]);
        let runtime = fixture.runtime(manifest::require(source).expect("manifest"));
        assert!(runtime.broker().strict());
        assert!(!runtime.broker().check(crate::manifest::CapabilityKind::FilesRead, "./src/main.ts").granted);
    }

    #[test]
    fn diagnosticul_descrie_versiunea_motorul_proiectul_si_capabilitatile() {
        let fixture = Fixture::new(BASIC, &[("src/main.ts", "export default () => undefined;")]);
        let runtime = fixture.runtime(manifest::require(BASIC).expect("manifest"));
        let diagnostics = runtime.diagnostics();

        assert_eq!(diagnostics.get("runtimeVersion").and_then(Json::as_str), Some(RUNTIME_VERSION));
        assert_eq!(
            diagnostics.get("engine").and_then(|engine| engine.get("name")).and_then(Json::as_str),
            Some("stub")
        );
        assert_eq!(
            diagnostics.get("project").and_then(|project| project.get("name")).and_then(Json::as_str),
            Some("fixture")
        );
        assert!(diagnostics.get("capabilities").is_some());
        assert_eq!(
            diagnostics.get("hostModules").and_then(Json::as_array).map(<[Json]>::len),
            Some(HOST_MODULE_NAMES.len())
        );
    }

    #[test]
    fn fiecare_modul_de_host_este_legat_de_izolatul_curent() {
        let fixture = Fixture::new(BASIC, &[]);
        let runtime = fixture.runtime(manifest::require(BASIC).expect("manifest"));
        let modules = runtime.host_modules();
        assert_eq!(modules.len(), HOST_MODULE_NAMES.len());
        for (name, descriptor) in modules {
            assert_eq!(
                descriptor.descriptor.get("module").and_then(Json::as_str),
                Some(format!("raptor:{name}").as_str())
            );
            assert!(!descriptor.function_names().is_empty(), "the module publishes native functions");
        }
    }
}
