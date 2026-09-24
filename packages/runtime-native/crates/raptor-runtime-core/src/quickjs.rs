//! Motorul QuickJS, in spatele lui [`EngineAdapter`](crate::engine::EngineAdapter).
//!
//! Aceasta este piesa care transforma binarul dintr-un verificator de manifeste
//! intr-un runtime: de aici incolo, `raptor-runtime run` chiar executa module,
//! fara Node instalat pe masina.
//!
//! **De ce QuickJS inaintea lui V8.** Spec-ul sectiunea 13 cere V8 "printr-un
//! adaptor ingust", si acela ramane tinta. Dar adaptorul exista tocmai ca
//! motorul sa poata fi schimbat fara sa atinga nimic din aplicatii, iar QuickJS
//! se compileaza din sursa C in zeci de secunde, nu in ore. Ordinea aleasa
//! dovedeste independenta de Node *acum* si lasa V8 sa intre mai tarziu prin
//! aceeasi usa.
//!
//! **Izolarea firelor.** `rquickjs::Runtime` nu poate fi partajat intre fire,
//! dar [`EngineAdapter`] cere `Send + Sync` pentru ca host-ul il imparte cu
//! task-urile. Solutia nu este un `unsafe impl`: motorul traieste pe **firul lui**
//! si primeste comenzi pe un canal. Asta este si mai aproape de adevar - un
//! izolat chiar apartine unui singur fir - si face ca un panic in JavaScript sa
//! ramana la el acasa.

use crate::engine::{EngineAdapter, Evaluation, GraphNode, HostModules};
use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;

use std::collections::BTreeMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// Comenzile pe care firul motorului le poate primi.
enum Command {
    Install(HostModules, Sender<Result<()>>),
    Evaluate(String, Sender<Result<Evaluation>>),
    Graph(Sender<Vec<GraphNode>>),
    Dispose,
}

pub struct QuickJsEngine {
    isolate_id: String,
    version: String,
    sender: Mutex<Option<Sender<Command>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl QuickJsEngine {
    pub fn new(isolate_id: impl Into<String>) -> Result<Self> {
        let isolate_id = isolate_id.into();
        let (sender, receiver) = channel::<Command>();
        let (ready_tx, ready_rx) = channel::<Result<String>>();

        let thread_id = isolate_id.clone();
        let thread = std::thread::Builder::new()
            .name(format!("raptor-isolate-{thread_id}"))
            // QuickJS foloseste stiva masinii pentru recursie in JavaScript;
            // stiva implicita a unui fir este prea mica pentru module reale.
            .stack_size(8 * 1024 * 1024)
            .spawn(move || engine_loop(receiver, ready_tx))
            .map_err(|error| {
                RaptorError::new(ErrorCode::EngineEvaluation, "nu am putut porni firul izolatului")
                    .with("cause", error.to_string())
            })?;

        let version = ready_rx
            .recv()
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "firul izolatului nu a raspuns la pornire"))??;

        Ok(Self {
            isolate_id,
            version,
            sender: Mutex::new(Some(sender)),
            thread: Mutex::new(Some(thread)),
        })
    }

    fn send<T>(&self, make: impl FnOnce(Sender<T>) -> Command) -> Result<T> {
        let (tx, rx) = channel::<T>();
        let guard = self
            .sender
            .lock()
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "izolatul este intr-o stare invalida"))?;
        let sender = guard
            .as_ref()
            .ok_or_else(|| RaptorError::new(ErrorCode::EngineEvaluation, "izolatul a fost inchis"))?;
        sender
            .send(make(tx))
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "firul izolatului s-a oprit"))?;
        rx.recv()
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "izolatul nu a raspuns"))
    }
}

impl EngineAdapter for QuickJsEngine {
    fn name(&self) -> &str {
        "quickjs"
    }

    fn version(&self) -> String {
        self.version.clone()
    }

    fn isolate_id(&self) -> &str {
        &self.isolate_id
    }

    fn install(&self, modules: HostModules) -> Result<()> {
        self.send(|tx| Command::Install(modules, tx))?
    }

    fn evaluate(&self, entry_path: &str) -> Result<Evaluation> {
        self.send(|tx| Command::Evaluate(entry_path.to_string(), tx))?
    }

    fn module_graph(&self) -> Vec<GraphNode> {
        self.send(Command::Graph).unwrap_or_default()
    }

    fn dispose(&self) {
        if let Ok(mut guard) = self.sender.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(Command::Dispose);
            }
        }
        if let Ok(mut guard) = self.thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }
}

impl Drop for QuickJsEngine {
    fn drop(&mut self) {
        self.dispose();
    }
}

/// Firul izolatului: creeaza runtime-ul QuickJS si il tine pana la `Dispose`.
fn engine_loop(receiver: std::sync::mpsc::Receiver<Command>, ready: Sender<Result<String>>) {
    let runtime = match rquickjs::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = ready.send(Err(RaptorError::new(
                ErrorCode::EngineEvaluation,
                format!("nu am putut crea runtime-ul QuickJS: {error}"),
            )));
            return;
        }
    };
    let context = match rquickjs::Context::full(&runtime) {
        Ok(context) => context,
        Err(error) => {
            let _ = ready.send(Err(RaptorError::new(
                ErrorCode::EngineEvaluation,
                format!("nu am putut crea contextul QuickJS: {error}"),
            )));
            return;
        }
    };

    let _ = ready.send(Ok(quickjs_version()));

    let mut host_modules: HostModules = BTreeMap::new();
    let mut graph: Vec<GraphNode> = Vec::new();

    while let Ok(command) = receiver.recv() {
        match command {
            Command::Install(modules, reply) => {
                host_modules = modules;
                let _ = reply.send(Ok(()));
            }
            Command::Evaluate(entry, reply) => {
                let outcome = evaluate_entry(&context, &host_modules, &entry, &mut graph);
                let _ = reply.send(outcome);
            }
            Command::Graph(reply) => {
                let _ = reply.send(graph.clone());
            }
            Command::Dispose => break,
        }
    }
}

/// Versiunea legaturii, fixata la compilare.
///
/// `env!("CARGO_PKG_VERSION")` ar da versiunea *nucleului*, nu a motorului - o
/// cifra care arata credibil si este gresita. Mai bine una scrisa explicit,
/// langa dependenta din `Cargo.toml`.
const QUICKJS_BINDING: &str = "rquickjs 0.14";

fn quickjs_version() -> String {
    QUICKJS_BINDING.to_string()
}

fn evaluate_entry(
    context: &rquickjs::Context,
    host_modules: &HostModules,
    entry_path: &str,
    graph: &mut Vec<GraphNode>,
) -> Result<Evaluation> {
    let source = std::fs::read_to_string(entry_path).map_err(|error| {
        RaptorError::new(ErrorCode::ModuleNotFound, "nu am putut citi modulul de intrare")
            .with("entry", entry_path)
            .with("cause", error.to_string())
    })?;

    // TypeScript trece printr-un parser adevarat inainte sa ajunga la motor.
    // QuickJS executa JavaScript; tipurile se elimina, nu se ignora.
    let source = if crate::typescript::needs_stripping(entry_path) {
        crate::typescript::strip(&source, entry_path)?
    } else {
        source
    };

    graph.clear();
    for name in host_modules.keys() {
        graph.push(GraphNode {
            specifier: format!("raptor:{name}"),
            url: format!("raptor:{name}"),
            kind: "raptor",
        });
    }
    graph.push(GraphNode { specifier: entry_path.to_string(), url: entry_path.to_string(), kind: "local" });

    let started = std::time::Instant::now();

    let exports = context.with(|ctx| -> Result<BTreeMap<String, Json>> {
        // Modulele `raptor:` se publica inainte de evaluare, ca importurile din
        // modulul de intrare sa le gaseasca deja declarate.
        install_host_objects(&ctx, host_modules)?;
        for (name, module) in host_modules {
            let source = synthesize_host_module(name, module);
            rquickjs::Module::declare(ctx.clone(), format!("raptor:{name}"), source)
                .map_err(|error| engine_error(&ctx, error, &format!("raptor:{name}")))?;
        }

        let declared = rquickjs::Module::declare(ctx.clone(), entry_path, source.clone())
            .map_err(|error| engine_error(&ctx, error, entry_path))?;
        let (module, promise) = declared.eval().map_err(|error| engine_error(&ctx, error, entry_path))?;
        promise.finish::<()>().map_err(|error| engine_error(&ctx, error, entry_path))?;

        let namespace = module.namespace().map_err(|error| engine_error(&ctx, error, entry_path))?;
        let mut exports = BTreeMap::new();
        for entry in namespace.props::<String, rquickjs::Value>() {
            let (key, value) = entry.map_err(|error| engine_error(&ctx, error, entry_path))?;
            exports.insert(key, to_json(&value));
        }
        Ok(exports)
    })?;

    Ok(Evaluation { exports, duration_ms: started.elapsed().as_secs_f64() * 1000.0 })
}

/// Numele registrului global in care traiesc obiectele de host ale izolatului.
///
/// Aceeasi conventie ca in launcher-ul TypeScript: un simbol global, nu o
/// variabila la vedere, ca sa nu fie atins din greseala de codul aplicatiei.
const HOST_REGISTRY: &str = "raptor.runtime.hostModules";

/// Construieste, pentru fiecare modul, un obiect JavaScript cu functiile native
/// legate, si il pune in registrul global al izolatului.
///
/// Functiile nu sunt copii de date: fiecare apel din JavaScript ajunge inapoi in
/// Rust, trece prin capability broker si abia apoi atinge discul sau mediul.
fn install_host_objects<'js>(ctx: &rquickjs::Ctx<'js>, host_modules: &HostModules) -> Result<()> {
    let registry = rquickjs::Object::new(ctx.clone()).map_err(|error| engine_error(ctx, error, HOST_REGISTRY))?;

    for (name, module) in host_modules {
        let object = rquickjs::Object::new(ctx.clone()).map_err(|error| engine_error(ctx, error, name))?;

        // Constantele se copiaza o data; nu se schimba in timpul rularii.
        if let Some(fields) = module.descriptor.as_object() {
            for (key, value) in fields {
                let js = json_to_js(ctx, value).map_err(|error| engine_error(ctx, error, name))?;
                object.set(key.as_str(), js).map_err(|error| engine_error(ctx, error, name))?;
            }
        }

        for (function_name, host_function) in &module.functions {
            let callable = Arc::clone(host_function);
            let label = format!("raptor:{name}.{function_name}");
            let bound = rquickjs::Function::new(
                ctx.clone(),
                move |ctx: rquickjs::Ctx<'js>,
                      args: rquickjs::function::Rest<rquickjs::Value<'js>>|
                      -> rquickjs::Result<rquickjs::Value<'js>> {
                    let arguments: Vec<Json> = args.0.iter().map(to_json).collect();
                    match callable(&arguments) {
                        Ok(value) => json_to_js(&ctx, &value),
                        Err(error) => {
                            // Eroarea Raptor devine o exceptie JavaScript care
                            // poarta acelasi cod: aplicatia o poate prinde si
                            // deosebi "nu ai voie" de "nu am putut".
                            let exception = rquickjs::Object::new(ctx.clone())?;
                            exception.set("name", "RaptorError")?;
                            exception.set("message", error.message.clone())?;
                            exception.set("code", error.code.as_str())?;
                            Err(ctx.throw(exception.into_value()))
                        }
                    }
                },
            )
            .map_err(|error| engine_error(ctx, error, &label))?;
            object.set(function_name.as_str(), bound).map_err(|error| engine_error(ctx, error, &label))?;
        }

        registry.set(name.as_str(), object).map_err(|error| engine_error(ctx, error, name))?;
    }

    ctx.globals().set(HOST_REGISTRY, registry).map_err(|error| engine_error(ctx, error, HOST_REGISTRY))?;
    Ok(())
}

/// Sursa sintetica a unui modul `raptor:`.
///
/// Modulul citeste obiectul din registru si il reexporta: implicit ca `default`
/// si fiecare functie ca export numit, ca `import { readText } from
/// "raptor:files"` sa mearga la fel ca `import files from "raptor:files"`.
fn synthesize_host_module(name: &str, module: &crate::engine::HostModule) -> String {
    let mut source = format!(
        "const __mod = globalThis[{registry}][{name}];\nexport default __mod;\n",
        registry = crate::json::to_string(&Json::string(HOST_REGISTRY)),
        name = crate::json::to_string(&Json::string(name)),
    );
    for function_name in module.functions.keys() {
        if !is_valid_export_name(function_name) {
            // Numele care nu pot fi legate (cuvinte rezervate ca `delete`, sau
            // identificatori invalizi) raman accesibile prin exportul implicit:
            // `kv.delete(...)` merge, `import { delete }` nu are cum.
            continue;
        }
        // Legarea pastreaza `this`, ca destructurarea din codul utilizatorului
        // sa nu piarda contextul modulului.
        source.push_str(&format!("export const {function_name} = __mod.{function_name}.bind(__mod);\n"));
    }
    source
}

/// Cuvintele rezervate ale limbajului nu pot fi nume de export numit.
///
/// Lista este scurta pentru ca acopera doar ce poate aparea ca nume de metoda
/// de host - `delete` din `raptor:kv` a fost cazul care a descoperit-o.
const RESERVED: [&str; 20] = [
    "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else", "export", "extends",
    "finally", "for", "function", "if", "import", "in", "new", "return",
];

fn is_valid_export_name(name: &str) -> bool {
    if name.is_empty() || RESERVED.contains(&name) {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap_or('0');
    (first.is_ascii_alphabetic() || first == '_' || first == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Conversie din `Json` in valoare JavaScript.
fn json_to_js<'js>(ctx: &rquickjs::Ctx<'js>, value: &Json) -> rquickjs::Result<rquickjs::Value<'js>> {
    use rquickjs::IntoJs;
    match value {
        Json::Null => Ok(rquickjs::Value::new_null(ctx.clone())),
        Json::Bool(flag) => flag.into_js(ctx),
        Json::Number(number) => number.into_js(ctx),
        Json::String(text) => text.as_str().into_js(ctx),
        Json::Array(items) => {
            let array = rquickjs::Array::new(ctx.clone())?;
            for (index, item) in items.iter().enumerate() {
                array.set(index, json_to_js(ctx, item)?)?;
            }
            Ok(array.into_value())
        }
        Json::Object(fields) => {
            let object = rquickjs::Object::new(ctx.clone())?;
            for (key, item) in fields {
                object.set(key.as_str(), json_to_js(ctx, item)?)?;
            }
            Ok(object.into_value())
        }
    }
}
/// Traduce o eroare a motorului intr-o eroare Raptor.
///
/// Partea care conteaza este mesajul. `rquickjs` raporteaza doar "Exception
/// generated by QuickJS" si lasa exceptia in asteptare pe context; daca ne-am
/// opri acolo, cineva care si-a stricat codul ar primi un text care nu spune
/// absolut nimic. Scoatem deci exceptia reala si o punem in mesaj, cu stiva in
/// detaliu.
fn engine_error(ctx: &rquickjs::Ctx<'_>, error: rquickjs::Error, entry: &str) -> RaptorError {
    let mut message = error.to_string();
    let mut stack: Option<String> = None;

    if error.is_exception() {
        let caught = ctx.catch();
        if let Some(exception) = caught.clone().into_exception() {
            let described = exception.message().unwrap_or_default();
            let kind = exception
                .get::<_, rquickjs::Value>("name")
                .ok()
                .and_then(|value| value.as_string().and_then(|text| text.to_string().ok()))
                .unwrap_or_else(|| "Error".to_string());
            if !described.is_empty() {
                message = format!("{kind}: {described}");
            }
            stack = exception.stack().filter(|text| !text.is_empty());
        } else if let Some(text) = caught.as_string().and_then(|value| value.to_string().ok()) {
            // O aruncare de valoare care nu este `Error` (`throw "text"`).
            message = text;
        }
    }

    let mut raptor =
        RaptorError::new(ErrorCode::EngineEvaluation, message).with("entry", entry).with("engine", "quickjs");
    if let Some(stack) = stack {
        raptor = raptor.with("stack", stack);
    }
    raptor
}

/// Conversie din valoare JavaScript in `Json`, pentru exporturile raportate.
fn to_json(value: &rquickjs::Value<'_>) -> Json {
    if value.is_bool() {
        return Json::Bool(value.as_bool().unwrap_or(false));
    }
    if value.is_number() {
        // QuickJS tine intregii ca `int32`, nu ca `f64`: `as_float()` intoarce
        // `None` pentru `42`, iar un `unwrap_or(0.0)` ar raporta tacit zero.
        if let Some(whole) = value.as_int() {
            return Json::Number(f64::from(whole));
        }
        if let Some(fractional) = value.as_float() {
            return Json::Number(fractional);
        }
        return Json::Null;
    }
    if value.is_string() {
        return value
            .as_string()
            .and_then(|text| text.to_string().ok())
            .map(Json::string)
            .unwrap_or(Json::Null);
    }
    if value.is_function() {
        // Functiile nu au reprezentare JSON; le raportam ca tip, ca `run` sa
        // poata spune ca exista un `export default` apelabil.
        return Json::string("[function]");
    }
    if value.is_null() || value.is_undefined() {
        return Json::Null;
    }
    if let Some(array) = value.as_array() {
        return Json::Array(array.iter::<rquickjs::Value>().flatten().map(|item| to_json(&item)).collect());
    }
    if let Some(object) = value.as_object() {
        // Structurile chiar se convertesc: un export de forma `["a", "b"]`
        // raportat ca "[object]" nu ar spune nimic despre ce a facut aplicatia.
        let mut fields = BTreeMap::new();
        for entry in object.props::<String, rquickjs::Value>() {
            if let Ok((key, item)) = entry {
                fields.insert(key, to_json(&item));
            }
        }
        return Json::Object(fields);
    }
    Json::string("[necunoscut]")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scrie un modul temporar si intoarce calea lui.
    fn temp_module(name: &str, source: &str) -> String {
        let dir = std::env::temp_dir().join(format!("raptor-qjs-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).expect("director temporar");
        let path = dir.join(format!("{name}.js"));
        std::fs::write(&path, source).expect("scriere modul");
        path.to_string_lossy().to_string()
    }

    fn host_modules() -> HostModules {
        // Un modul de test cu o constanta si o functie nativa: exact forma pe
        // care o primeste izolatul in productie.
        let module = crate::engine::HostModule::new(Json::from_pairs([(
            "module",
            Json::string("raptor:observe"),
        )]))
        .with("dublu", |args: &[Json]| {
            let value = args.first().and_then(Json::as_number).unwrap_or(0.0);
            Ok(Json::Number(value * 2.0))
        });
        BTreeMap::from([("observe".to_string(), module)])
    }

    #[test]
    fn evalueaza_un_modul_si_intoarce_exporturile() {
        let engine = QuickJsEngine::new("iso-eval").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module(
            "exporturi",
            "export const numar = 6 * 7;\nexport const text = `ok`;\nexport const adevarat = true;\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluare");

        assert_eq!(evaluation.exports.get("numar"), Some(&Json::Number(42.0)));
        assert_eq!(evaluation.exports.get("text"), Some(&Json::string("ok")));
        assert_eq!(evaluation.exports.get("adevarat"), Some(&Json::Bool(true)));
        assert!(evaluation.duration_ms >= 0.0);
    }

    #[test]
    fn corpul_modulului_chiar_ruleaza_nu_doar_se_parseaza() {
        // Diferenta conteaza: un motor care doar ar parsa ar trece un test pe
        // constante, dar nu si unul in care valoarea vine dintr-un calcul.
        let engine = QuickJsEngine::new("iso-calcul").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module(
            "calcul",
            "const valori = [1, 2, 3, 4, 5];\nexport const suma = valori.reduce((a, b) => a + b, 0);\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluare");
        assert_eq!(evaluation.exports.get("suma"), Some(&Json::Number(15.0)));
    }

    #[test]
    fn modulele_raptor_sunt_importabile_din_aplicatie() {
        let engine = QuickJsEngine::new("iso-import").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module(
            "import",
            "import observe from \"raptor:observe\";\nexport const nume = observe.module;\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluare");
        assert_eq!(evaluation.exports.get("nume"), Some(&Json::string("raptor:observe")));
    }

    #[test]
    fn un_modul_de_host_nedeclarat_nu_exista() {
        let engine = QuickJsEngine::new("iso-lipsa").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module("lipsa", "import x from \"raptor:teleport\";\nexport const y = x;\n");
        let error = engine.evaluate(&entry).expect_err("import imposibil");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }

    #[test]
    fn exceptia_din_javascript_ajunge_cu_mesajul_ei() {
        // Regresie: motorul raporta "Exception generated by QuickJS", text care
        // nu spune nimic celui care si-a stricat codul.
        let engine = QuickJsEngine::new("iso-eroare").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module("eroare", "throw new TypeError(\"mesaj exact\");\n");
        let error = engine.evaluate(&entry).expect_err("exceptie");

        assert_eq!(error.code, ErrorCode::EngineEvaluation);
        assert!(
            error.message.contains("TypeError") && error.message.contains("mesaj exact"),
            "mesajul trebuie sa poarte exceptia reala: {}",
            error.message
        );
    }

    #[test]
    #[cfg(feature = "typescript")]
    fn typescript_este_eliminat_si_executat() {
        // Pana la legarea stripper-ului, `.ts` primea un refuz. Acum tipurile
        // sunt eliminate cu un parser adevarat, iar modulul chiar ruleaza.
        let engine = QuickJsEngine::new("iso-ts").expect("motor");
        engine.install(host_modules()).expect("instalare");

        let dir = std::env::temp_dir().join(format!("raptor-qjs-ts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("director");
        let path = dir.join("main.ts");
        std::fs::write(
            &path,
            "interface N { v: number }
const n: N = { v: 21 };
export const dublu: number = n.v * 2;
",
        )
        .expect("scriere");

        let evaluation = engine.evaluate(&path.to_string_lossy()).expect("TypeScript rulat");
        assert_eq!(evaluation.exports.get("dublu"), Some(&Json::Number(42.0)));
    }

    #[test]
    #[cfg(not(feature = "typescript"))]
    fn fara_stripper_typescript_este_refuzat_explicit() {
        // Nu exista cale tacuta: un binar fara stripper spune ce ii lipseste.
        let engine = QuickJsEngine::new("iso-ts-fara").expect("motor");
        let dir = std::env::temp_dir().join(format!("raptor-qjs-nots-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("director");
        let path = dir.join("main.ts");
        std::fs::write(&path, "export const x: number = 1;
").expect("scriere");

        let error = engine.evaluate(&path.to_string_lossy()).expect_err("refuz");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
    }

    #[test]
    fn un_modul_inexistent_este_raportat_ca_atare() {
        let engine = QuickJsEngine::new("iso-negasit").expect("motor");
        let error = engine.evaluate("/cale/care/nu/exista.js").expect_err("fisier lipsa");
        assert_eq!(error.code, ErrorCode::ModuleNotFound);
    }

    #[test]
    fn graful_de_module_contine_intrarea_si_modulele_de_host() {
        let engine = QuickJsEngine::new("iso-graf").expect("motor");
        engine.install(host_modules()).expect("instalare");
        let entry = temp_module("graf", "export const x = 1;\n");
        engine.evaluate(&entry).expect("evaluare");

        let graph = engine.module_graph();
        assert!(graph.iter().any(|node| node.kind == "raptor" && node.specifier == "raptor:observe"));
        assert!(graph.iter().any(|node| node.kind == "local" && node.specifier == entry));
    }

    #[test]
    fn motorul_poate_fi_partajat_intre_fire() {
        // `EngineAdapter: Send + Sync` nu este decorativ: host-ul imparte
        // motorul cu task-urile. Izolatul traieste pe firul lui, iar comenzile
        // ajung la el pe canal - deci partajarea chiar este sigura.
        fn require_send_sync<T: Send + Sync>(_: &T) {}
        let engine = std::sync::Arc::new(QuickJsEngine::new("iso-fire").expect("motor"));
        require_send_sync(&*engine);
        engine.install(host_modules()).expect("instalare");

        let entry = temp_module("fire", "export const x = 7;\n");
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let shared = std::sync::Arc::clone(&engine);
                let path = entry.clone();
                std::thread::spawn(move || shared.evaluate(&path).map(|e| e.exports.len()))
            })
            .collect();

        for handle in handles {
            let result = handle.join().expect("fir incheiat");
            assert!(result.is_ok(), "evaluarea din alt fir trebuie sa reuseasca");
        }
    }

    #[test]
    fn dispose_este_idempotent() {
        let engine = QuickJsEngine::new("iso-dispose").expect("motor");
        engine.dispose();
        engine.dispose();
        let error = engine.evaluate("/orice.js").expect_err("dupa inchidere");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }
}
