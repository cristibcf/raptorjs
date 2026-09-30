//! The `raptor.runtime.json` manifest (spec sections 7 and 8).
//!
//! The schema is identical to the one in the TypeScript implementation - the
//! same file must be accepted by both, otherwise migrating to the native host
//! is not a migration but a rewrite.
//!
//! The parser does not stop at the first problem: it collects every irregularity
//! so that `doctor` can report them all in a single diagnostic.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::{self, Json};
use std::collections::BTreeMap;

pub const MANIFEST_FILENAME: &str = "raptor.runtime.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CapabilityKind {
    FilesRead,
    FilesWrite,
    NetConnect,
    /// Opening a listening port. Same target form as `NetConnect`
    /// (`host:port`, with `*` accepted), so `127.0.0.1:*` means "local
    /// only, any port". It exists because `serve.listen` bound ports with
    /// an empty manifest (audit 2026-09-24, S4).
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

    /// Ambient capabilities are boolean; the rest carry a list of targets.
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
    /// Declared targets: paths, `host:port`, variable names, or commands.
    Targets(Vec<String>),
    /// Ambient capability, explicitly turned on or off.
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
        issues.push(Issue::new("capabilities", "must be an object"));
        return out;
    };

    for (key, entry) in map {
        let Some(kind) = CapabilityKind::parse(key) else {
            let valid: Vec<&str> = CAPABILITY_KINDS.iter().map(|k| k.as_str()).collect();
            issues.push(Issue::new(
                format!("capabilities.{key}"),
                format!("unknown capability (valid: {})", valid.join(", ")),
            ));
            continue;
        };

        if kind.is_ambient() {
            match entry.as_bool() {
                Some(flag) => {
                    out.insert(kind, Grant::Ambient(flag));
                }
                None => issues.push(Issue::new(format!("capabilities.{key}"), "must be a boolean")),
            }
            continue;
        }

        match entry.as_array() {
            Some(items) if items.iter().all(|item| item.as_str().is_some()) => {
                let targets = items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect();
                out.insert(kind, Grant::Targets(targets));
            }
            _ => issues.push(Issue::new(format!("capabilities.{key}"), "must be a list of strings")),
        }
    }
    out
}

fn read_dependencies(raw: Option<&Json>, issues: &mut Vec<Issue>) -> Vec<Dependency> {
    let Some(value) = raw else { return Vec::new() };
    let Some(map) = value.as_object() else {
        issues.push(Issue::new("dependencies", "must be an object of name -> spec"));
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
                "requires a version string or { range, integrity?, origin? }",
            )),
        }
    }
    // `BTreeMap` already yields them sorted by name; the lockfile relies on that.
    out
}

pub fn parse(source: &str) -> ParseOutcome {
    let raw = match json::parse(source) {
        Ok(value) => value,
        Err(error) => {
            return ParseOutcome {
                manifest: None,
                issues: vec![Issue::new("", format!("invalid JSON: {error}"))],
            }
        }
    };

    let Some(object) = raw.as_object() else {
        return ParseOutcome {
            manifest: None,
            issues: vec![Issue::new("", "the manifest must be a JSON object")],
        };
    };

    let mut issues = Vec::new();

    let name = object.get("name").and_then(Json::as_str).map(str::to_string);
    if name.is_none() {
        issues.push(Issue::new("name", "required field (string)"));
    }

    let version = match object.get("version") {
        None => "0.0.0".to_string(),
        Some(value) => match value.as_str() {
            Some(text) => text.to_string(),
            None => {
                issues.push(Issue::new("version", "must be a string"));
                "0.0.0".to_string()
            }
        },
    };

    let entry = object.get("entry").and_then(Json::as_str).map(str::to_string);
    if entry.is_none() {
        issues.push(Issue::new("entry", "required field: the entry module"));
    }

    let policy = match object.get("policy") {
        None => PolicyMode::Development,
        Some(value) => match value.as_str().and_then(PolicyMode::parse) {
            Some(mode) => mode,
            None => {
                issues.push(Issue::new("policy", "must be 'development' or 'production'"));
                PolicyMode::Development
            }
        },
    };

    let mut raptor_runtime = "*".to_string();
    if let Some(engines) = object.get("engines") {
        match engines.as_object() {
            None => issues.push(Issue::new("engines", "must be an object")),
            Some(map) => {
                if let Some(value) = map.get("raptorRuntime") {
                    match value.as_str() {
                        Some(text) => raptor_runtime = text.to_string(),
                        None => issues
                            .push(Issue::new("engines.raptorRuntime", "must be a version string")),
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
            None => issues.push(Issue::new("tasks", "must be an object")),
            Some(map) => {
                if let Some(value) = map.get("maxConcurrent") {
                    match value.as_number() {
                        Some(number) if number.fract() == 0.0 && number >= 1.0 => {
                            max_concurrent = number as usize
                        }
                        _ => {
                            issues.push(Issue::new("tasks.maxConcurrent", "must be a positive integer"))
                        }
                    }
                }
                match map.get("defaultDeadlineMs") {
                    None | Some(Json::Null) => {}
                    Some(value) => match value.as_number() {
                        Some(number) if number > 0.0 => default_deadline_ms = Some(number as u64),
                        _ => issues.push(Issue::new(
                            "tasks.defaultDeadlineMs",
                            "must be a positive number or null",
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

/// The failing variant; used after diagnostics have been reported.
pub fn require(source: &str) -> Result<Manifest> {
    let outcome = parse(source);
    match outcome.manifest {
        Some(manifest) => Ok(manifest),
        None => {
            let rendered: Vec<String> = outcome.issues.iter().map(Issue::render).collect();
            Err(RaptorError::new(ErrorCode::ManifestInvalid, format!("{MANIFEST_FILENAME} is invalid"))
                .with("issues", rendered.join("; ")))
        }
    }
}

impl Manifest {
    /// Capabilities in JSON form, for diagnostics and for the bundle.
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
        let manifest = require(r#"{"name":"app","entry":"./src/main.ts"}"#).expect("valid manifest");
        assert_eq!(manifest.name, "app");
        assert_eq!(manifest.version, "0.0.0");
        assert_eq!(manifest.policy, PolicyMode::Development);
        assert_eq!(manifest.max_concurrent, 64);
        assert_eq!(manifest.default_deadline_ms, None);
        assert!(manifest.capabilities.is_empty(), "nothing is granted by default");
    }

    #[test]
    fn parserul_aduna_toate_problemele_nu_se_opreste_la_prima() {
        let outcome =
            parse(r#"{"policy":"haotic","capabilities":{"files.zbor":["."]},"tasks":{"maxConcurrent":0}}"#);
        assert!(outcome.manifest.is_none());
        let rendered: Vec<String> = outcome.issues.iter().map(Issue::render).collect();
        let joined = rendered.join("\n");
        for expected in ["name", "entry", "policy", "files.zbor", "tasks.maxConcurrent"] {
            assert!(joined.contains(expected), "missing '{expected}' from:\n{joined}");
        }
    }

    #[test]
    fn capabilitatile_cu_tinta_sunt_liste_cele_ambientale_boolean() {
        let manifest = require(
            r#"{"name":"a","entry":"./m.ts","capabilities":{"files.read":["./src"],"clock.real":false}}"#,
        )
        .expect("valid manifest");
        assert_eq!(
            manifest.capabilities.get(&CapabilityKind::FilesRead),
            Some(&Grant::Targets(vec!["./src".to_string()]))
        );
        assert_eq!(manifest.capabilities.get(&CapabilityKind::ClockReal), Some(&Grant::Ambient(false)));

        let bad = parse(r#"{"name":"a","entry":"./m.ts","capabilities":{"files.read":true}}"#);
        assert!(bad.manifest.is_none(), "a targeted capability does not accept a boolean");
    }

    #[test]
    fn fiecare_capability_cunoscuta_este_acceptata() {
        for kind in CAPABILITY_KINDS {
            let value = if kind.is_ambient() { "true".to_string() } else { "[\"x\"]".to_string() };
            let source =
                format!(r#"{{"name":"a","entry":"./m.ts","capabilities":{{"{}":{value}}}}}"#, kind.as_str());
            let manifest = require(&source).unwrap_or_else(|error| panic!("{kind} rejected: {error}"));
            assert!(manifest.capabilities.contains_key(&kind));
        }
    }

    #[test]
    fn dependintele_accepta_forma_scurta_si_pe_cea_cu_integritate() {
        let manifest = require(
            r#"{"name":"a","entry":"./m.ts","dependencies":{"zod":"^3.0.0","left-pad":{"range":"1.0.0","integrity":"sha256-x","origin":"npm"}}}"#,
        )
        .expect("valid manifest");
        assert_eq!(manifest.dependencies.len(), 2);
        assert_eq!(manifest.dependencies[0].name, "left-pad", "dependencies stay sorted");
        assert_eq!(manifest.dependencies[0].integrity.as_deref(), Some("sha256-x"));
        assert_eq!(manifest.dependencies[1].integrity, None);
    }

    #[test]
    fn manifestul_invalid_produce_o_eroare_raptor_cu_toate_diagnosticele() {
        let error = require("{}").expect_err("invalid manifest");
        assert_eq!(error.code, ErrorCode::ManifestInvalid);
        let issues = error.detail.get("issues").expect("diagnostics travel with the error");
        assert!(issues.contains("name") && issues.contains("entry"));
    }

    #[test]
    fn json_ul_invalid_nu_este_confundat_cu_un_manifest_gol() {
        let outcome = parse("{ nu e json }");
        assert!(outcome.manifest.is_none());
        assert!(outcome.issues[0].message.contains("invalid JSON"));
    }

    #[test]
    fn serializarea_manifestului_este_determinista_si_reparsabila() {
        let manifest = require(
            r#"{"name":"a","version":"1.2.3","entry":"./m.ts","policy":"production","capabilities":{"net.connect":["api.example.com:443"]}}"#,
        )
        .expect("valid manifest");
        let text = json::to_string_pretty(&manifest.to_json());
        assert_eq!(text, json::to_string_pretty(&manifest.to_json()));
        let round_trip = require(&text).expect("the serialized manifest stays valid");
        assert_eq!(round_trip, manifest);
    }
}
