//! Adaptorul de motor (spec sectiunile 5 si 13).
//!
//! Motorul JavaScript sta in spatele acestei interfete tocmai ca inlocuirea lui
//! sa nu schimbe niciun API de aplicatie. Spec-ul recomanda V8 "printr-un
//! adaptor ingust" - acesta este adaptorul, definit inainte sa existe motorul,
//! ca restul host-ului sa nu poata capata dependente de el pe furis.
//!
//! In milestone-ul 0 singura implementare este [`StubEngine`], care **esueaza
//! explicit**. Este o alegere deliberata: un host care se preface ca a rulat
//! codul ar fi mai rau decat unul care spune ca nu are inca motor. Tot ce nu
//! cere evaluare de JavaScript - manifest, capabilitati, graf, ambalare,
//! diagnostic - functioneaza deja nativ.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use std::collections::BTreeMap;
use std::sync::Arc;

/// O functie de host, apelabila din JavaScript.
///
/// Semnatura este deliberat ingusta: argumente JSON, raspuns JSON sau eroare
/// Raptor. Codul aplicatiei nu primeste niciodata un handle de host (spec
/// sectiunea 5), iar motorul nu trebuie sa stie nimic despre fisiere, socketi
/// sau ceasuri - doar sa mute valori peste granita.
pub type HostFunction = Arc<dyn Fn(&[Json]) -> Result<Json> + Send + Sync>;

/// Un modul `raptor:`: constante plus functii native.
///
/// Separarea conteaza. `descriptor` sunt valori care nu se schimba in timpul
/// rularii (`args`, `platform`) si pot fi copiate direct in izolat; `functions`
/// sunt singura cale prin care aplicatia atinge lumea de afara, si fiecare
/// dintre ele trece prin capability broker inainte sa faca ceva.
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

    /// Numele functiilor, sortate; folosit de diagnostic si de teste.
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

/// Ce module `raptor:` sunt publicate unui izolat.
pub type HostModules = BTreeMap<String, HostModule>;

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// Exporturile modulului de intrare, in forma serializabila.
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
    /// Identificatorul izolatului: obiectele de host sunt legate de el, deci
    /// doua runtime-uri din acelasi proces nu pot ajunge sa le imparta.
    fn isolate_id(&self) -> &str;

    /// Publica modulele `raptor:` pentru izolatul curent.
    fn install(&self, modules: HostModules) -> Result<()>;
    fn evaluate(&self, entry_path: &str) -> Result<Evaluation>;
    fn module_graph(&self) -> Vec<GraphNode>;
    fn dispose(&self);
}

/// Adaptor fara motor. Raporteaza cinstit ce lipseste, in loc sa simuleze o
/// rulare. Orice altceva din host ramane pe deplin functional.
pub struct StubEngine {
    isolate_id: String,
    installed: std::sync::Mutex<Vec<String>>,
}

impl StubEngine {
    pub fn new(isolate_id: impl Into<String>) -> Self {
        Self { isolate_id: isolate_id.into(), installed: std::sync::Mutex::new(Vec::new()) }
    }

    /// Modulele `raptor:` pe care host-ul le-a publicat. Chiar si fara motor,
    /// asta este verificabil - si este ce testeaza suita de contract.
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
            "acest binar nu are inca un motor JavaScript legat; \
             evaluarea modulelor apartine milestone-ului urmator (spec sectiunea 13: V8 printr-un adaptor ingust)",
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
            .expect("instalare");

        assert_eq!(engine.installed_modules(), ["files", "observe"]);

        let error = engine.evaluate("./src/main.ts").expect_err("fara motor");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
        assert_eq!(error.detail.get("engine").map(String::as_str), Some("stub"));
        assert!(
            error.message.contains("motor JavaScript"),
            "mesajul trebuie sa spuna exact ce lipseste: {}",
            error.message
        );
    }

    #[test]
    fn dispose_elibereaza_modulele_izolatului() {
        let engine = StubEngine::new("iso2");
        engine.install(BTreeMap::from([("files".to_string(), HostModule::new(Json::object()))])).expect("instalare");
        engine.dispose();
        assert!(engine.installed_modules().is_empty());
    }

    #[test]
    fn adaptorul_poate_fi_trimis_intre_fire() {
        // `EngineAdapter: Send + Sync` nu este decorativ: host-ul il partajeaza
        // cu task-urile. Daca cineva adauga un camp care nu este Sync, testul
        // acesta nu mai compileaza - exact cand trebuie.
        fn require_send_sync<T: Send + Sync>(_: &T) {}
        require_send_sync(&StubEngine::new("iso3"));

        let engine = std::sync::Arc::new(StubEngine::new("iso4"));
        let shared = std::sync::Arc::clone(&engine);
        std::thread::spawn(move || shared.isolate_id().to_string()).join().expect("fir incheiat");
    }
}
