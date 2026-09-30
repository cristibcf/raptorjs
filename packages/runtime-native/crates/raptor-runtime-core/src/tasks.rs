//! Task fabric (spec section 5): deterministic asynchronous scheduling, with
//! cancellation, deadlines, and resource quotas - without mutable global state.
//!
//! The clean shutdown required by the spike (section 14) is achieved through `shutdown`: it
//! no longer accepts new work, cancels what is in flight, and waits for the drain.
//!
//! Cancellation is **cooperative and observable**: the token uses a condvar,
//! so a task that is waiting wakes up as soon as it is cancelled, instead of
//! sleeping to the end. A task that never checks the token cannot be
//! interrupted - this is true for any runtime and we say it plainly, instead
//! of pretending that `shutdown` kills threads.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use crate::observe::{Observer, Severity};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Requested,
    Deadline,
    Shutdown,
}

impl CancelReason {
    fn code(self) -> ErrorCode {
        match self {
            CancelReason::Deadline => ErrorCode::TaskDeadline,
            _ => ErrorCode::TaskCancelled,
        }
    }

    fn describe(self) -> &'static str {
        match self {
            CancelReason::Requested => "was cancelled",
            CancelReason::Deadline => "exceeded the deadline",
            CancelReason::Shutdown => "was cancelled: the runtime is shutting down",
        }
    }
}

#[derive(Default)]
struct TokenInner {
    cancelled: Mutex<Option<CancelReason>>,
    changed: Condvar,
}

/// A shareable cancellation token. Cloning does not copy the state - all clones
/// talk about the same cancellation.
#[derive(Clone, Default)]
pub struct CancellationToken {
    inner: Arc<TokenInner>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self, reason: CancelReason) {
        if let Ok(mut state) = self.inner.cancelled.lock() {
            if state.is_none() {
                *state = Some(reason);
                self.inner.changed.notify_all();
            }
        }
    }

    pub fn reason(&self) -> Option<CancelReason> {
        self.inner.cancelled.lock().ok().and_then(|state| *state)
    }

    pub fn is_cancelled(&self) -> bool {
        self.reason().is_some()
    }

    /// Waits until `timeout` or until cancellation. Returns `true` if the
    /// wait ended because the token was cancelled.
    pub fn wait_timeout(&self, timeout: Duration) -> bool {
        let Ok(state) = self.inner.cancelled.lock() else { return false };
        if state.is_some() {
            return true;
        }
        match self.inner.changed.wait_timeout(state, timeout) {
            Ok((state, _)) => state.is_some(),
            Err(_) => false,
        }
    }
}

/// What a task's body receives.
pub struct TaskContext {
    name: String,
    token: CancellationToken,
    started_at: Instant,
    deadline_ms: Option<u64>,
}

impl TaskContext {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn token(&self) -> &CancellationToken {
        &self.token
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    /// Milliseconds left until the deadline, or `None` if there is none.
    pub fn remaining_ms(&self) -> Option<u64> {
        self.deadline_ms.map(|deadline| deadline.saturating_sub(self.started_at.elapsed().as_millis() as u64))
    }

    /// Interruptible sleep: wakes up immediately on cancellation.
    /// Returns `false` if it was woken by cancellation.
    pub fn sleep(&self, duration: Duration) -> bool {
        !self.token.wait_timeout(duration)
    }

    /// The cooperation point: fails if the task was cancelled.
    pub fn check(&self) -> Result<()> {
        match self.token.reason() {
            None => Ok(()),
            Some(reason) => {
                Err(RaptorError::new(reason.code(), format!("task '{}' {}", self.name, reason.describe()))
                    .with("name", self.name.clone()))
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Stats {
    pub spawned: u64,
    pub completed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub active: u64,
    pub peak_active: u64,
}

impl Stats {
    pub fn to_json(self) -> Json {
        Json::from_pairs([
            ("spawned", Json::from(self.spawned)),
            ("completed", Json::from(self.completed)),
            ("failed", Json::from(self.failed)),
            ("cancelled", Json::from(self.cancelled)),
            ("active", Json::from(self.active)),
            ("peakActive", Json::from(self.peak_active)),
        ])
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SpawnOptions {
    pub deadline_ms: Option<u64>,
}

/// The result of a spawned task. `join` propagates the failure or the cancellation.
pub struct TaskHandle<T> {
    handle: Option<std::thread::JoinHandle<Result<T>>>,
    name: String,
}

/// A hand-written `Debug`: a handle is identifiable by name, and the result
/// type does not itself have to be `Debug` for us to report errors.
impl<T> std::fmt::Debug for TaskHandle<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("TaskHandle").field("name", &self.name).finish()
    }
}

impl<T> TaskHandle<T> {
    pub fn join(mut self) -> Result<T> {
        match self.handle.take() {
            Some(handle) => handle.join().unwrap_or_else(|_| {
                // A panic in the task's body must not bring down the host:
                // we translate it into an ordinary evaluation error.
                Err(RaptorError::new(
                    ErrorCode::EngineEvaluation,
                    format!("task '{}' stopped unexpectedly", self.name),
                )
                .with("name", self.name.clone()))
            }),
            None => Err(RaptorError::new(ErrorCode::EngineEvaluation, "task already taken")),
        }
    }
}

struct Quota {
    active: Mutex<u64>,
    released: Condvar,
    limit: u64,
}

impl Quota {
    fn acquire(&self) -> u64 {
        let mut active = self.active.lock().expect("the quota is not poisoned");
        while *active >= self.limit {
            active = self.released.wait(active).expect("the quota is not poisoned");
        }
        *active += 1;
        *active
    }

    fn release(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = active.saturating_sub(1);
            self.released.notify_one();
        }
    }
}

struct Counters {
    spawned: AtomicU64,
    completed: AtomicU64,
    failed: AtomicU64,
    cancelled: AtomicU64,
    active: AtomicU64,
    peak_active: AtomicU64,
}

struct FabricInner {
    quota: Quota,
    counters: Counters,
    default_deadline_ms: Option<u64>,
    root: CancellationToken,
    closed: Mutex<bool>,
    idle: Condvar,
    observer: Observer,
}

pub struct TaskFabric {
    inner: Arc<FabricInner>,
}

impl TaskFabric {
    pub fn new(max_concurrent: usize, default_deadline_ms: Option<u64>, observer: Observer) -> Self {
        Self {
            inner: Arc::new(FabricInner {
                quota: Quota {
                    active: Mutex::new(0),
                    released: Condvar::new(),
                    limit: max_concurrent.max(1) as u64,
                },
                counters: Counters {
                    spawned: AtomicU64::new(0),
                    completed: AtomicU64::new(0),
                    failed: AtomicU64::new(0),
                    cancelled: AtomicU64::new(0),
                    active: AtomicU64::new(0),
                    peak_active: AtomicU64::new(0),
                },
                default_deadline_ms,
                root: CancellationToken::new(),
                closed: Mutex::new(false),
                idle: Condvar::new(),
                observer,
            }),
        }
    }

    pub fn is_closed(&self) -> bool {
        self.inner.closed.lock().map(|closed| *closed).unwrap_or(true)
    }

    /// Spawns a task. The body receives `&TaskContext` and must check
    /// `check()` at the points where cancellation makes sense.
    pub fn spawn<T, F>(&self, name: &str, options: SpawnOptions, body: F) -> Result<TaskHandle<T>>
    where
        T: Send + 'static,
        F: FnOnce(&TaskContext) -> Result<T> + Send + 'static,
    {
        if self.is_closed() {
            return Err(RaptorError::new(
                ErrorCode::TaskQuota,
                "task fabric is closed; it no longer accepts new work",
            )
            .with("name", name));
        }

        let inner = Arc::clone(&self.inner);
        let task_name = name.to_string();
        let deadline_ms = options.deadline_ms.or(inner.default_deadline_ms);

        inner.counters.spawned.fetch_add(1, Ordering::Relaxed);

        let handle = std::thread::Builder::new()
            .name(format!("raptor-task-{task_name}"))
            .spawn(move || run_task(inner, task_name, deadline_ms, body))
            .map_err(|error| {
                RaptorError::new(ErrorCode::TaskQuota, "could not start a thread for the task")
                    .with("cause", error.to_string())
            })?;

        Ok(TaskHandle { handle: Some(handle), name: name.to_string() })
    }

    /// Waits for in-flight work to finish, without cancelling.
    pub fn drain(&self) {
        let mut active = self.inner.quota.active.lock().expect("the quota is not poisoned");
        while *active > 0 {
            active = self.inner.idle.wait(active).expect("the quota is not poisoned");
        }
    }

    /// Cancels everything and drains; idempotent.
    pub fn shutdown(&self, reason: &str) {
        let already = {
            let mut closed = self.inner.closed.lock().expect("the state is not poisoned");
            let previous = *closed;
            *closed = true;
            previous
        };
        if !already {
            self.inner.observer.log(
                Severity::Info,
                "tasks.shutdown",
                BTreeMap::from([("reason".to_string(), Json::string(reason))]),
            );
            self.inner.root.cancel(CancelReason::Shutdown);
        }
        self.drain();
    }

    pub fn stats(&self) -> Stats {
        let counters = &self.inner.counters;
        Stats {
            spawned: counters.spawned.load(Ordering::Relaxed),
            completed: counters.completed.load(Ordering::Relaxed),
            failed: counters.failed.load(Ordering::Relaxed),
            cancelled: counters.cancelled.load(Ordering::Relaxed),
            active: counters.active.load(Ordering::Relaxed),
            peak_active: counters.peak_active.load(Ordering::Relaxed),
        }
    }
}

impl Drop for TaskFabric {
    fn drop(&mut self) {
        // A dropped fabric must not leave threads behind.
        if Arc::strong_count(&self.inner) == 1 {
            self.shutdown("drop");
        }
    }
}

/// Releases the quota and stops the sentinel **no matter what happens**, including if
/// the task's body panicked. Without this RAII, a single panic would
/// block a concurrency slot forever and `drain` would never finish.
struct TaskGuard {
    inner: Arc<FabricInner>,
    finished: CancellationToken,
    watcher: Option<std::thread::JoinHandle<()>>,
    settled: bool,
}

impl TaskGuard {
    fn settle(&mut self) {
        self.settled = true;
    }
}

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.finished.cancel(CancelReason::Requested);
        if let Some(watcher) = self.watcher.take() {
            let _ = watcher.join();
        }
        if !self.settled {
            // The body panicked before reporting a result.
            self.inner.counters.failed.fetch_add(1, Ordering::Relaxed);
        }

        self.inner.quota.release();
        let remaining = self.inner.quota.active.lock().map(|active| *active).unwrap_or(0);
        self.inner.counters.active.store(remaining, Ordering::Relaxed);
        if remaining == 0 {
            self.inner.idle.notify_all();
        }
    }
}

fn run_task<T, F>(inner: Arc<FabricInner>, name: String, deadline_ms: Option<u64>, body: F) -> Result<T>
where
    F: FnOnce(&TaskContext) -> Result<T>,
{
    let active = inner.quota.acquire();
    inner.counters.active.store(active, Ordering::Relaxed);
    inner.counters.peak_active.fetch_max(active, Ordering::Relaxed);

    let token = CancellationToken::new();
    let context =
        TaskContext { name: name.clone(), token: token.clone(), started_at: Instant::now(), deadline_ms };

    // The sentinel ties the task's token to the root token and to the deadline.
    // It stops itself when the task has finished, so no threads are left behind.
    let finished = CancellationToken::new();
    let watcher = {
        let root = inner.root.clone();
        let task_token = token.clone();
        let finished = finished.clone();
        std::thread::Builder::new()
            .name(format!("raptor-watch-{name}"))
            .spawn(move || {
                let step = Duration::from_millis(5);
                let deadline = deadline_ms.map(Duration::from_millis);
                let started = Instant::now();
                loop {
                    if finished.is_cancelled() {
                        return;
                    }
                    if root.is_cancelled() {
                        task_token.cancel(CancelReason::Shutdown);
                        return;
                    }
                    if let Some(limit) = deadline {
                        if started.elapsed() >= limit {
                            task_token.cancel(CancelReason::Deadline);
                            return;
                        }
                    }
                    // Immediate wake-up when the task finishes; otherwise, a short step.
                    finished.wait_timeout(step);
                }
            })
            .ok()
    };

    let mut guard = TaskGuard { inner: Arc::clone(&inner), finished, watcher, settled: false };

    let mut span = inner.observer.start_span(&format!("task.{name}"));
    // Default value: if we do not overwrite it, the body panicked and
    // the span says so instead of staying silent.
    span.set("outcome", Json::string("panicked"));

    let outcome = body(&context);
    let cancel_reason = token.reason();

    let result = match outcome {
        Ok(value) => {
            inner.counters.completed.fetch_add(1, Ordering::Relaxed);
            span.set("outcome", Json::string("completed"));
            Ok(value)
        }
        Err(error) => {
            // An error that occurs while the task was being cancelled is reported as
            // a cancellation, not as an application failure.
            match cancel_reason {
                Some(reason) => {
                    inner.counters.cancelled.fetch_add(1, Ordering::Relaxed);
                    span.set(
                        "outcome",
                        Json::string(if reason == CancelReason::Deadline { "deadline" } else { "cancelled" }),
                    );
                    Err(RaptorError::new(reason.code(), format!("task '{name}' {}", reason.describe()))
                        .with("name", name.clone())
                        .with("cause", error.message))
                }
                None => {
                    inner.counters.failed.fetch_add(1, Ordering::Relaxed);
                    span.set("outcome", Json::string("failed"));
                    span.set("error", Json::string(error.message.clone()));
                    Err(error)
                }
            }
        }
    };

    span.end();
    guard.settle();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fabric(max_concurrent: usize) -> TaskFabric {
        TaskFabric::new(max_concurrent, None, Observer::frozen())
    }

    #[test]
    fn un_task_terminat_cu_bine_intra_in_statistici() {
        let tasks = fabric(4);
        let handle = tasks.spawn("ok", SpawnOptions::default(), |_| Ok(7u32)).expect("spawn");
        assert_eq!(handle.join().expect("result"), 7);

        tasks.drain();
        let stats = tasks.stats();
        assert_eq!(stats.spawned, 1);
        assert_eq!(stats.completed, 1);
        assert_eq!(stats.active, 0);
    }

    #[test]
    fn esecul_aplicatiei_ramane_esec_nu_devine_anulare() {
        let tasks = fabric(4);
        let handle = tasks
            .spawn("crapa", SpawnOptions::default(), |_| -> Result<()> {
                Err(RaptorError::new(ErrorCode::EngineEvaluation, "deliberate failure"))
            })
            .expect("spawn");

        let error = handle.join().expect_err("failure");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
        tasks.drain();
        assert_eq!(tasks.stats().failed, 1);
        assert_eq!(tasks.stats().cancelled, 0);
    }

    #[test]
    fn un_panic_in_task_nu_darama_host_ul() {
        let tasks = fabric(2);
        let handle = tasks
            .spawn("panicat", SpawnOptions::default(), |_| -> Result<()> {
                panic!("something unexpected");
            })
            .expect("spawn");
        let error = handle.join().expect_err("failure");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
    }

    #[test]
    fn deadline_ul_anuleaza_task_ul_cu_un_cod_stabil() {
        let tasks = fabric(2);
        let handle = tasks
            .spawn("lent", SpawnOptions { deadline_ms: Some(30) }, |context| {
                context.sleep(Duration::from_secs(5));
                context.check()
            })
            .expect("spawn");

        let error = handle.join().expect_err("deadline");
        assert_eq!(error.code, ErrorCode::TaskDeadline);
        tasks.drain();
        assert_eq!(tasks.stats().cancelled, 1);
    }

    #[test]
    fn contextul_raporteaza_timpul_ramas_pana_la_deadline() {
        let tasks = fabric(2);
        let handle = tasks
            .spawn("cu-deadline", SpawnOptions { deadline_ms: Some(10_000) }, |context| {
                let remaining = context.remaining_ms().expect("there is a deadline");
                assert!(remaining <= 10_000 && remaining > 9_000, "remaining: {remaining}");
                Ok(())
            })
            .expect("spawn");
        handle.join().expect("result");
    }

    #[test]
    fn somnul_este_intrerupt_de_anulare() {
        let tasks = fabric(2);
        let handle = tasks
            .spawn("adormit", SpawnOptions::default(), |context| {
                let started = Instant::now();
                let completed = context.sleep(Duration::from_secs(30));
                Ok((completed, started.elapsed()))
            })
            .expect("spawn");

        std::thread::sleep(Duration::from_millis(50));
        tasks.shutdown("test");

        let (completed, elapsed) = handle.join().expect("result");
        assert!(!completed, "sleep must be interrupted by cancellation");
        assert!(elapsed < Duration::from_secs(5), "the wake-up took {elapsed:?}");
    }

    #[test]
    fn shutdown_anuleaza_lucrul_in_zbor_si_refuza_lucru_nou() {
        let tasks = fabric(4);
        let handle = tasks
            .spawn("lung", SpawnOptions::default(), |context| {
                context.sleep(Duration::from_secs(30));
                context.check()
            })
            .expect("spawn");

        std::thread::sleep(Duration::from_millis(30));
        tasks.shutdown("test");

        let error = handle.join().expect_err("cancellation");
        assert_eq!(error.code, ErrorCode::TaskCancelled);
        assert!(tasks.is_closed());

        let refused = tasks.spawn("prea-tarziu", SpawnOptions::default(), |_| Ok(())).expect_err("refusal");
        assert_eq!(refused.code, ErrorCode::TaskQuota);
        assert_eq!(tasks.stats().active, 0);
    }

    #[test]
    fn shutdown_este_idempotent() {
        let tasks = fabric(2);
        tasks.shutdown("once");
        tasks.shutdown("twice");
        assert!(tasks.is_closed());
    }

    #[test]
    fn drain_asteapta_fara_sa_anuleze() {
        let tasks = fabric(4);
        let handle = tasks
            .spawn("scurt", SpawnOptions::default(), |context| {
                let completed = context.sleep(Duration::from_millis(40));
                Ok(completed)
            })
            .expect("spawn");

        tasks.drain();
        assert_eq!(tasks.stats().active, 0);
        assert!(handle.join().expect("result"), "drain does not cancel");
        assert!(!tasks.is_closed(), "drain does not close the fabric");
    }

    #[test]
    fn cota_de_concurenta_este_respectata_si_varful_raportat() {
        let tasks = fabric(2);
        let handles: Vec<_> = (0..6)
            .map(|index| {
                tasks
                    .spawn(&format!("t{index}"), SpawnOptions::default(), |context| {
                        context.sleep(Duration::from_millis(20));
                        Ok(())
                    })
                    .expect("spawn")
            })
            .collect();

        for handle in handles {
            handle.join().expect("result");
        }
        tasks.drain();

        let stats = tasks.stats();
        assert_eq!(stats.completed, 6);
        assert!(stats.peak_active <= 2, "quota exceeded: peak {}", stats.peak_active);
    }

    #[test]
    fn fiecare_task_produce_un_span_cu_rezultatul_lui() {
        let observer = Observer::frozen();
        let tasks = TaskFabric::new(2, None, observer.clone());
        tasks
            .spawn("cu-span", SpawnOptions::default(), |_| Ok(()))
            .expect("spawn")
            .join()
            .expect("result");
        tasks.drain();

        let span = observer
            .events()
            .into_iter()
            .find(|event| event.kind == crate::observe::EventKind::Span)
            .expect("span recorded");
        assert_eq!(span.name, "task.cu-span");
        assert_eq!(span.attributes.get("outcome"), Some(&Json::string("completed")));
    }
}
