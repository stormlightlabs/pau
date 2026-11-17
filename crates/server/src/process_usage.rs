//! Samples the CPU and memory of Pau's process tree and of each live agent
//! session's tree, and publishes them as
//! [`ServerEventKind::ProcessUsageSampled`].
//!
//! One task samples on a fixed interval, so the rate never depends on how
//! many clients are connected. A tick with no client connected samples
//! nothing. Reading the process table is blocking work, so it runs on the
//! blocking pool, and the next tick waits until it finishes.

use std::{collections::HashMap, future::Future, time::Duration};

use pau_core::{
    ServerEventKind,
    resource_monitor::{
        MonitoredProcess, ProcessIdentity, ProcessResourceSnapshot, ProcessSampler,
        ResourceMonitor, ResourcePressureConfig, SAMPLE_INTERVAL_MILLIS,
    },
};
use tokio::{task::JoinHandle, time::MissedTickBehavior};

use crate::{EventHub, diagnostic_timestamp};

/// Time between samples.
pub(crate) const SAMPLE_INTERVAL: Duration = Duration::from_millis(SAMPLE_INTERVAL_MILLIS);

/// Process ID and kind of Pau's own tree in each sample.
const PAU: &str = "pau";

/// One agent process whose tree a sample measures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UsageRoot {
    /// The session's ID, which names the tree in the sample.
    pub session_id: String,
    /// Workspace the session runs in.
    pub workspace_id: String,
    /// The agent the session runs, such as `pi` or `claude`.
    pub agent: String,
    /// Operating-system ID of the agent process.
    pub pid: u32,
}

/// What [`spawn`] samples and where it publishes.
pub(crate) struct ProcessUsageSampling<S, R> {
    /// Hub the samples go to. Its subscriber count decides whether a tick samples.
    pub events: EventHub,
    /// Reads the process table.
    pub sampler: S,
    /// Lists the live agent sessions at each tick.
    pub roots: R,
    /// Time between samples, [`SAMPLE_INTERVAL`] outside tests.
    pub interval: Duration,
    /// Root of Pau's own tree: this process, which starts every session and
    /// terminal.
    pub pau_pid: u32,
}

/// Starts sampling. Abort the returned task to stop it.
pub(crate) fn spawn<S, R, F>(sampling: ProcessUsageSampling<S, R>) -> JoinHandle<()>
where
    S: ProcessSampler + Send + 'static,
    R: Fn() -> F + Send + 'static,
    F: Future<Output = Vec<UsageRoot>> + Send + 'static,
{
    tokio::spawn(run(sampling))
}

async fn run<S, R, F>(sampling: ProcessUsageSampling<S, R>)
where
    S: ProcessSampler + Send + 'static,
    R: Fn() -> F + Send + 'static,
    F: Future<Output = Vec<UsageRoot>> + Send + 'static,
{
    let ProcessUsageSampling {
        events,
        sampler,
        roots,
        interval,
        pau_pid,
    } = sampling;
    let mut state = Some(Sampler::new(sampler, pau_pid));
    let mut ticks = tokio::time::interval(interval);
    // A slow sample delays the next tick instead of bunching the missed ones.
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        if !events.has_subscribers() {
            continue;
        }
        let listed = roots().await;
        let mut sampler = state.take().expect("the sampler returns after each tick");
        let sampled = tokio::task::spawn_blocking(move || {
            let snapshots = sampler.sample(listed, epoch_millis());
            (sampler, snapshots)
        })
        .await;
        let Ok((sampler, snapshots)) = sampled else {
            tracing::warn!(
                event = "process_usage.sampler_failed",
                "the process sampler panicked, so resource use is no longer reported"
            );
            return;
        };
        state = Some(sampler);
        let payload =
            serde_json::to_string(&snapshots).expect("resource snapshots are serializable");
        events.publish(
            diagnostic_timestamp(),
            None,
            None,
            ServerEventKind::ProcessUsageSampled,
            payload,
        );
    }
}

fn epoch_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// The process table reader and the monitor that turns its rows into trees.
struct Sampler<S> {
    sampler: S,
    monitor: ResourceMonitor,
    pau_pid: u32,
    /// Root PID of each registered tree, to register a root again when its ID
    /// moves to a new process.
    registered: HashMap<String, u32>,
}

impl<S: ProcessSampler> Sampler<S> {
    fn new(sampler: S, pau_pid: u32) -> Self {
        Self {
            sampler,
            // The interval already bounds the rate, so the monitor publishes
            // every observation and keeps only the latest for peaks.
            monitor: ResourceMonitor::new(1, 0, ResourcePressureConfig::default()),
            pau_pid,
            registered: HashMap::new(),
        }
    }

    /// Reads the process table once and returns Pau's tree and each listed
    /// session's tree, sorted by process ID. Pau's tree carries totals only,
    /// without the per-process breakdown, which would list every process Pau
    /// started on every sample.
    fn sample(
        &mut self,
        roots: Vec<UsageRoot>,
        sampled_at_millis: u64,
    ) -> Vec<ProcessResourceSnapshot> {
        let observed = self.sampler.sample();
        let pau = MonitoredProcess {
            id: PAU.to_owned(),
            workspace_id: None,
            session_id: None,
            kind: PAU.to_owned(),
            root: ProcessIdentity {
                pid: self.pau_pid,
                started_at_seconds: 0,
            },
            started_at_millis: 0,
        };
        let listed: Vec<MonitoredProcess> = std::iter::once(pau)
            .chain(roots.into_iter().map(|root| MonitoredProcess {
                id: root.session_id.clone(),
                workspace_id: Some(root.workspace_id),
                session_id: Some(root.session_id),
                kind: root.agent,
                root: ProcessIdentity {
                    pid: root.pid,
                    started_at_seconds: 0,
                },
                started_at_millis: 0,
            }))
            .collect();
        let monitor = &mut self.monitor;
        self.registered.retain(|id, _| {
            let listed = listed.iter().any(|process| &process.id == id);
            if !listed {
                monitor.unregister(id);
            }
            listed
        });
        for process in &listed {
            if self.registered.get(&process.id) == Some(&process.root.pid) {
                continue;
            }
            // The monitor tells a reused PID apart by its start time, which
            // only the process table knows.
            let Some(row) = observed
                .iter()
                .find(|row| row.identity.pid == process.root.pid)
            else {
                continue;
            };
            self.monitor.register(MonitoredProcess {
                root: row.identity,
                started_at_millis: row.identity.started_at_seconds.saturating_mul(1_000),
                ..process.clone()
            });
            self.registered.insert(process.id.clone(), process.root.pid);
        }
        let mut snapshots = self.monitor.observe(sampled_at_millis, observed).published;
        snapshots.retain(|snapshot| self.registered.contains_key(&snapshot.process_id));
        for snapshot in &mut snapshots {
            if snapshot.process_id == PAU {
                snapshot.processes.clear();
            }
        }
        snapshots
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use pau_core::resource_monitor::ObservedProcess;

    use super::*;

    /// A process table that never changes, counting how often it is read.
    struct FakeTable {
        reads: Arc<AtomicUsize>,
        rows: Vec<ObservedProcess>,
    }

    impl ProcessSampler for FakeTable {
        fn sample(&mut self) -> Vec<ObservedProcess> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.rows.clone()
        }
    }

    fn row(pid: u32, parent: Option<u32>, name: &str, cpu: f32, memory: u64) -> ObservedProcess {
        ObservedProcess {
            identity: ProcessIdentity {
                pid,
                started_at_seconds: 1_000 + u64::from(pid),
            },
            parent_pid: parent,
            name: name.to_owned(),
            cpu_percent: cpu,
            cpu_time_millis: 0,
            resident_memory_bytes: memory,
            disk_read_bytes: None,
            disk_write_bytes: None,
        }
    }

    /// Pau (1) runs a Pi session (10) with two MCP servers and a terminal
    /// (20). Process 99 belongs to someone else.
    fn table(reads: &Arc<AtomicUsize>) -> FakeTable {
        FakeTable {
            reads: Arc::clone(reads),
            rows: vec![
                row(1, None, "pau", 2.0, 100),
                row(10, Some(1), "pi", 30.0, 1_000),
                row(11, Some(10), "mcp-github", 5.0, 200),
                row(12, Some(10), "mcp-files", 1.0, 300),
                row(20, Some(1), "zsh", 0.5, 50),
                row(99, None, "other", 90.0, 9_000),
            ],
        }
    }

    fn session_root() -> UsageRoot {
        UsageRoot {
            session_id: "session-1".to_owned(),
            workspace_id: "workspace-1".to_owned(),
            agent: "pi".to_owned(),
            pid: 10,
        }
    }

    fn start(events: &EventHub, reads: &Arc<AtomicUsize>, roots: Vec<UsageRoot>) -> JoinHandle<()> {
        spawn(ProcessUsageSampling {
            events: events.clone(),
            sampler: table(reads),
            roots: move || {
                let roots = roots.clone();
                async move { roots }
            },
            interval: SAMPLE_INTERVAL,
            pau_pid: 1,
        })
    }

    fn snapshots(event: &pau_core::ServerEvent) -> Vec<ProcessResourceSnapshot> {
        assert_eq!(event.kind, ServerEventKind::ProcessUsageSampled);
        serde_json::from_str(&event.payload).unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn samples_once_per_interval_however_many_clients_listen() {
        let events = EventHub::default();
        let reads = Arc::new(AtomicUsize::new(0));
        let mut first = events.live.subscribe();
        let _second = events.live.subscribe();
        let _third = events.live.subscribe();
        let started = tokio::time::Instant::now();
        let task = start(&events, &reads, vec![session_root()]);

        for _ in 0..5 {
            first.recv().await.unwrap();
        }
        // The first sample is immediate, and each later one waits an interval.
        assert!(tokio::time::Instant::now() - started >= SAMPLE_INTERVAL * 4);
        assert_eq!(reads.load(Ordering::SeqCst), 5);
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn samples_nothing_while_no_client_listens() {
        let events = EventHub::default();
        let reads = Arc::new(AtomicUsize::new(0));
        let task = start(&events, &reads, vec![session_root()]);

        tokio::time::sleep(SAMPLE_INTERVAL * 10).await;
        assert_eq!(reads.load(Ordering::SeqCst), 0);
        assert_eq!(events.last_sequence(), 0);

        let mut receiver = events.live.subscribe();
        receiver.recv().await.unwrap();
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn reports_pau_totals_and_each_session_tree() {
        let events = EventHub::default();
        let reads = Arc::new(AtomicUsize::new(0));
        let mut receiver = events.live.subscribe();
        let task = start(&events, &reads, vec![session_root()]);

        let sample = snapshots(&receiver.recv().await.unwrap());
        task.abort();
        let [pau, session] = sample.as_slice() else {
            panic!("expected two trees, got {sample:?}");
        };
        assert_eq!(pau.kind, "pau");
        assert_eq!(pau.workspace_id, None);
        assert_eq!(pau.process_count, 5);
        assert_eq!(pau.cpu_percent, 38.5);
        assert_eq!(pau.resident_memory_bytes, 1_650);
        assert!(pau.processes.is_empty());

        assert_eq!(session.process_id, "session-1");
        assert_eq!(session.session_id.as_deref(), Some("session-1"));
        assert_eq!(session.workspace_id.as_deref(), Some("workspace-1"));
        assert_eq!(session.kind, "pi");
        assert_eq!(session.process_count, 3);
        assert_eq!(session.resident_memory_bytes, 1_500);
        let mut names: Vec<_> = session
            .processes
            .iter()
            .map(|node| node.name.as_str())
            .collect();
        names.sort_unstable();
        assert_eq!(names, ["mcp-files", "mcp-github", "pi"]);
    }

    #[test]
    fn drops_a_session_once_it_is_no_longer_listed() {
        let mut sampler = Sampler::new(table(&Arc::new(AtomicUsize::new(0))), 1);
        assert_eq!(sampler.sample(vec![session_root()], 2_000).len(), 2);
        let after = sampler.sample(Vec::new(), 4_000);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].process_id, "pau");
        // The monitor no longer walks the session's tree or keeps its sample.
        assert!(sampler.monitor.history("session-1").is_none());
        assert!(sampler.monitor.history("pau").is_some());
        // A root whose process is not in the table is left out.
        let missing = UsageRoot {
            pid: 404,
            ..session_root()
        };
        assert_eq!(sampler.sample(vec![missing], 6_000).len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn snapshots_keep_the_latest_sample_and_replay_keeps_none() {
        let events = EventHub::default();
        let reads = Arc::new(AtomicUsize::new(0));
        let mut receiver = events.live.subscribe();
        let task = start(&events, &reads, Vec::new());
        receiver.recv().await.unwrap();
        let latest = receiver.recv().await.unwrap();
        task.abort();

        let replay = events.subscribe(Some(0));
        assert!(replay.initial.is_empty());
        let fresh = events.subscribe(None);
        let [pau_core::ServerStreamMessage::Snapshot { snapshot }] = fresh.initial.as_slice()
        else {
            panic!("a client without a checkpoint gets a snapshot");
        };
        assert_eq!(snapshot.events, vec![latest]);
    }
}
