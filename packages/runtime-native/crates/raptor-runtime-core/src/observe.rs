//! Telemetry core (spec sectiunea 5): loguri, span-uri si metrici structurate
//! din prima zi.
//!
//! Nu exista "print ad-hoc" in host. Fiecare eveniment trece pe aici, ca
//! `raptor-runtime trace` sa poata emite un flux compatibil OpenTelemetry fara
//! sa instrumenteze retroactiv codul.
//!
//! `Observer` este `Clone` si partajeaza acelasi jurnal: il poti da mai departe
//! unui worker fara sa pierzi evenimentele si fara sincronizare manuala.

use crate::json::Json;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Debug => "debug",
            Severity::Info => "info",
            Severity::Warn => "warn",
            Severity::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Log,
    Span,
    Metric,
    Capability,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Log => "log",
            EventKind::Span => "span",
            EventKind::Metric => "metric",
            EventKind::Capability => "capability",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// Milisecunde de la pornirea recorder-ului; monoton.
    pub at: f64,
    pub kind: EventKind,
    pub name: String,
    pub severity: Severity,
    pub attributes: BTreeMap<String, Json>,
    pub span_id: Option<String>,
    pub parent_span_id: Option<String>,
    pub duration_ms: Option<f64>,
}

impl Event {
    pub fn to_json(&self) -> Json {
        let mut out = Json::object();
        out.insert("at", Json::Number(self.at));
        out.insert("kind", Json::string(self.kind.as_str()));
        out.insert("name", Json::string(self.name.clone()));
        out.insert("severity", Json::string(self.severity.as_str()));
        out.insert("attributes", Json::Object(self.attributes.clone()));
        if let Some(id) = &self.span_id {
            out.insert("spanId", Json::string(id.clone()));
        }
        if let Some(id) = &self.parent_span_id {
            out.insert("parentSpanId", Json::string(id.clone()));
        }
        if let Some(duration) = self.duration_ms {
            out.insert("durationMs", Json::Number(duration));
        }
        out
    }
}

/// Sursa de timp, injectabila ca testele sa fie deterministe.
enum Clock {
    Monotonic(Instant),
    Frozen,
}

struct Recorder {
    events: Mutex<Vec<Event>>,
    clock: Clock,
    minimum: Severity,
    span_counter: AtomicU64,
}

impl Recorder {
    fn stamp(&self) -> f64 {
        match &self.clock {
            Clock::Monotonic(origin) => origin.elapsed().as_secs_f64() * 1000.0,
            Clock::Frozen => 0.0,
        }
    }

    fn record(&self, event: Event) {
        if event.severity < self.minimum {
            return;
        }
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
    }
}

#[derive(Clone)]
pub struct Observer {
    inner: Arc<Recorder>,
    scope: String,
}

impl Observer {
    pub fn new() -> Self {
        Self::with(Clock::Monotonic(Instant::now()), Severity::Debug)
    }

    /// Observer cu ceas inghetat: toate evenimentele au `at == 0`. Pentru teste
    /// care verifica structura, nu durata.
    pub fn frozen() -> Self {
        Self::with(Clock::Frozen, Severity::Debug)
    }

    /// Observer care pastreaza doar erorile; pentru cai in care telemetria nu
    /// este ceruta, dar un esec tot trebuie sa lase urma.
    pub fn quiet() -> Self {
        Self::with(Clock::Monotonic(Instant::now()), Severity::Error)
    }

    fn with(clock: Clock, minimum: Severity) -> Self {
        Self {
            inner: Arc::new(Recorder {
                events: Mutex::new(Vec::new()),
                clock,
                minimum,
                span_counter: AtomicU64::new(0),
            }),
            scope: String::new(),
        }
    }

    /// Sub-scop cu acelasi jurnal: numele evenimentelor devin `scop.nume`.
    pub fn child(&self, scope: &str) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            scope: if self.scope.is_empty() { scope.to_string() } else { format!("{}.{scope}", self.scope) },
        }
    }

    fn qualify(&self, name: &str) -> String {
        if self.scope.is_empty() {
            name.to_string()
        } else {
            format!("{}.{name}", self.scope)
        }
    }

    pub fn record(&self, event: Event) {
        self.inner.record(event);
    }

    pub fn log(&self, severity: Severity, name: &str, attributes: BTreeMap<String, Json>) {
        self.inner.record(Event {
            at: self.inner.stamp(),
            kind: EventKind::Log,
            name: self.qualify(name),
            severity,
            attributes,
            span_id: None,
            parent_span_id: None,
            duration_ms: None,
        });
    }

    /// Log fara atribute; forma scurta, cea mai folosita.
    pub fn note(&self, severity: Severity, name: &str) {
        self.log(severity, name, BTreeMap::new());
    }

    pub fn metric(&self, name: &str, value: f64, mut attributes: BTreeMap<String, Json>) {
        attributes.insert("value".to_string(), Json::Number(value));
        self.inner.record(Event {
            at: self.inner.stamp(),
            kind: EventKind::Metric,
            name: self.qualify(name),
            severity: Severity::Info,
            attributes,
            span_id: None,
            parent_span_id: None,
            duration_ms: None,
        });
    }

    pub fn capability_event(&self, name: &str, severity: Severity, attributes: BTreeMap<String, Json>) {
        self.inner.record(Event {
            at: self.inner.stamp(),
            kind: EventKind::Capability,
            name: name.to_string(),
            severity,
            attributes,
            span_id: None,
            parent_span_id: None,
            duration_ms: None,
        });
    }

    /// Deschide un span. Daca `Span` este aruncat fara `end`, se inchide singur
    /// la `Drop` - un span pierdut ar fi o gaura in urma de executie.
    pub fn start_span(&self, name: &str) -> Span {
        let id = self.inner.span_counter.fetch_add(1, Ordering::Relaxed) + 1;
        Span {
            observer: self.clone(),
            id: format!("{}-{id}", if self.scope.is_empty() { "root" } else { &self.scope }),
            name: self.qualify(name),
            started_at: self.inner.stamp(),
            attributes: BTreeMap::new(),
            ended: false,
        }
    }

    pub fn events(&self) -> Vec<Event> {
        self.inner.events.lock().map(|events| events.clone()).unwrap_or_default()
    }

    /// Flux de linii JSON, o linie per eveniment.
    pub fn to_json_lines(&self) -> String {
        self.events()
            .iter()
            .map(|event| crate::json::to_string(&event.to_json()))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl Default for Observer {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Span {
    observer: Observer,
    id: String,
    name: String,
    started_at: f64,
    attributes: BTreeMap<String, Json>,
    ended: bool,
}

impl Span {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn set(&mut self, key: &str, value: Json) {
        self.attributes.insert(key.to_string(), value);
    }

    pub fn end(mut self) {
        self.finish();
    }

    /// Inchide span-ul marcandu-l ca esuat, cu motivul in atribute.
    pub fn end_with_error(mut self, error: &str) {
        self.attributes.insert("error".to_string(), Json::string(error));
        self.finish();
    }

    fn finish(&mut self) {
        if self.ended {
            return;
        }
        self.ended = true;
        let severity = if self.attributes.contains_key("error") { Severity::Error } else { Severity::Info };
        let now = self.observer.inner.stamp();
        self.observer.inner.record(Event {
            at: self.started_at,
            kind: EventKind::Span,
            name: self.name.clone(),
            severity,
            attributes: std::mem::take(&mut self.attributes),
            span_id: Some(self.id.clone()),
            parent_span_id: None,
            duration_ms: Some((now - self.started_at).max(0.0)),
        });
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attributes(pairs: &[(&str, Json)]) -> BTreeMap<String, Json> {
        pairs.iter().map(|(key, value)| ((*key).to_string(), value.clone())).collect()
    }

    #[test]
    fn logurile_poarta_scopul_severitatea_si_atributele() {
        let observer = Observer::frozen();
        observer.log(Severity::Info, "gata", attributes(&[("octeti", Json::from(12u64))]));

        let events = observer.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "gata");
        assert_eq!(events[0].severity, Severity::Info);
        assert_eq!(events[0].attributes.get("octeti"), Some(&Json::Number(12.0)));
    }

    #[test]
    fn sub_scopurile_prefixeaza_numele_dar_impart_jurnalul() {
        let observer = Observer::frozen();
        let child = observer.child("tasks");
        let grandchild = child.child("worker");

        child.note(Severity::Info, "pornit");
        grandchild.note(Severity::Warn, "incetinit");

        let names: Vec<String> = observer.events().iter().map(|event| event.name.clone()).collect();
        assert_eq!(names, vec!["tasks.pornit", "tasks.worker.incetinit"]);
    }

    #[test]
    fn span_ul_se_inchide_si_fara_apel_explicit() {
        let observer = Observer::frozen();
        {
            let mut span = observer.start_span("munca");
            span.set("pasi", Json::from(3u64));
            // Iesim din scop fara `end()`: `Drop` trebuie sa il inchida oricum.
        }
        let events = observer.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::Span);
        assert!(events[0].duration_ms.is_some());
        assert_eq!(events[0].attributes.get("pasi"), Some(&Json::Number(3.0)));
    }

    #[test]
    fn un_span_incheiat_cu_eroare_are_severitate_de_eroare() {
        let observer = Observer::frozen();
        observer.start_span("fetch").end_with_error("conexiune refuzata");
        let events = observer.events();
        assert_eq!(events[0].severity, Severity::Error);
        assert_eq!(events[0].attributes.get("error"), Some(&Json::string("conexiune refuzata")));
    }

    #[test]
    fn un_span_nu_poate_fi_inregistrat_de_doua_ori() {
        let observer = Observer::frozen();
        observer.start_span("o-singura-data").end();
        assert_eq!(observer.events().len(), 1);
    }

    #[test]
    fn observerul_linistit_pastreaza_doar_erorile() {
        let observer = Observer::quiet();
        observer.note(Severity::Info, "zgomot");
        observer.note(Severity::Error, "chiar conteaza");
        let events = observer.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "chiar conteaza");
    }

    #[test]
    fn jurnalul_se_serializeaza_ca_linii_json_independente() {
        let observer = Observer::frozen();
        observer.note(Severity::Info, "unu");
        observer.metric("doi", 2.0, BTreeMap::new());

        let serialized = observer.to_json_lines();
        let lines: Vec<&str> = serialized.lines().collect();
        assert_eq!(lines.len(), 2);
        for line in lines {
            crate::json::parse(line).expect("fiecare linie este JSON valid de sine statator");
        }
    }

    #[test]
    fn clonele_scriu_in_acelasi_jurnal_din_fire_diferite() {
        let observer = Observer::frozen();
        let handles: Vec<_> = (0..4)
            .map(|index| {
                let scoped = observer.child(&format!("fir{index}"));
                std::thread::spawn(move || scoped.note(Severity::Info, "gata"))
            })
            .collect();
        for handle in handles {
            handle.join().expect("firul se incheie curat");
        }
        assert_eq!(observer.events().len(), 4);
    }
}
