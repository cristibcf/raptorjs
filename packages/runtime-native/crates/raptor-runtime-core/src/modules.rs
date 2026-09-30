//! The `raptor:` modules, implemented natively (spec section 6).
//!
//! Until now they were names in a list. From here on they are functions that
//! actually do something - and, more importantly, **each one goes through the
//! capability broker before it touches the outside world**. This is where the
//! runtime's security model stops being a declaration and becomes code: a read
//! outside the declared scope fails here, not in the documentation.
//!
//! What is not in this file is as important as what is. `net` and `serve`
//! require async I/O and an event loop in the host; they remain modules that
//! honestly report they are not implemented, instead of pretending they work.

use crate::capabilities::Broker;
use crate::engine::{HostModule, HostModules};
use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use crate::manifest::CapabilityKind;
use crate::observe::{Observer, Severity};
use crate::paths;

use std::collections::BTreeMap;
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};

/// A required string argument, with an error that says which one is missing.
fn arg_str(args: &[Json], index: usize, name: &str) -> Result<String> {
    match args.get(index).and_then(Json::as_str) {
        Some(value) => Ok(value.to_string()),
        None => Err(RaptorError::new(
            ErrorCode::ModuleUnsupported,
            format!("argument '{name}' is missing or is not a string"),
        )
        .with("argument", name)
        .with("pozitie", index.to_string())),
    }
}

fn not_implemented(module: &str, reason: &str) -> RaptorError {
    RaptorError::new(ErrorCode::ModuleUnsupported, format!("raptor:{module} is not yet implemented natively"))
        .with("module", module)
        .with("reason", reason)
}

/// `raptor:observe` - structured logs and metrics.
///
/// Requires no capability: an application's own telemetry is not access to the
/// outside world, and a runtime in which you cannot complain that something is
/// wrong is a runtime you cannot debug.
fn observe_module(observer: Observer) -> HostModule {
    let log_observer = observer.clone();
    let metric_observer = observer;

    HostModule::new(Json::from_pairs([("module", Json::string("raptor:observe"))]))
        .with("log", move |args: &[Json]| {
            let severity = match args.first().and_then(Json::as_str).unwrap_or("info") {
                "debug" => Severity::Debug,
                "warn" => Severity::Warn,
                "error" => Severity::Error,
                _ => Severity::Info,
            };
            let name = arg_str(args, 1, "name")?;
            let attributes = match args.get(2).and_then(Json::as_object) {
                Some(map) => map.clone(),
                None => BTreeMap::new(),
            };
            log_observer.log(severity, &name, attributes);
            Ok(Json::Null)
        })
        .with("metric", move |args: &[Json]| {
            let name = arg_str(args, 0, "name")?;
            let value = args.get(1).and_then(Json::as_number).unwrap_or(0.0);
            metric_observer.metric(&name, value, BTreeMap::new());
            Ok(Json::Null)
        })
}

/// `raptor:files` - files with a declared scope.
///
/// Every operation resolves the path against the project root and passes it
/// through the broker. A path that leaves the scope never reaches the disk:
/// `require` fails before `std::fs`.
fn files_module(broker: Arc<Broker>, project_root: String, observer: Observer) -> HostModule {
    let root_read = project_root.clone();
    let root_write = project_root.clone();
    let root_exists = project_root.clone();
    let root_list = project_root;

    let broker_read = Arc::clone(&broker);
    let broker_write = Arc::clone(&broker);
    let broker_exists = Arc::clone(&broker);
    let broker_list = broker;

    let observer_read = observer.clone();
    let observer_write = observer;

    HostModule::new(Json::from_pairs([("module", Json::string("raptor:files"))]))
        .with("readText", move |args: &[Json]| {
            let requested = arg_str(args, 0, "path")?;
            let absolute = paths::resolve(&root_read, &requested);
            broker_read.require(CapabilityKind::FilesRead, &absolute)?;

            let text = std::fs::read_to_string(&absolute).map_err(|error| {
                RaptorError::new(ErrorCode::ModuleNotFound, "could not read the file")
                    .with("path", absolute.clone())
                    .with("cause", error.to_string())
            })?;
            observer_read.metric("files.read.bytes", text.len() as f64, BTreeMap::new());
            Ok(Json::string(text))
        })
        .with("write", move |args: &[Json]| {
            let requested = arg_str(args, 0, "path")?;
            let contents = arg_str(args, 1, "data")?;
            let absolute = paths::resolve(&root_write, &requested);
            broker_write.require(CapabilityKind::FilesWrite, &absolute)?;

            if let Some(parent) = std::path::Path::new(&absolute).parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    RaptorError::new(ErrorCode::ModuleUnsupported, "could not create the directory")
                        .with("path", absolute.clone())
                        .with("cause", error.to_string())
                })?;
            }
            // Atomic write: temp plus rename, so an interruption does not leave
            // a half-written file behind.
            let temporary = format!("{absolute}.partial");
            std::fs::write(&temporary, contents.as_bytes())
                .and_then(|()| std::fs::rename(&temporary, &absolute))
                .map_err(|error| {
                    let _ = std::fs::remove_file(&temporary);
                    RaptorError::new(ErrorCode::ModuleUnsupported, "could not write the file")
                        .with("path", absolute.clone())
                        .with("cause", error.to_string())
                })?;
            observer_write.metric("files.write.bytes", contents.len() as f64, BTreeMap::new());
            Ok(Json::Null)
        })
        .with("exists", move |args: &[Json]| {
            let requested = arg_str(args, 0, "path")?;
            let absolute = paths::resolve(&root_exists, &requested);
            // Existence is information too: answering without a check would let
            // the application map the disk outside its scope.
            broker_exists.require(CapabilityKind::FilesRead, &absolute)?;
            Ok(Json::Bool(std::path::Path::new(&absolute).exists()))
        })
        .with("list", move |args: &[Json]| {
            let requested = arg_str(args, 0, "path")?;
            let absolute = paths::resolve(&root_list, &requested);
            broker_list.require(CapabilityKind::FilesRead, &absolute)?;

            let entries = std::fs::read_dir(&absolute).map_err(|error| {
                RaptorError::new(ErrorCode::ModuleNotFound, "could not read the directory")
                    .with("path", absolute.clone())
                    .with("cause", error.to_string())
            })?;
            let mut names: Vec<Json> = Vec::new();
            for entry in entries.flatten() {
                names.push(Json::string(entry.file_name().to_string_lossy().to_string()));
            }
            names.sort_by(|a, b| a.as_str().unwrap_or("").cmp(b.as_str().unwrap_or("")));
            Ok(Json::Array(names))
        })
}

/// `raptor:process` - arguments and environment, without ambient access.
fn process_module(broker: Arc<Broker>, args: Vec<String>) -> HostModule {
    let descriptor = Json::from_pairs([
        ("module", Json::string("raptor:process")),
        ("args", Json::Array(args.into_iter().map(Json::string).collect())),
        ("platform", Json::string(std::env::consts::OS)),
    ]);

    let broker_env = Arc::clone(&broker);
    let broker_spawn = broker;

    HostModule::new(descriptor)
        .with("env", move |args: &[Json]| {
            let name = arg_str(args, 0, "name")?;
            broker_env.require(CapabilityKind::EnvRead, &name)?;
            Ok(std::env::var(&name).map(Json::string).unwrap_or(Json::Null))
        })
        .with("spawn", move |args: &[Json]| {
            let command = arg_str(args, 0, "command")?;
            broker_spawn.require(CapabilityKind::ProcessSpawn, &command)?;
            // The capability passes, but the actual execution requires process
            // isolation the host does not have yet; better an explicit refusal
            // than a `Command::new` with no limits around it.
            Err(not_implemented("process", "spawn requires process isolation, not just a capability"))
        })
}

/// `raptor:kv` - in-memory key-value, with the same contract as the persistent variant.
fn kv_module() -> HostModule {
    let store: Arc<Mutex<BTreeMap<String, String>>> = Arc::new(Mutex::new(BTreeMap::new()));
    let get_store = Arc::clone(&store);
    let set_store = Arc::clone(&store);
    let delete_store = Arc::clone(&store);
    let keys_store = store;

    let locked = || RaptorError::new(ErrorCode::ModuleUnsupported, "the kv store is in an invalid state");

    HostModule::new(Json::from_pairs([("module", Json::string("raptor:kv"))]))
        .with("get", move |args: &[Json]| {
            let key = arg_str(args, 0, "key")?;
            let store = get_store.lock().map_err(|_| locked())?;
            Ok(store.get(&key).cloned().map(Json::string).unwrap_or(Json::Null))
        })
        .with("set", move |args: &[Json]| {
            let key = arg_str(args, 0, "key")?;
            let value = arg_str(args, 1, "value")?;
            let mut store = set_store.lock().map_err(|_| locked())?;
            store.insert(key, value);
            Ok(Json::Null)
        })
        .with("delete", move |args: &[Json]| {
            let key = arg_str(args, 0, "key")?;
            let mut store = delete_store.lock().map_err(|_| locked())?;
            Ok(Json::Bool(store.remove(&key).is_some()))
        })
        .with("keys", move |_args: &[Json]| {
            let store = keys_store.lock().map_err(|_| locked())?;
            Ok(Json::Array(store.keys().cloned().map(Json::string).collect()))
        })
}

/// `raptor:capabilities` - the application can ask what it is allowed to do, without trying.
///
/// Without this, the only way to find out whether an access is allowed would
/// be to try it and catch the error - which makes graceful degradation impossible.
fn capabilities_module(broker: Arc<Broker>) -> HostModule {
    let broker_check = Arc::clone(&broker);
    let broker_diagnostics = broker;

    HostModule::new(Json::from_pairs([("module", Json::string("raptor:capabilities"))]))
        .with("check", move |args: &[Json]| {
            let name = arg_str(args, 0, "capability")?;
            let target = args.get(1).and_then(Json::as_str).unwrap_or("");
            let kind = CapabilityKind::parse(&name).ok_or_else(|| {
                RaptorError::new(ErrorCode::ModuleUnsupported, format!("unknown capability: {name}"))
                    .with("capability", name.clone())
            })?;
            let decision = broker_check.check(kind, target);
            Ok(Json::from_pairs([
                ("granted", Json::Bool(decision.granted)),
                ("reason", Json::string(decision.reason.clone())),
            ]))
        })
        .with("diagnostics", move |_args: &[Json]| Ok(broker_diagnostics.diagnostics()))
}

/// `raptor:net` - HTTP requests, with a destination allowlist.
///
/// The model is **synchronous**: `fetch` blocks the isolate until the response.
/// This follows the engine, not a convenience choice - QuickJS does not yet have
/// an event loop wired to the host, and a `fetch` that returned an unresolvable
/// promise would be worse than one that waits.
///
/// TLS is missing: `https://` passes the capability check (the destination
/// is correct) and then fails explicitly. A client that silently downgraded to
/// `http://` would be a security hole, not a convenience.
fn net_module(broker: Arc<Broker>, observer: Observer) -> HostModule {
    let broker_fetch = Arc::clone(&broker);
    let broker_allows = broker;
    let observer_fetch = observer;

    HostModule::new(Json::from_pairs([
        ("module", Json::string("raptor:net")),
        ("tls", Json::Bool(false)),
    ]))
    .with("allows", move |args: &[Json]| {
        let url = arg_str(args, 0, "url")?;
        let (_, host, port, _) = crate::http::split_url(&url)?;
        Ok(Json::Bool(broker_allows.check(CapabilityKind::NetConnect, &format!("{host}:{port}")).granted))
    })
    .with("fetch", move |args: &[Json]| {
        let url = arg_str(args, 0, "url")?;
        let (scheme, host, port, path) = crate::http::split_url(&url)?;

        // The capability is checked against the real destination, before any
        // socket - including for https, which fails only afterwards.
        let destination = format!("{host}:{port}");
        broker_fetch.require(CapabilityKind::NetConnect, &destination)?;

        if scheme == "https" {
            return Err(RaptorError::new(
                ErrorCode::ModuleUnsupported,
                "this HTTP stack has no TLS; https requires a cryptography library, brought in separately",
            )
            .with("url", url)
            .with("destinatie", destination));
        }

        let options = args.get(1).and_then(Json::as_object);
        let method = options
            .and_then(|map| map.get("method"))
            .and_then(Json::as_str)
            .unwrap_or("GET")
            .to_ascii_uppercase();
        let body = options.and_then(|map| map.get("body")).and_then(Json::as_str).unwrap_or("").to_string();
        let timeout_ms = options
            .and_then(|map| map.get("timeoutMs"))
            .and_then(Json::as_number)
            .map_or(30_000_u64, |value| value.max(1.0) as u64);

        let mut headers = BTreeMap::new();
        if let Some(map) = options.and_then(|map| map.get("headers")).and_then(Json::as_object) {
            for (key, value) in map {
                if let Some(text) = value.as_str() {
                    headers.insert(key.to_ascii_lowercase(), text.to_string());
                }
            }
        }

        let timeout = std::time::Duration::from_millis(timeout_ms);
        let address = format!("{host}:{port}");
        let resolved = address
            .to_socket_addrs()
            .map_err(|error| {
                RaptorError::new(ErrorCode::ModuleUnsupported, "could not resolve the host")
                    .with("destinatie", address.clone())
                    .with("cause", error.to_string())
            })?
            .next()
            .ok_or_else(|| {
                RaptorError::new(ErrorCode::ModuleUnsupported, "the host has no address")
                    .with("destinatie", address.clone())
            })?;

        let mut stream = TcpStream::connect_timeout(&resolved, timeout).map_err(|error| {
            RaptorError::new(ErrorCode::ModuleUnsupported, "connection failed")
                .with("destinatie", address.clone())
                .with("cause", error.to_string())
        })?;
        // Without a read timeout, a server that does not respond would block the
        // isolate forever - and there is no other thread to wake it.
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        let request = crate::http::Request { method, target: path, headers, body };
        let response = crate::http::exchange(&mut stream, &address, &request)?;
        observer_fetch.metric("net.fetch.bytes", response.body.len() as f64, BTreeMap::new());
        Ok(response.to_json())
    })
}

/// A request awaiting the application's response.
struct Pending {
    request: crate::http::Request,
    reply: std::sync::mpsc::Sender<crate::http::Response>,
}

/// The state of a started server.
struct Server {
    port: u16,
    queue: std::sync::mpsc::Receiver<(u64, Pending)>,
    waiting: BTreeMap<u64, std::sync::mpsc::Sender<crate::http::Response>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    served: u64,
}

/// `raptor:serve` - HTTP server.
///
/// **The accept loop belongs to the application**, and this is a direct consequence
/// of the synchronous engine: we cannot hold a JavaScript function as a handler
/// and call it from another thread without an event loop. The application asks
/// for the next request and responds to it:
///
/// ```js
/// const s = serve.listen({ port: 0 });
/// const cerere = serve.next({ timeoutMs: 1000 });
/// if (cerere) serve.respond(cerere.id, { status: 200, body: "salut" });
/// ```
///
/// The `serve({ fetch })` form from the TypeScript runtime arrives together with
/// the event loop; the contract there does not change, it is added on top of this one.
fn serve_module(broker: Arc<Broker>, observer: Observer) -> HostModule {
    let state: Arc<Mutex<Option<Server>>> = Arc::new(Mutex::new(None));
    let broker_listen = broker;
    let listen_state = Arc::clone(&state);
    let next_state = Arc::clone(&state);
    let respond_state = Arc::clone(&state);
    let status_state = Arc::clone(&state);
    let close_state = state;
    let observer_listen = observer;

    let locked = || RaptorError::new(ErrorCode::ModuleUnsupported, "the server is in an invalid state");

    HostModule::new(Json::from_pairs([("module", Json::string("raptor:serve"))]))
        .with("listen", move |args: &[Json]| {
            let mut guard = listen_state.lock().map_err(|_| locked())?;
            if guard.is_some() {
                return Err(RaptorError::new(ErrorCode::ModuleUnsupported, "the server is already started"));
            }

            let options = args.first().and_then(Json::as_object);
            let port = options.and_then(|map| map.get("port")).and_then(Json::as_number).unwrap_or(0.0) as u16;
            let host = options
                .and_then(|map| map.get("hostname"))
                .and_then(Json::as_str)
                .unwrap_or("127.0.0.1")
                .to_string();

            // Opening a port is access to the outside, in the opposite direction
            // from `net.connect` - so it goes through the same gate, and BEFORE
            // the `bind`. Without this, an application with an empty manifest
            // could bind a port, including on `0.0.0.0` (audit 2026-09-24, S4).
            broker_listen.require(CapabilityKind::NetListen, &format!("{}:{port}", host.to_ascii_lowercase()))?;

            let listener = TcpListener::bind((host.as_str(), port)).map_err(|error| {
                RaptorError::new(ErrorCode::ModuleUnsupported, "could not open the port")
                    .with("port", port.to_string())
                    .with("cause", error.to_string())
            })?;
            let bound = listener.local_addr().map(|address| address.port()).unwrap_or(port);

            let (sender, queue) = std::sync::mpsc::channel::<(u64, Pending)>();
            let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let accept_shutdown = Arc::clone(&shutdown);

            // The accept thread lives beside the isolate, not inside it: the
            // application stays free to work between two requests.
            std::thread::Builder::new()
                .name(format!("raptor-serve-{bound}"))
                .spawn(move || {
                    let mut id = 0_u64;
                    for incoming in listener.incoming() {
                        if accept_shutdown.load(std::sync::atomic::Ordering::Relaxed) {
                            break;
                        }
                        let Ok(mut stream) = incoming else { continue };
                        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));

                        let request = match crate::http::read_request(&stream) {
                            Ok(request) => request,
                            Err(error) => {
                                let bad = crate::http::Response::new(400, error.message.clone());
                                let _ = crate::http::write_response(&mut stream, &bad);
                                continue;
                            }
                        };

                        id += 1;
                        let (reply, answer) = std::sync::mpsc::channel::<crate::http::Response>();
                        if sender.send((id, Pending { request, reply })).is_err() {
                            break;
                        }

                        // The connection waits for the application's response. If
                        // it does not respond in time, the client gets a 504
                        // instead of hanging until its own timeout.
                        let response = answer
                            .recv_timeout(std::time::Duration::from_secs(30))
                            .unwrap_or_else(|_| crate::http::Response::new(504, "the application did not respond in time"));
                        let _ = crate::http::write_response(&mut stream, &response);
                    }
                })
                .map_err(|error| {
                    RaptorError::new(ErrorCode::ModuleUnsupported, "could not start the server thread")
                        .with("cause", error.to_string())
                })?;

            observer_listen.log(
                Severity::Info,
                "serve.listening",
                BTreeMap::from([("port".to_string(), Json::Number(f64::from(bound)))]),
            );
            *guard = Some(Server { port: bound, queue, waiting: BTreeMap::new(), shutdown, served: 0 });

            Ok(Json::from_pairs([
                ("port", Json::Number(f64::from(bound))),
                ("url", Json::string(format!("http://{host}:{bound}"))),
            ]))
        })
        .with("next", move |args: &[Json]| {
            let timeout_ms = args
                .first()
                .and_then(Json::as_object)
                .and_then(|map| map.get("timeoutMs"))
                .and_then(Json::as_number)
                .map_or(5_000_u64, |value| value.max(0.0) as u64);

            let mut guard = next_state.lock().map_err(|_| locked())?;
            let server = guard
                .as_mut()
                .ok_or_else(|| RaptorError::new(ErrorCode::ModuleUnsupported, "the server is not started"))?;

            match server.queue.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
                Ok((id, pending)) => {
                    server.served += 1;
                    server.waiting.insert(id, pending.reply);
                    let request = pending.request;
                    Ok(Json::from_pairs([
                        ("id", Json::Number(id as f64)),
                        ("method", Json::string(request.method)),
                        ("target", Json::string(request.target)),
                        (
                            "headers",
                            Json::Object(
                                request.headers.into_iter().map(|(k, v)| (k, Json::string(v))).collect(),
                            ),
                        ),
                        ("body", Json::string(request.body)),
                    ]))
                }
                // No request in the requested window is not an error: the
                // application's loop can do something else and come back.
                Err(_) => Ok(Json::Null),
            }
        })
        .with("respond", move |args: &[Json]| {
            let id = args.first().and_then(Json::as_number).ok_or_else(|| {
                RaptorError::new(ErrorCode::ModuleUnsupported, "respond requires the request id")
            })? as u64;

            let mut guard = respond_state.lock().map_err(|_| locked())?;
            let server = guard
                .as_mut()
                .ok_or_else(|| RaptorError::new(ErrorCode::ModuleUnsupported, "the server is not started"))?;
            let reply = server.waiting.remove(&id).ok_or_else(|| {
                RaptorError::new(ErrorCode::ModuleUnsupported, "no pending request with this id")
                    .with("id", id.to_string())
            })?;

            let answer = args.get(1).and_then(Json::as_object);
            let status = answer
                .and_then(|map| map.get("status"))
                .and_then(Json::as_number)
                .map_or(200_u16, |value| value.clamp(100.0, 599.0) as u16);
            let body = answer.and_then(|map| map.get("body")).and_then(Json::as_str).unwrap_or("").to_string();
            let mut headers = BTreeMap::new();
            if let Some(map) = answer.and_then(|map| map.get("headers")).and_then(Json::as_object) {
                for (key, value) in map {
                    if let Some(text) = value.as_str() {
                        headers.insert(key.to_ascii_lowercase(), text.to_string());
                    }
                }
            }

            let delivered = reply.send(crate::http::Response { status, headers, body }).is_ok();
            Ok(Json::from_pairs([("delivered", Json::Bool(delivered))]))
        })
        .with("status", move |_args: &[Json]| {
            let guard = status_state.lock().map_err(|_| locked())?;
            Ok(match guard.as_ref() {
                None => Json::from_pairs([("listening", Json::Bool(false))]),
                Some(server) => Json::from_pairs([
                    ("listening", Json::Bool(true)),
                    ("port", Json::Number(f64::from(server.port))),
                    ("served", Json::Number(server.served as f64)),
                    ("pending", Json::Number(server.waiting.len() as f64)),
                ]),
            })
        })
        .with("close", move |_args: &[Json]| {
            let mut guard = close_state.lock().map_err(|_| locked())?;
            match guard.take() {
                None => Ok(Json::Bool(false)),
                Some(server) => {
                    server.shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
                    // The wake-up connection: `incoming()` blocks, so the accept
                    // thread would not see the flag until the next client.
                    let _ = TcpStream::connect(("127.0.0.1", server.port));
                    Ok(Json::Bool(true))
                }
            }
        })
}

/// A module that exists in the list but has no implementation yet.
fn pending_module(name: &'static str, reason: &'static str) -> HostModule {
    HostModule::new(Json::from_pairs([
        ("module", Json::string(format!("raptor:{name}"))),
        ("implemented", Json::Bool(false)),
    ]))
    .with("__unavailable", move |_args: &[Json]| Err(not_implemented(name, reason)))
}

/// Builds all the `raptor:` modules for a runtime.
pub fn build(
    broker: Arc<Broker>,
    observer: Observer,
    project_root: String,
    args: Vec<String>,
) -> HostModules {
    BTreeMap::from([
        ("files".to_string(), files_module(Arc::clone(&broker), project_root, observer.clone())),
        ("observe".to_string(), observe_module(observer.clone())),
        ("process".to_string(), process_module(Arc::clone(&broker), args)),
        ("kv".to_string(), kv_module()),
        ("capabilities".to_string(), capabilities_module(Arc::clone(&broker))),
        ("tasks".to_string(), pending_module("tasks", "the native task fabric is not yet wired to the isolate")),
        ("net".to_string(), net_module(Arc::clone(&broker), observer.clone())),
        ("serve".to_string(), serve_module(broker, observer)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::PolicyMode;

    fn temp_root(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("raptor-mod-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(dir.join("src")).expect("directory");
        std::fs::write(dir.join("src").join("main.js"), "export const x = 1;\n").expect("source");
        std::fs::write(dir.join("secret.txt"), "you are not allowed here\n").expect("secret");
        paths::normalize(&dir.to_string_lossy())
    }

    /// Broker with `files.read` limited to `./src`, as in a project manifest.
    fn harness(name: &str) -> (HostModules, String, Arc<Broker>) {
        let root = temp_root(name);
        let manifest_source = concat!(
            "{\"name\":\"t\",\"version\":\"1.0.0\",\"entry\":\"./src/main.js\",\"policy\":\"development\",",
            "\"capabilities\":{\"files.read\":[\"./src\"],\"files.write\":[\"./out\"],\"env.read\":[\"RAPTOR_*\"]}}"
        );
        let manifest = crate::manifest::parse(manifest_source).manifest.expect("valid manifest");
        assert_eq!(manifest.policy, PolicyMode::Development);

        let observer = Observer::new();
        let broker = Arc::new(Broker::new(
            &root,
            manifest.capabilities.clone(),
            manifest.policy,
            Some(true),
            observer.child("cap"),
        ));
        let modules = build(Arc::clone(&broker), observer, root.clone(), vec!["--flag".to_string()]);
        (modules, root, broker)
    }

    fn call(modules: &HostModules, module: &str, function: &str, args: &[Json]) -> Result<Json> {
        let host_module = modules.get(module).expect("the module exists");
        let callable = host_module.functions.get(function).expect("the function exists");
        callable(args)
    }

    #[test]
    fn toate_modulele_din_spec_sunt_publicate() {
        let (modules, _root, _broker) = harness("lista");
        let mut names: Vec<&str> = modules.keys().map(String::as_str).collect();
        names.sort_unstable();
        assert_eq!(names, ["capabilities", "files", "kv", "net", "observe", "process", "serve", "tasks"]);
    }

    #[test]
    fn citirea_in_domeniul_declarat_reuseste() {
        let (modules, _root, _broker) = harness("citire");
        let text = call(&modules, "files", "readText", &[Json::string("./src/main.js")]).expect("read allowed");
        assert_eq!(text.as_str(), Some("export const x = 1;\n"));
    }

    #[test]
    fn citirea_in_afara_domeniului_este_refuzata_inainte_de_disc() {
        // The file really exists - so if the refusal did not work, the read
        // would succeed. This is the test that makes capabilities mean something.
        let (modules, root, _broker) = harness("refuz");
        assert!(std::path::Path::new(&format!("{root}/secret.txt")).exists());

        let error = call(&modules, "files", "readText", &[Json::string("./secret.txt")]).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
    }

    #[test]
    fn traversarea_nu_scoate_aplicatia_din_domeniu() {
        let (modules, _root, _broker) = harness("traversare");
        let error = call(&modules, "files", "readText", &[Json::string("./src/../secret.txt")]).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
    }

    #[test]
    fn existenta_este_si_ea_informatie_deci_trece_prin_broker() {
        let (modules, _root, _broker) = harness("exista");
        assert_eq!(call(&modules, "files", "exists", &[Json::string("./src")]).expect("allowed"), Json::Bool(true));
        let error = call(&modules, "files", "exists", &[Json::string("./secret.txt")]).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
    }

    #[test]
    fn scrierea_respecta_domeniul_ei_separat() {
        let (modules, root, _broker) = harness("scriere");
        // `files.write` is declared for `./out`, not for `./src`.
        call(&modules, "files", "write", &[Json::string("./out/nota.txt"), Json::string("salut")])
            .expect("write allowed");
        assert_eq!(std::fs::read_to_string(format!("{root}/out/nota.txt")).expect("read"), "salut");

        let error =
            call(&modules, "files", "write", &[Json::string("./src/main.js"), Json::string("x")]).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
        assert_eq!(
            std::fs::read_to_string(format!("{root}/src/main.js")).expect("read"),
            "export const x = 1;\n",
            "the refused file was not touched"
        );
    }

    #[test]
    fn listarea_intoarce_nume_sortate() {
        let (modules, _root, _broker) = harness("listare");
        let names = call(&modules, "files", "list", &[Json::string("./src")]).expect("listing");
        assert_eq!(names, Json::Array(vec![Json::string("main.js")]));
    }

    #[test]
    fn argumentul_lipsa_este_raportat_cu_numele_lui() {
        let (modules, _root, _broker) = harness("argument");
        let error = call(&modules, "files", "readText", &[]).expect_err("missing argument");
        assert_eq!(error.detail.get("argument").map(String::as_str), Some("path"));
    }

    #[test]
    fn observe_nu_cere_capabilitate() {
        // An application's own telemetry is not access to the outside world, and
        // a runtime in which you cannot complain is one you cannot debug.
        let (modules, _root, _broker) = harness("observe");
        call(&modules, "observe", "log", &[Json::string("info"), Json::string("app.gata"), Json::object()])
            .expect("log");
        call(&modules, "observe", "metric", &[Json::string("durata"), Json::Number(12.5)]).expect("metric");
    }

    #[test]
    fn process_expune_argumentele_si_filtreaza_mediul() {
        let (modules, _root, _broker) = harness("process");
        let descriptor = &modules.get("process").expect("module").descriptor;
        assert_eq!(descriptor.get("args"), Some(&Json::Array(vec![Json::string("--flag")])));

        let error = call(&modules, "process", "env", &[Json::string("SECRET_TOKEN")]).expect_err("refusal");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
    }

    #[test]
    fn kv_pastreaza_valorile_intre_apeluri() {
        let (modules, _root, _broker) = harness("kv");
        call(&modules, "kv", "set", &[Json::string("a"), Json::string("1")]).expect("set");
        assert_eq!(call(&modules, "kv", "get", &[Json::string("a")]).expect("get"), Json::string("1"));
        assert_eq!(call(&modules, "kv", "keys", &[]).expect("keys"), Json::Array(vec![Json::string("a")]));
        assert_eq!(call(&modules, "kv", "delete", &[Json::string("a")]).expect("delete"), Json::Bool(true));
        assert_eq!(call(&modules, "kv", "get", &[Json::string("a")]).expect("get"), Json::Null);
    }

    #[test]
    fn aplicatia_poate_intreba_ce_are_voie_fara_sa_incerce() {
        let (modules, _root, _broker) = harness("capabilitati");
        let permis =
            call(&modules, "capabilities", "check", &[Json::string("files.read"), Json::string("./src/main.js")])
                .expect("check");
        assert_eq!(permis.get("granted"), Some(&Json::Bool(true)));

        let refuzat =
            call(&modules, "capabilities", "check", &[Json::string("files.read"), Json::string("./secret.txt")])
                .expect("check");
        assert_eq!(refuzat.get("granted"), Some(&Json::Bool(false)));

        let necunoscuta =
            call(&modules, "capabilities", "check", &[Json::string("files.teleport")]).expect_err("unknown");
        assert_eq!(necunoscuta.code, ErrorCode::ModuleUnsupported);
    }

    #[test]
    fn modulele_neimplementate_spun_asta_in_loc_sa_se_prefaca() {
        let (modules, _root, _broker) = harness("nefacute");
        // `net` and `serve` were here until they were implemented; `tasks`
        // remained the only module that still honestly refuses, instead of
        // seeming to work.
        let name = "tasks";
        let module = modules.get(name).expect("the module exists");
        assert_eq!(module.descriptor.get("implemented"), Some(&Json::Bool(false)));
        let error = call(&modules, name, "__unavailable", &[]).expect_err("not implemented");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
        assert!(error.detail.contains_key("reason"), "the refusal says why");
    }

    #[test]
    fn refuzul_distinge_nedeclarat_de_in_afara_domeniului() {
        let (modules, _root, _broker) = harness("spawn");

        // `process.spawn` does not appear in the manifest at all: undeclared.
        let nedeclarata = call(&modules, "process", "spawn", &[Json::string("git")]).expect_err("refusal");
        assert_eq!(nedeclarata.code, ErrorCode::CapabilityUndeclared);

        // `env.read` is declared, but only for `RAPTOR_*`: outside the scope.
        let in_afara = call(&modules, "process", "env", &[Json::string("SECRET_TOKEN")]).expect_err("refusal");
        assert_eq!(in_afara.code, ErrorCode::CapabilityDenied);

        // The distinction matters for diagnostics: the first needs a new line in
        // the manifest, the second a widening of the existing scope.
    }

    /// Harness with the network declared for localhost on any port, in both
    /// directions: `net.connect` for outbound, `net.listen` for listening.
    fn net_harness(name: &str) -> HostModules {
        let root = temp_root(name);
        let manifest_source = concat!(
            "{\"name\":\"t\",\"version\":\"1.0.0\",\"entry\":\"./src/main.js\",\"policy\":\"development\",",
            "\"capabilities\":{\"net.connect\":[\"127.0.0.1:*\"],\"net.listen\":[\"127.0.0.1:*\"]}}"
        );
        let manifest = crate::manifest::parse(manifest_source).manifest.expect("valid manifest");
        let observer = Observer::new();
        let broker = Arc::new(Broker::new(
            &root,
            manifest.capabilities.clone(),
            manifest.policy,
            Some(true),
            observer.child("cap"),
        ));
        build(broker, observer, root, Vec::new())
    }

    #[test]
    fn fara_net_listen_serverul_nu_poate_deschide_un_port() {
        // Regression for the 2026-09-24 audit (S4): `serve.listen` bound ports
        // without asking for anything, even though the host bridge already
        // required `net.listen` for exactly the same method. The general harness
        // does NOT declare a network, so it is exactly the manifest of an app
        // that did not ask.
        let (modules, _root, _broker) = harness("listen-refuzat");
        let error = call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])])
            .expect_err("opening a port is a capability");
        assert_eq!(error.code, ErrorCode::CapabilityUndeclared);
        assert_eq!(error.detail.get("capability").map(String::as_str), Some("net.listen"));
    }

    #[test]
    fn o_regula_pe_loopback_nu_acopera_toate_interfetele() {
        // `0.0.0.0` exposes the server to the network. A rule written for
        // `127.0.0.1` cannot possibly mean that too.
        let modules = net_harness("listen-0000");
        let error = call(
            &modules,
            "serve",
            "listen",
            &[Json::from_pairs([("port", Json::Number(0.0)), ("hostname", Json::string("0.0.0.0"))])],
        )
        .expect_err("exposure on all interfaces must be requested explicitly");
        assert_eq!(error.detail.get("capability").map(String::as_str), Some("net.listen"));
    }

    #[test]
    fn serverul_deschide_un_port_si_raporteaza_starea() {
        let modules = net_harness("listen");
        let info = call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])])
            .expect("start");
        let port = info.get("port").and_then(Json::as_number).expect("port") as u16;
        assert!(port > 0, "port 0 means 'pick a free one'");

        let status = call(&modules, "serve", "status", &[]).expect("status");
        assert_eq!(status.get("listening"), Some(&Json::Bool(true)));

        assert_eq!(call(&modules, "serve", "close", &[]).expect("stop"), Json::Bool(true));
        assert_eq!(
            call(&modules, "serve", "status", &[]).expect("status").get("listening"),
            Some(&Json::Bool(false))
        );
    }

    #[test]
    fn acelasi_server_nu_poate_fi_pornit_de_doua_ori() {
        let modules = net_harness("dublu");
        call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])]).expect("start");
        let error = call(&modules, "serve", "listen", &[]).expect_err("already started");
        assert!(error.message.contains("already started"), "{}", error.message);
        call(&modules, "serve", "close", &[]).expect("stop");
    }

    #[test]
    fn o_cerere_reala_ajunge_la_aplicatie_si_raspunsul_inapoi_la_client() {
        let modules = net_harness("cerere");
        let info = call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])])
            .expect("start");
        let port = info.get("port").and_then(Json::as_number).expect("port") as u16;

        // The client runs on another thread: `next` blocks until the request arrives.
        let client = std::thread::spawn(move || {
            let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connection");
            use std::io::{Read, Write};
            stream
                .write_all(b"POST /note HTTP/1.1\r\nhost: x\r\ncontent-length: 5\r\n\r\nsalut")
                .expect("request sent");
            let mut raspuns = String::new();
            stream.read_to_string(&mut raspuns).expect("response read");
            raspuns
        });

        let cerere = call(&modules, "serve", "next", &[Json::from_pairs([("timeoutMs", Json::Number(5000.0))])])
            .expect("request received");
        assert_eq!(cerere.get("method").and_then(Json::as_str), Some("POST"));
        assert_eq!(cerere.get("target").and_then(Json::as_str), Some("/note"));
        assert_eq!(cerere.get("body").and_then(Json::as_str), Some("salut"));

        let id = cerere.get("id").cloned().expect("id");
        let answer = Json::from_pairs([
            ("status", Json::Number(201.0)),
            ("body", Json::string("creat")),
            ("headers", Json::from_pairs([("content-type", Json::string("text/plain"))])),
        ]);
        let delivered = call(&modules, "serve", "respond", &[id, answer]).expect("response");
        assert_eq!(delivered.get("delivered"), Some(&Json::Bool(true)));

        let raw = client.join().expect("the client finished");
        assert!(raw.starts_with("HTTP/1.1 201 Created"), "{raw}");
        assert!(raw.contains("content-type: text/plain"), "{raw}");
        assert!(raw.contains("content-length: 5"), "the stack sets the length itself: {raw}");
        assert!(raw.ends_with("creat"), "{raw}");

        call(&modules, "serve", "close", &[]).expect("stop");
    }

    #[test]
    fn next_fara_cereri_intoarce_null_nu_o_eroare() {
        let modules = net_harness("gol");
        call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])]).expect("start");
        // A window with no traffic is not a failure: the application's loop can
        // do something else and come back.
        let nimic = call(&modules, "serve", "next", &[Json::from_pairs([("timeoutMs", Json::Number(50.0))])])
            .expect("no requests");
        assert_eq!(nimic, Json::Null);
        call(&modules, "serve", "close", &[]).expect("stop");
    }

    #[test]
    fn un_raspuns_pentru_un_id_necunoscut_este_refuzat() {
        let modules = net_harness("idgresit");
        call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])]).expect("start");
        let error = call(&modules, "serve", "respond", &[Json::Number(999.0), Json::object()])
            .expect_err("nonexistent id");
        assert!(error.message.contains("no pending request"), "{}", error.message);
        call(&modules, "serve", "close", &[]).expect("stop");
    }

    #[test]
    fn operatiile_pe_un_server_nepornit_sunt_refuzate() {
        let modules = net_harness("nepornit");
        for function in ["next", "respond"] {
            let error = call(&modules, "serve", function, &[Json::Number(1.0), Json::object()])
                .expect_err("server not started");
            assert!(error.message.contains("not started"), "{function}: {}", error.message);
        }
        assert_eq!(call(&modules, "serve", "close", &[]).expect("close"), Json::Bool(false));
    }

    #[test]
    fn fetch_vorbeste_cu_un_server_real() {
        // The server and the client are both ours: this is how we test the whole
        // path, from `fetch` to `respond`, with nothing external.
        let modules = net_harness("fetch");
        let info = call(&modules, "serve", "listen", &[Json::from_pairs([("port", Json::Number(0.0))])])
            .expect("start");
        let port = info.get("port").and_then(Json::as_number).expect("port") as u16;

        let server_modules = net_harness("fetch-nu-se-foloseste");
        drop(server_modules);

        let fetch_modules = Arc::new(net_harness("fetch-client"));
        let client_modules = Arc::clone(&fetch_modules);
        let client = std::thread::spawn(move || {
            call(
                &client_modules,
                "net",
                "fetch",
                &[Json::string(format!("http://127.0.0.1:{port}/salut"))],
            )
        });

        let cerere = call(&modules, "serve", "next", &[Json::from_pairs([("timeoutMs", Json::Number(5000.0))])])
            .expect("request");
        assert_eq!(cerere.get("target").and_then(Json::as_str), Some("/salut"));
        let id = cerere.get("id").cloned().expect("id");
        call(
            &modules,
            "serve",
            "respond",
            &[id, Json::from_pairs([("status", Json::Number(200.0)), ("body", Json::string("pong"))])],
        )
        .expect("response");

        let response = client.join().expect("the client finished").expect("fetch succeeded");
        assert_eq!(response.get("status"), Some(&Json::Number(200.0)));
        assert_eq!(response.get("body").and_then(Json::as_str), Some("pong"));

        call(&modules, "serve", "close", &[]).expect("stop");
    }

    #[test]
    fn fetch_catre_o_destinatie_nedeclarata_este_refuzat_inainte_de_socket() {
        let modules = net_harness("refuz-net");
        let error = call(&modules, "net", "fetch", &[Json::string("http://exemplu.com/x")])
            .expect_err("undeclared destination");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
        assert_eq!(error.detail.get("target").map(String::as_str), Some("exemplu.com:80"));
    }

    #[test]
    fn allows_raspunde_fara_sa_deschida_conexiunea() {
        let modules = net_harness("allows");
        assert_eq!(
            call(&modules, "net", "allows", &[Json::string("http://127.0.0.1:8080/x")]).expect("check"),
            Json::Bool(true)
        );
        assert_eq!(
            call(&modules, "net", "allows", &[Json::string("http://exemplu.com/x")]).expect("check"),
            Json::Bool(false)
        );
    }

    #[test]
    fn https_trece_de_capabilitate_dar_esueaza_explicit_fara_tls() {
        // Important: it does not silently downgrade to http. A client that did so
        // would be a security hole, not a convenience.
        let modules = net_harness("https");
        let error = call(&modules, "net", "fetch", &[Json::string("https://127.0.0.1:8443/x")])
            .expect_err("no TLS");
        assert_eq!(error.code, ErrorCode::ModuleUnsupported);
        assert!(error.message.contains("TLS"), "{}", error.message);
    }

    #[test]
    fn un_url_fara_schema_este_refuzat_de_net() {
        let modules = net_harness("urlrau");
        assert!(call(&modules, "net", "fetch", &[Json::string("/doar-cale")]).is_err());
        assert!(call(&modules, "net", "allows", &[Json::string("ftp://x/y")]).is_err());
    }
}
