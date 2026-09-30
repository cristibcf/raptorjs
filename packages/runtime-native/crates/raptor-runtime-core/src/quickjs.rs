//! The QuickJS engine, behind [`EngineAdapter`](crate::engine::EngineAdapter).
//!
//! This is the piece that turns the binary from a manifest validator
//! into a runtime: from here on, `raptor-runtime run` actually executes modules,
//! without Node installed on the machine.
//!
//! **Why QuickJS before V8.** Spec section 13 calls for V8 "through a
//! narrow adapter", and that remains the goal. But the adapter exists precisely
//! so the engine can be swapped without touching anything in the applications, and QuickJS
//! compiles from C source in tens of seconds, not hours. The chosen order
//! proves independence from Node *now* and lets V8 come in later through
//! the same door.
//!
//! **Thread isolation.** `rquickjs::Runtime` cannot be shared across threads,
//! but [`EngineAdapter`] requires `Send + Sync` because the host shares it with
//! the tasks. The solution is not an `unsafe impl`: the engine lives on **its own thread**
//! and receives commands over a channel. This is also closer to the truth - an
//! isolate really does belong to a single thread - and it keeps a JavaScript panic
//! at home.

use crate::engine::{EngineAdapter, Evaluation, GraphNode, HostModules};
use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;

use std::collections::BTreeMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// The commands the engine thread can receive.
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
            // QuickJS uses the machine stack for recursion in JavaScript;
            // a thread's default stack is too small for real modules.
            .stack_size(8 * 1024 * 1024)
            .spawn(move || engine_loop(receiver, ready_tx))
            .map_err(|error| {
                RaptorError::new(ErrorCode::EngineEvaluation, "could not start the isolate thread")
                    .with("cause", error.to_string())
            })?;

        let version = ready_rx
            .recv()
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "the isolate thread did not respond at startup"))??;

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
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "the isolate is in an invalid state"))?;
        let sender = guard
            .as_ref()
            .ok_or_else(|| RaptorError::new(ErrorCode::EngineEvaluation, "the isolate has been closed"))?;
        sender
            .send(make(tx))
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "the isolate thread has stopped"))?;
        rx.recv()
            .map_err(|_| RaptorError::new(ErrorCode::EngineEvaluation, "the isolate did not respond"))
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

/// The isolate thread: creates the QuickJS runtime and holds it until `Dispose`.
fn engine_loop(receiver: std::sync::mpsc::Receiver<Command>, ready: Sender<Result<String>>) {
    let runtime = match rquickjs::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = ready.send(Err(RaptorError::new(
                ErrorCode::EngineEvaluation,
                format!("could not create the QuickJS runtime: {error}"),
            )));
            return;
        }
    };
    let context = match rquickjs::Context::full(&runtime) {
        Ok(context) => context,
        Err(error) => {
            let _ = ready.send(Err(RaptorError::new(
                ErrorCode::EngineEvaluation,
                format!("could not create the QuickJS context: {error}"),
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

/// The binding version, fixed at compile time.
///
/// `env!("CARGO_PKG_VERSION")` would give the *core's* version, not the engine's - a
/// number that looks credible and is wrong. Better one written explicitly,
/// next to the dependency in `Cargo.toml`.
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
        RaptorError::new(ErrorCode::ModuleNotFound, "could not read the entry module")
            .with("entry", entry_path)
            .with("cause", error.to_string())
    })?;

    // TypeScript goes through a real parser before it reaches the engine.
    // QuickJS executes JavaScript; types are stripped, not ignored.
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
        // The `raptor:` modules are published before evaluation, so imports in
        // the entry module find them already declared.
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

/// The name of the global registry where the isolate's host objects live.
///
/// The same convention as in the TypeScript launcher: a global symbol, not a
/// visible variable, so it is not touched by accident by the application code.
const HOST_REGISTRY: &str = "raptor.runtime.hostModules";

/// Builds, for each module, a JavaScript object with the native functions
/// bound, and puts it in the isolate's global registry.
///
/// The functions are not data copies: every call from JavaScript comes back into
/// Rust, goes through the capability broker, and only then touches the disk or environment.
fn install_host_objects<'js>(ctx: &rquickjs::Ctx<'js>, host_modules: &HostModules) -> Result<()> {
    let registry = rquickjs::Object::new(ctx.clone()).map_err(|error| engine_error(ctx, error, HOST_REGISTRY))?;

    for (name, module) in host_modules {
        let object = rquickjs::Object::new(ctx.clone()).map_err(|error| engine_error(ctx, error, name))?;

        // The constants are copied once; they do not change at runtime.
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
                            // The Raptor error becomes a JavaScript exception that
                            // carries the same code: the application can catch it and
                            // tell "not allowed" from "could not".
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

/// The synthetic source of a `raptor:` module.
///
/// The module reads the object from the registry and re-exports it: as `default`
/// by default and each function as a named export, so `import { readText } from
/// "raptor:files"` works the same as `import files from "raptor:files"`.
fn synthesize_host_module(name: &str, module: &crate::engine::HostModule) -> String {
    let mut source = format!(
        "const __mod = globalThis[{registry}][{name}];\nexport default __mod;\n",
        registry = crate::json::to_string(&Json::string(HOST_REGISTRY)),
        name = crate::json::to_string(&Json::string(name)),
    );
    for function_name in module.functions.keys() {
        if !is_valid_export_name(function_name) {
            // Names that cannot be bound (reserved words like `delete`, or
            // invalid identifiers) stay accessible through the default export:
            // `kv.delete(...)` works, `import { delete }` cannot.
            continue;
        }
        // The binding preserves `this`, so destructuring in the user's code
        // does not lose the module context.
        source.push_str(&format!("export const {function_name} = __mod.{function_name}.bind(__mod);\n"));
    }
    source
}

/// The language's reserved words cannot be named-export names.
///
/// The list is short because it covers only what can appear as a host method
/// name - `delete` from `raptor:kv` was the case that uncovered it.
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

/// Conversion from `Json` to a JavaScript value.
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
/// Translates an engine error into a Raptor error.
///
/// The part that matters is the message. `rquickjs` reports only "Exception
/// generated by QuickJS" and leaves the exception pending on the context; if we
/// stopped there, someone who broke their code would get text that says
/// absolutely nothing. So we pull out the real exception and put it in the message, with the stack in
/// the detail.
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
            // A thrown value that is not an `Error` (`throw "text"`).
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

/// Conversion from a JavaScript value to `Json`, for the reported exports.
fn to_json(value: &rquickjs::Value<'_>) -> Json {
    if value.is_bool() {
        return Json::Bool(value.as_bool().unwrap_or(false));
    }
    if value.is_number() {
        // QuickJS keeps integers as `int32`, not `f64`: `as_float()` returns
        // `None` for `42`, and an `unwrap_or(0.0)` would silently report zero.
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
        // Functions have no JSON representation; we report them as a type, so `run`
        // can say there is a callable `export default`.
        return Json::string("[function]");
    }
    if value.is_null() || value.is_undefined() {
        return Json::Null;
    }
    if let Some(array) = value.as_array() {
        return Json::Array(array.iter::<rquickjs::Value>().flatten().map(|item| to_json(&item)).collect());
    }
    if let Some(object) = value.as_object() {
        // Structures really are converted: an export of the form `["a", "b"]`
        // reported as "[object]" would say nothing about what the application did.
        let mut fields = BTreeMap::new();
        for (key, item) in object.props::<String, rquickjs::Value>().flatten() {
            fields.insert(key, to_json(&item));
        }
        return Json::Object(fields);
    }
    Json::string("[unknown]")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a temporary module and returns its path.
    fn temp_module(name: &str, source: &str) -> String {
        let dir = std::env::temp_dir().join(format!("raptor-qjs-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).expect("temporary directory");
        let path = dir.join(format!("{name}.js"));
        std::fs::write(&path, source).expect("module written");
        path.to_string_lossy().to_string()
    }

    fn host_modules() -> HostModules {
        // A test module with a constant and a native function: exactly the form
        // the isolate receives in production.
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
        let engine = QuickJsEngine::new("iso-eval").expect("engine");
        engine.install(host_modules()).expect("install");

        let entry = temp_module(
            "exporturi",
            "export const numar = 6 * 7;\nexport const text = `ok`;\nexport const adevarat = true;\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluation");

        assert_eq!(evaluation.exports.get("numar"), Some(&Json::Number(42.0)));
        assert_eq!(evaluation.exports.get("text"), Some(&Json::string("ok")));
        assert_eq!(evaluation.exports.get("adevarat"), Some(&Json::Bool(true)));
        assert!(evaluation.duration_ms >= 0.0);
    }

    #[test]
    fn corpul_modulului_chiar_ruleaza_nu_doar_se_parseaza() {
        // The difference matters: an engine that only parsed would pass a test on
        // constants, but not one where the value comes from a computation.
        let engine = QuickJsEngine::new("iso-calcul").expect("engine");
        engine.install(host_modules()).expect("install");

        let entry = temp_module(
            "calcul",
            "const valori = [1, 2, 3, 4, 5];\nexport const suma = valori.reduce((a, b) => a + b, 0);\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluation");
        assert_eq!(evaluation.exports.get("suma"), Some(&Json::Number(15.0)));
    }

    #[test]
    fn modulele_raptor_sunt_importabile_din_aplicatie() {
        let engine = QuickJsEngine::new("iso-import").expect("engine");
        engine.install(host_modules()).expect("install");

        let entry = temp_module(
            "import",
            "import observe from \"raptor:observe\";\nexport const nume = observe.module;\n",
        );
        let evaluation = engine.evaluate(&entry).expect("evaluation");
        assert_eq!(evaluation.exports.get("nume"), Some(&Json::string("raptor:observe")));
    }

    #[test]
    fn un_modul_de_host_nedeclarat_nu_exista() {
        let engine = QuickJsEngine::new("iso-lipsa").expect("engine");
        engine.install(host_modules()).expect("install");

        let entry = temp_module("lipsa", "import x from \"raptor:teleport\";\nexport const y = x;\n");
        let error = engine.evaluate(&entry).expect_err("impossible import");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }

    #[test]
    fn exceptia_din_javascript_ajunge_cu_mesajul_ei() {
        // Regression: the engine reported "Exception generated by QuickJS", text
        // that says nothing to whoever broke their code.
        let engine = QuickJsEngine::new("iso-eroare").expect("engine");
        engine.install(host_modules()).expect("install");

        let entry = temp_module("eroare", "throw new TypeError(\"exact message\");\n");
        let error = engine.evaluate(&entry).expect_err("exception");

        assert_eq!(error.code, ErrorCode::EngineEvaluation);
        assert!(
            error.message.contains("TypeError") && error.message.contains("exact message"),
            "the message must carry the real exception: {}",
            error.message
        );
    }

    #[test]
    #[cfg(feature = "typescript")]
    fn typescript_este_eliminat_si_executat() {
        // Until the stripper was wired in, `.ts` got a refusal. Now the types
        // are stripped with a real parser, and the module actually runs.
        let engine = QuickJsEngine::new("iso-ts").expect("engine");
        engine.install(host_modules()).expect("install");

        let dir = std::env::temp_dir().join(format!("raptor-qjs-ts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("directory");
        let path = dir.join("main.ts");
        std::fs::write(
            &path,
            "interface N { v: number }
const n: N = { v: 21 };
export const dublu: number = n.v * 2;
",
        )
        .expect("written");

        let evaluation = engine.evaluate(&path.to_string_lossy()).expect("TypeScript ran");
        assert_eq!(evaluation.exports.get("dublu"), Some(&Json::Number(42.0)));
    }

    #[test]
    #[cfg(not(feature = "typescript"))]
    fn fara_stripper_typescript_este_refuzat_explicit() {
        // There is no silent path: a binary without a stripper says what it lacks.
        let engine = QuickJsEngine::new("iso-ts-fara").expect("engine");
        let dir = std::env::temp_dir().join(format!("raptor-qjs-nots-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("directory");
        let path = dir.join("main.ts");
        std::fs::write(&path, "export const x: number = 1;
").expect("written");

        let error = engine.evaluate(&path.to_string_lossy()).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
    }

    #[test]
    fn un_modul_inexistent_este_raportat_ca_atare() {
        let engine = QuickJsEngine::new("iso-negasit").expect("engine");
        let error = engine.evaluate("/cale/care/nu/exista.js").expect_err("missing file");
        assert_eq!(error.code, ErrorCode::ModuleNotFound);
    }

    #[test]
    fn graful_de_module_contine_intrarea_si_modulele_de_host() {
        let engine = QuickJsEngine::new("iso-graf").expect("engine");
        engine.install(host_modules()).expect("install");
        let entry = temp_module("graf", "export const x = 1;\n");
        engine.evaluate(&entry).expect("evaluation");

        let graph = engine.module_graph();
        assert!(graph.iter().any(|node| node.kind == "raptor" && node.specifier == "raptor:observe"));
        assert!(graph.iter().any(|node| node.kind == "local" && node.specifier == entry));
    }

    #[test]
    fn motorul_poate_fi_partajat_intre_fire() {
        // `EngineAdapter: Send + Sync` is not decorative: the host shares
        // the engine with the tasks. The isolate lives on its own thread, and the commands
        // reach it over a channel - so the sharing really is safe.
        fn require_send_sync<T: Send + Sync>(_: &T) {}
        let engine = std::sync::Arc::new(QuickJsEngine::new("iso-fire").expect("engine"));
        require_send_sync(&*engine);
        engine.install(host_modules()).expect("install");

        let entry = temp_module("fire", "export const x = 7;\n");
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let shared = std::sync::Arc::clone(&engine);
                let path = entry.clone();
                std::thread::spawn(move || shared.evaluate(&path).map(|e| e.exports.len()))
            })
            .collect();

        for handle in handles {
            let result = handle.join().expect("thread finished");
            assert!(result.is_ok(), "evaluation from another thread must succeed");
        }
    }

    #[test]
    fn dispose_este_idempotent() {
        let engine = QuickJsEngine::new("iso-dispose").expect("engine");
        engine.dispose();
        engine.dispose();
        let error = engine.evaluate("/orice.js").expect_err("after closing");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }
}
