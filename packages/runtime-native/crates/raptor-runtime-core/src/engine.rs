//! The engine adapter (spec sections 5 and 13).
//!
//! The JavaScript engine sits behind this interface precisely so that replacing
//! it changes no application API. The spec recommends V8 "through a narrow
//! adapter" - this is the adapter, defined before the engine exists, so that the
//! rest of the host cannot quietly grow dependencies on it.
//!
//! In milestone 0 the only implementation is [`StubEngine`], which **fails
//! explicitly**. This is a deliberate choice: a host that pretends it ran the
//! code would be worse than one that says it has no engine yet. Everything that
//! does not require JavaScript evaluation - manifest, capabilities, graph,
//! packing, diagnostics - already works natively.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use std::collections::BTreeMap;
use std::sync::Arc;

/// A host function, callable from JavaScript.
///
/// The signature is deliberately narrow: JSON arguments, JSON response or a
/// Raptor error. Application code never receives a host handle (spec section 5),
/// and the engine need know nothing about files, sockets or clocks - only how to
/// move values across the boundary.
pub type HostFunction = Arc<dyn Fn(&[Json]) -> Result<Json> + Send + Sync>;

/// A `raptor:` module: constants plus native functions.
///
/// The separation matters. `descriptor` holds values that do not change at run
/// time (`args`, `platform`) and can be copied straight into the isolate;
/// `functions` are the only way the application reaches the outside world, and
/// each of them passes through the capability broker before doing anything.
#[derive(Clone)]
pub struct HostModule {
    pub descriptor: Json,
    pub functions: BTreeMap<String, HostFunction>,
}

impl HostModule {
    pub fn new(descriptor: Json) -> Self {
        Self { descriptor, functions: BTreeMap::new() }
    }

    pub fn with(
        mut self,
        name: impl Into<String>,
        body: impl Fn(&[Json]) -> Result<Json> + Send + Sync + 'static,
    ) -> Self {
        self.functions.insert(name.into(), Arc::new(body));
        self
    }

    /// The function names, sorted; used by diagnostics and by tests.
    pub fn function_names(&self) -> Vec<String> {
        self.functions.keys().cloned().collect()
    }
}

impl std::fmt::Debug for HostModule {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostModule")
            .field("descriptor", &self.descriptor)
            .field("functions", &self.function_names())
            .finish()
    }
}

/// Which `raptor:` modules are published to an isolate.
pub type HostModules = BTreeMap<String, HostModule>;

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// The entry module's exports, in serializable form.
    pub exports: BTreeMap<String, Json>,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphNode {
    pub specifier: String,
    pub url: String,
    pub kind: &'static str,
}

pub trait EngineAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn version(&self) -> String;
    /// The isolate identifier: host objects are bound to it, so two runtimes in
    /// the same process cannot end up sharing them.
    fn isolate_id(&self) -> &str;

    /// Publishes the `raptor:` modules for the current isolate.
    fn install(&self, modules: HostModules) -> Result<()>;
    fn evaluate(&self, entry_path: &str) -> Result<Evaluation>;
    fn module_graph(&self) -> Vec<GraphNode>;
    fn dispose(&self);
}

/// Engineless adapter. Honestly reports what is missing, instead of simulating a
/// run. Everything else in the host remains fully functional.
pub struct StubEngine {
    isolate_id: String,
    installed: std::sync::Mutex<Vec<String>>,
}

impl StubEngine {
    pub fn new(isolate_id: impl Into<String>) -> Self {
        Self { isolate_id: isolate_id.into(), installed: std::sync::Mutex::new(Vec::new()) }
    }

    /// The `raptor:` modules the host has published. Even without an engine,
    /// this is verifiable - and it is what the contract suite tests.
    pub fn installed_modules(&self) -> Vec<String> {
        self.installed.lock().map(|names| names.clone()).unwrap_or_default()
    }
}

impl EngineAdapter for StubEngine {
    fn name(&self) -> &str {
        "stub"
    }

    fn version(&self) -> String {
        "0.0.0".to_string()
    }

    fn isolate_id(&self) -> &str {
        &self.isolate_id
    }

    fn install(&self, modules: HostModules) -> Result<()> {
        if let Ok(mut installed) = self.installed.lock() {
            *installed = modules.keys().cloned().collect();
        }
        Ok(())
    }

    fn evaluate(&self, entry_path: &str) -> Result<Evaluation> {
        Err(RaptorError::new(
            ErrorCode::ModuleUnsupported,
            "this binary has no JavaScript engine bound yet; \
             module evaluation belongs to the next milestone (spec section 13: V8 through a narrow adapter)",
        )
        .with("entry", entry_path)
        .with("engine", "stub")
        .with("isolate", self.isolate_id.clone()))
    }

    fn module_graph(&self) -> Vec<GraphNode> {
        Vec::new()
    }

    fn dispose(&self) {
        if let Ok(mut installed) = self.installed.lock() {
            installed.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_ul_publica_modulele_dar_refuza_evaluarea() {
        let engine = StubEngine::new("iso1");
        engine
            .install(BTreeMap::from([
                ("files".to_string(), HostModule::new(Json::object())),
                ("observe".to_string(), HostModule::new(Json::object())),
            ]))
            .expect("install");

        assert_eq!(engine.installed_modules(), ["files", "observe"]);

        let error = engine.evaluate("./src/main.ts").expect_err("no engine");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
        assert_eq!(error.detail.get("engine").map(String::as_str), Some("stub"));
        assert!(
            error.message.contains("JavaScript engine"),
            "the message must say exactly what is missing: {}",
            error.message
        );
    }

    #[test]
    fn dispose_elibereaza_modulele_izolatului() {
        let engine = StubEngine::new("iso2");
        engine.install(BTreeMap::from([("files".to_string(), HostModule::new(Json::object()))])).expect("install");
        engine.dispose();
        assert!(engine.installed_modules().is_empty());
    }

    #[test]
    fn adaptorul_poate_fi_trimis_intre_fire() {
        // `EngineAdapter: Send + Sync` is not decorative: the host shares it
        // with the tasks. If someone adds a field that is not Sync, this test
        // stops compiling - exactly when it should.
        fn require_send_sync<T: Send + Sync>(_: &T) {}
        require_send_sync(&StubEngine::new("iso3"));

        let engine = std::sync::Arc::new(StubEngine::new("iso4"));
        let shared = std::sync::Arc::clone(&engine);
        std::thread::spawn(move || shared.isolate_id().to_string()).join().expect("thread finished");
    }
}
