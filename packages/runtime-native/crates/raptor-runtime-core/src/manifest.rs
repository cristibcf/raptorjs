//! Manifestul `raptor.runtime.json` (spec sectiunile 7 si 8).
//!
//! Schema este identica cu cea a implementarii TypeScript - acelasi fisier
//! trebuie sa fie acceptat de ambele, altfel migrarea la host-ul nativ nu este
//! o migrare, ci o rescriere.
//!
//! Parserul nu se opreste la prima problema: aduna toate neregulile, ca `doctor`
//! sa le poata raporta intr-un singur diagnostic.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::{self, Json};
use std::collections::BTreeMap;

pub const MANIFEST_FILENAME: &str = "raptor.runtime.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CapabilityKind {
    FilesRead,
    FilesWrite,
    NetConnect,
    /// A deschide un port de ascultare. Aceeasi forma de tinta ca `NetConnect`
    /// (`gazda:port`, cu `*` acceptat), deci `127.0.0.1:*` inseamna "doar
    /// local, orice port". Exista pentru ca `serve.listen` lega porturi cu
    /// manifestul gol (audit 2026-09-24, S4).
    NetListen,
    EnvRead,
    ProcessSpawn,
    ClockReal,
    CryptoRandom,
}

pub const CAPABILITY_KINDS: [CapabilityKind; 8] = [
    CapabilityKind::FilesRead,
    CapabilityKind::FilesWrite,
    CapabilityKind::NetConnect,
    CapabilityKind::NetListen,
    CapabilityKind::EnvRead,
    CapabilityKind::ProcessSpawn,
    CapabilityKind::ClockReal,
    CapabilityKind::CryptoRandom,
];

impl CapabilityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CapabilityKind::FilesRead => "files.read",
            CapabilityKind::FilesWrite => "files.write",
            CapabilityKind::NetConnect => "net.connect",
            CapabilityKind::NetListen => "net.listen",
            CapabilityKind::EnvRead => "env.read",
            CapabilityKind::ProcessSpawn => "process.spawn",
            CapabilityKind::ClockReal => "clock.real",
            CapabilityKind::CryptoRandom => "crypto.random",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        CAPABILITY_KINDS.into_iter().find(|kind| kind.as_str() == text)
    }

    /// Capabilitatile ambientale sunt boolean; restul poarta o lista de tinte.
    pub fn is_ambient(self) -> bool {
        matches!(self, CapabilityKind::ClockReal | CapabilityKind::CryptoRandom)
    }
}

impl std::fmt::Display for CapabilityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Grant {
    /// Tinte declarate: cai, `gazda:port`, nume de variabile sau comenzi.
    Targets(Vec<String>),
    /// Capabilitate ambientala, pornita sau oprita explicit.
    Ambient(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyMode {
    Development,
    Production,
}

impl PolicyMode {
    pub fn as_str(self) -> &'static str {
        match self {
            PolicyMode::Development => "development",
            PolicyMode::Production => "production",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "development" => Some(PolicyMode::Development),
            "production" => Some(PolicyMode::Production),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dependency {
    pub name: String,
    pub range: String,
    pub integrity: Option<String>,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub entry: String,
    pub policy: PolicyMode,
    pub raptor_runtime: String,
    pub capabilities: BTreeMap<CapabilityKind, Grant>,
    pub dependencies: Vec<Dependency>,
    pub max_concurrent: usize,
    pub default_deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub path: String,
    pub message: String,
}

impl Issue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self { path: path.into(), message: message.into() }
    }

    pub fn render(&self) -> String {
        if self.path.is_empty() {
            self.message.clone()
        } else {
            format!("{}: {}", self.path, self.message)
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseOutcome {
    pub manifest: Option<Manifest>,
    pub issues: Vec<Issue>,
}

fn read_capabilities(raw: Option<&Json>, issues: &mut Vec<Issue>) -> BTreeMap<CapabilityKind, Grant> {
    let mut out = BTreeMap::new();
    let Some(value) = raw else { return out };
    let Some(map) = value.as_object() else {
        issues.push(Issue::new("capabilities", "trebuie sa fie un obiect"));
        return out;
    };

    for (key, entry) in map {
        let Some(kind) = CapabilityKind::parse(key) else {
            let valid: Vec<&str> = CAPABILITY_KINDS.iter().map(|k| k.as_str()).collect();
            issues.push(Issue::new(
                format!("capabilities.{key}"),
                format!("capability necunoscuta (valide: {})", valid.join(", ")),
            ));
            continue;
        };

        if kind.is_ambient() {
            match entry.as_bool() {
                Some(flag) => {
                    out.insert(kind, Grant::Ambient(flag));
                }
                None => issues.push(Issue::new(format!("capabilities.{key}"), "trebuie sa fie boolean")),
            }
            continue;
        }

        match entry.as_array() {
            Some(items) if items.iter().all(|item| item.as_str().is_some()) => {
                let targets = items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect();
                out.insert(kind, Grant::Targets(targets));
            }
            _ => issues.push(Issue::new(format!("capabilities.{key}"), "trebuie sa fie o lista de siruri")),
        }
    }
    out
}

fn read_dependencies(raw: Option<&Json>, issues: &mut Vec<Issue>) -> Vec<Dependency> {
    let Some(value) = raw else { return Vec::new() };
    let Some(map) = value.as_object() else {
        issues.push(Issue::new("dependencies", "trebuie sa fie un obiect nume -> specificatie"));
        return Vec::new();
    };

    let mut out = Vec::new();
    for (name, entry) in map {
        if let Some(range) = entry.as_str() {
            out.push(Dependency {
                name: name.clone(),
                range: range.to_string(),
                integrity: None,
                origin: None,
            });
            continue;
        }
        match entry.get("range").and_then(Json::as_str) {
            Some(range) => out.push(Dependency {
                name: name.clone(),
                range: range.to_string(),
                integrity: entry.get("integrity").and_then(Json::as_str).map(str::to_string),
                origin: entry.get("origin").and_then(Json::as_str).map(str::to_string),
            }),
            None => issues.push(Issue::new(
                format!("dependencies.{name}"),
                "cere un sir de versiune sau { range, integrity?, origin? }",
            )),
        }
    }
    // `BTreeMap` le da deja sortate dupa nume; lockfile-ul se bazeaza pe asta.
    out
}

pub fn parse(source: &str) -> ParseOutcome {
    let raw = match json::parse(source) {
        Ok(value) => value,
        Err(error) => {
            return ParseOutcome {
                manifest: None,
                issues: vec![Issue::new("", format!("JSON invalid: {error}"))],
            }
        }
    };

    let Some(object) = raw.as_object() else {
        return ParseOutcome {
            manifest: None,
            issues: vec![Issue::new("", "manifestul trebuie sa fie un obiect JSON")],
        };
    };

    let mut issues = Vec::new();

    let name = object.get("name").and_then(Json::as_str).map(str::to_string);
    if name.is_none() {
        issues.push(Issue::new("name", "camp obligatoriu (sir)"));
    }

    let version = match object.get("version") {
        None => "0.0.0".to_string(),
        Some(value) => match value.as_str() {
            Some(text) => text.to_string(),
            None => {
                issues.push(Issue::new("version", "trebuie sa fie un sir"));
                "0.0.0".to_string()
            }
        },
    };

    let entry = object.get("entry").and_then(Json::as_str).map(str::to_string);
    if entry.is_none() {
        issues.push(Issue::new("entry", "camp obligatoriu: modulul de pornire"));
    }

    let policy = match object.get("policy") {
        None => PolicyMode::Development,
        Some(value) => match value.as_str().and_then(PolicyMode::parse) {
            Some(mode) => mode,
            None => {
                issues.push(Issue::new("policy", "trebuie sa fie 'development' sau 'production'"));
                PolicyMode::Development
            }
        },
    };

    let mut raptor_runtime = "*".to_string();
    if let Some(engines) = object.get("engines") {
        match engines.as_object() {
            None => issues.push(Issue::new("engines", "trebuie sa fie un obiect")),
            Some(map) => {
                if let Some(value) = map.get("raptorRuntime") {
                    match value.as_str() {
                        Some(text) => raptor_runtime = text.to_string(),
                        None => issues
                            .push(Issue::new("engines.raptorRuntime", "trebuie sa fie un sir de versiune")),
                    }
                }
            }
        }
    }

    let capabilities = read_capabilities(object.get("capabilities"), &mut issues);
    let dependencies = read_dependencies(object.get("dependencies"), &mut issues);

    let mut max_concurrent = 64usize;
    let mut default_deadline_ms = None;
    if let Some(tasks) = object.get("tasks") {
        match tasks.as_object() {
            None => issues.push(Issue::new("tasks", "trebuie sa fie un obiect")),
            Some(map) => {
                if let Some(value) = map.get("maxConcurrent") {
                    match value.as_number() {
                        Some(number) if number.fract() == 0.0 && number >= 1.0 => {
                            max_concurrent = number as usize
                        }
                        _ => {
                            issues.push(Issue::new("tasks.maxConcurrent", "trebuie sa fie un intreg pozitiv"))
                        }
                    }
                }
                match map.get("defaultDeadlineMs") {
                    None | Some(Json::Null) => {}
                    Some(value) => match value.as_number() {
                        Some(number) if number > 0.0 => default_deadline_ms = Some(number as u64),
                        _ => issues.push(Issue::new(
                            "tasks.defaultDeadlineMs",
                            "trebuie sa fie un numar pozitiv sau null",
                        )),
                    },
                }
            }
        }
    }

    match (name, entry) {
        (Some(name), Some(entry)) if issues.is_empty() => ParseOutcome {
            manifest: Some(Manifest {
                name,
                version,
                entry,
                policy,
                raptor_runtime,
                capabilities,
                dependencies,
                max_concurrent,
                default_deadline_ms,
            }),
            issues: Vec::new(),
        },
        _ => ParseOutcome { manifest: None, issues },
    }
}

/// Varianta care esueaza; folosita dupa ce diagnosticele au fost raportate.
pub fn require(source: &str) -> Result<Manifest> {
    let outcome = parse(source);
    match outcome.manifest {
        Some(manifest) => Ok(manifest),
        None => {
            let rendered: Vec<String> = outcome.issues.iter().map(Issue::render).collect();
            Err(RaptorError::new(ErrorCode::ManifestInvalid, format!("{MANIFEST_FILENAME} este invalid"))
                .with("issues", rendered.join("; ")))
        }
    }
}

impl Manifest {
    /// Capabilitatile in forma JSON, pentru diagnostice si pentru bundle.
    pub fn capabilities_json(&self) -> Json {
        let mut out = Json::object();
        for (kind, grant) in &self.capabilities {
            let value = match grant {
                Grant::Ambient(flag) => Json::Bool(*flag),
                Grant::Targets(targets) => Json::array(targets.iter().map(|t| Json::string(t.clone()))),
            };
            out.insert(kind.as_str(), value);
        }
        out
    }

    pub fn to_json(&self) -> Json {
        let mut tasks = Json::object();
        tasks.insert("maxConcurrent", Json::from(self.max_concurrent));
        tasks.insert("defaultDeadlineMs", self.default_deadline_ms.map_or(Json::Null, Json::from));

        let mut dependencies = Json::object();
        for dependency in &self.dependencies {
            let mut entry = Json::object();
            entry.insert("range", Json::string(dependency.range.clone()));
            if let Some(integrity) = &dependency.integrity {
                entry.insert("integrity", Json::string(integrity.clone()));
            }
            if let Some(origin) = &dependency.origin {
                entry.insert("origin", Json::string(origin.clone()));
            }
            dependencies.insert(dependency.name.clone(), entry);
        }

        Json::from_pairs([
            ("name", Json::string(self.name.clone())),
            ("version", Json::string(self.version.clone())),
            ("entry", Json::string(self.entry.clone())),
            ("policy", Json::string(self.policy.as_str())),
            ("engines", Json::from_pairs([("raptorRuntime", Json::string(self.raptor_runtime.clone()))])),
            ("capabilities", self.capabilities_json()),
            ("dependencies", dependencies),
            ("tasks", tasks),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifestul_minim_cere_doar_nume_si_punct_de_intrare() {
        let manifest = require(r#"{"name":"app","entry":"./src/main.ts"}"#).expect("manifest valid");
        assert_eq!(manifest.name, "app");
        assert_eq!(manifest.version, "0.0.0");
        assert_eq!(manifest.policy, PolicyMode::Development);
        assert_eq!(manifest.max_concurrent, 64);
        assert_eq!(manifest.default_deadline_ms, None);
        assert!(manifest.capabilities.is_empty(), "implicit nu se acorda nimic");
    }

    #[test]
    fn parserul_aduna_toate_problemele_nu_se_opreste_la_prima() {
        let outcome =
            parse(r#"{"policy":"haotic","capabilities":{"files.zbor":["."]},"tasks":{"maxConcurrent":0}}"#);
        assert!(outcome.manifest.is_none());
        let rendered: Vec<String> = outcome.issues.iter().map(Issue::render).collect();
        let joined = rendered.join("\n");
        for expected in ["name", "entry", "policy", "files.zbor", "tasks.maxConcurrent"] {
            assert!(joined.contains(expected), "lipseste '{expected}' din:\n{joined}");
        }
    }

    #[test]
    fn capabilitatile_cu_tinta_sunt_liste_cele_ambientale_boolean() {
        let manifest = require(
            r#"{"name":"a","entry":"./m.ts","capabilities":{"files.read":["./src"],"clock.real":false}}"#,
        )
        .expect("manifest valid");
        assert_eq!(
            manifest.capabilities.get(&CapabilityKind::FilesRead),
            Some(&Grant::Targets(vec!["./src".to_string()]))
        );
        assert_eq!(manifest.capabilities.get(&CapabilityKind::ClockReal), Some(&Grant::Ambient(false)));

        let bad = parse(r#"{"name":"a","entry":"./m.ts","capabilities":{"files.read":true}}"#);
        assert!(bad.manifest.is_none(), "o capability cu tinta nu accepta boolean");
    }

    #[test]
    fn fiecare_capability_cunoscuta_este_acceptata() {
        for kind in CAPABILITY_KINDS {
            let value = if kind.is_ambient() { "true".to_string() } else { "[\"x\"]".to_string() };
            let source =
                format!(r#"{{"name":"a","entry":"./m.ts","capabilities":{{"{}":{value}}}}}"#, kind.as_str());
            let manifest = require(&source).unwrap_or_else(|error| panic!("{kind} respinsa: {error}"));
            assert!(manifest.capabilities.contains_key(&kind));
        }
    }

    #[test]
    fn dependintele_accepta_forma_scurta_si_pe_cea_cu_integritate() {
        let manifest = require(
            r#"{"name":"a","entry":"./m.ts","dependencies":{"zod":"^3.0.0","left-pad":{"range":"1.0.0","integrity":"sha256-x","origin":"npm"}}}"#,
        )
        .expect("manifest valid");
        assert_eq!(manifest.dependencies.len(), 2);
        assert_eq!(manifest.dependencies[0].name, "left-pad", "dependintele raman sortate");
        assert_eq!(manifest.dependencies[0].integrity.as_deref(), Some("sha256-x"));
        assert_eq!(manifest.dependencies[1].integrity, None);
    }

    #[test]
    fn manifestul_invalid_produce_o_eroare_raptor_cu_toate_diagnosticele() {
        let error = require("{}").expect_err("manifest invalid");
        assert_eq!(error.code, ErrorCode::ManifestInvalid);
        let issues = error.detail.get("issues").expect("diagnosticele calatoresc cu eroarea");
        assert!(issues.contains("name") && issues.contains("entry"));
    }

    #[test]
    fn json_ul_invalid_nu_este_confundat_cu_un_manifest_gol() {
        let outcome = parse("{ nu e json }");
        assert!(outcome.manifest.is_none());
        assert!(outcome.issues[0].message.contains("JSON invalid"));
    }

    #[test]
    fn serializarea_manifestului_este_determinista_si_reparsabila() {
        let manifest = require(
            r#"{"name":"a","version":"1.2.3","entry":"./m.ts","policy":"production","capabilities":{"net.connect":["api.example.com:443"]}}"#,
        )
        .expect("manifest valid");
        let text = json::to_string_pretty(&manifest.to_json());
        assert_eq!(text, json::to_string_pretty(&manifest.to_json()));
        let round_trip = require(&text).expect("manifestul serializat ramane valid");
        assert_eq!(round_trip, manifest);
    }
}
