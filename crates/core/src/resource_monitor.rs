//! Resource sampling and aggregation for process trees owned by Pau.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use ts_rs::TS;

/// Default two-second sampling interval.
pub const SAMPLE_INTERVAL_MILLIS: u64 = 2_000;
/// About 30 minutes of samples at the default interval.
pub const DEFAULT_HISTORY_CAPACITY: usize = 900;
/// Default minimum interval between client snapshots.
pub const DEFAULT_PUBLISH_INTERVAL_MILLIS: u64 = 2_000;

/// A process identity that remains valid when an operating-system PID is reused.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProcessIdentity {
    /// Operating-system process identifier.
    pub pid: u32,
    /// Process start time in seconds since the Unix epoch.
    pub started_at_seconds: u64,
}

/// One process returned by an operating-system sampler.
#[derive(Debug, Clone, PartialEq)]
pub struct ObservedProcess {
    /// PID and start time used as the sampling identity.
    pub identity: ProcessIdentity,
    /// Parent PID reported by the operating system.
    pub parent_pid: Option<u32>,
    /// Executable name the operating system reports, without arguments.
    pub name: String,
    /// Current CPU use as a percentage of one logical CPU.
    pub cpu_percent: f32,
    /// Accumulated CPU time in milliseconds.
    pub cpu_time_millis: u64,
    /// Current resident memory in bytes.
    pub resident_memory_bytes: u64,
    /// Total bytes read since process start, when reliable.
    pub disk_read_bytes: Option<u64>,
    /// Total bytes written since process start, when reliable.
    pub disk_write_bytes: Option<u64>,
}

/// Produces one process-table observation.
pub trait ProcessSampler {
    /// Refreshes the process table and returns all visible processes.
    fn sample(&mut self) -> Vec<ObservedProcess>;
}

/// Cross-platform sampler backed by `sysinfo`.
///
/// CPU, resident memory, parent discovery, and start time are available on
/// Linux and macOS. Disk counters are exposed only on Linux because the macOS
/// backend does not provide the same reliable per-process totals.
pub struct SystemProcessSampler {
    system: System,
}

/// What each sample reads for every process on the machine.
///
/// `sysinfo` always reads the name, parent and start time. Everything else is
/// opt-in, and this asks only for the counters Pau reports. Never add the
/// command line, environment, working directory or executable path: the
/// sampler walks every user's processes, and `sysinfo` keeps what it reads, so
/// those would put other programs' arguments and secrets in Pau's memory.
fn process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_disk_usage()
        .without_tasks()
}

impl Default for SystemProcessSampler {
    fn default() -> Self {
        let refresh = RefreshKind::nothing().with_processes(process_refresh_kind());
        Self {
            system: System::new_with_specifics(refresh),
        }
    }
}

impl ProcessSampler for SystemProcessSampler {
    fn sample(&mut self) -> Vec<ObservedProcess> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            process_refresh_kind(),
        );
        self.system
            .processes()
            .iter()
            .map(|(pid, process)| {
                let pid = pid.as_u32();
                let parent_pid = process.parent().map(|parent| parent.as_u32());
                let disk = process.disk_usage();
                ObservedProcess {
                    identity: ProcessIdentity {
                        pid,
                        started_at_seconds: process.start_time(),
                    },
                    parent_pid,
                    name: process.name().to_string_lossy().into_owned(),
                    cpu_percent: process.cpu_usage(),
                    cpu_time_millis: process.accumulated_cpu_time(),
                    resident_memory_bytes: process.memory(),
                    disk_read_bytes: cfg!(target_os = "linux").then_some(disk.total_read_bytes),
                    disk_write_bytes: cfg!(target_os = "linux").then_some(disk.total_written_bytes),
                }
            })
            .collect()
    }
}

/// One root process registered by its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitoredProcess {
    /// Stable Pau process identifier.
    pub id: String,
    /// Workspace that owns the process. Absent for Pau's own process tree.
    pub workspace_id: Option<String>,
    /// Session that owns the process, when applicable.
    pub session_id: Option<String>,
    /// Human-readable process kind, such as `pi`, `claude`, or `terminal`.
    pub kind: String,
    /// Root operating-system process identity.
    pub root: ProcessIdentity,
    /// Timestamp in milliseconds used to calculate elapsed time.
    pub started_at_millis: u64,
}

/// Per-process measurements retained for a process-tree breakdown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProcessResourceNode {
    /// PID and start time used as the sampling identity.
    pub identity: ProcessIdentity,
    /// Parent PID reported by the operating system.
    pub parent_pid: Option<u32>,
    /// Executable name the operating system reports, without arguments, so
    /// the breakdown names a process without exposing its command line.
    pub name: String,
    /// Current CPU use as a percentage of one logical CPU.
    pub cpu_percent: f32,
    /// Current resident memory in bytes.
    pub resident_memory_bytes: u64,
    /// Total disk bytes read, when reliable.
    pub disk_read_bytes: Option<u64>,
    /// Total disk bytes written, when reliable.
    pub disk_write_bytes: Option<u64>,
}

/// Aggregate use for one Pau-owned process tree at one point in time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProcessResourceSnapshot {
    /// Stable Pau process identifier.
    pub process_id: String,
    /// Workspace that owns the process. Absent for Pau's own process tree.
    pub workspace_id: Option<String>,
    /// Session that owns the process, when applicable.
    pub session_id: Option<String>,
    /// Process kind shown in the UI.
    pub kind: String,
    /// Sample timestamp in milliseconds since the Unix epoch.
    pub sampled_at_millis: u64,
    /// Time since the owner registered the root process.
    pub elapsed_millis: u64,
    /// Current CPU use summed across the tree.
    pub cpu_percent: f32,
    /// Accumulated CPU time summed across the tree.
    pub cpu_time_millis: u64,
    /// Current resident memory summed across the tree.
    pub resident_memory_bytes: u64,
    /// Highest aggregate resident memory observed for the tree.
    pub peak_resident_memory_bytes: u64,
    /// Number of live processes in the tree.
    pub process_count: u32,
    /// Highest process count observed for the tree.
    pub peak_process_count: u32,
    /// Total disk bytes read across the tree, when reliable.
    pub disk_read_bytes: Option<u64>,
    /// Total disk bytes written across the tree, when reliable.
    pub disk_write_bytes: Option<u64>,
    /// Current per-process breakdown for the root and descendants.
    pub processes: Vec<ProcessResourceNode>,
}

/// Advisory pressure state for a process tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ResourcePressureKind {
    /// CPU use exceeded the configured limit for enough samples.
    Cpu,
    /// Resident memory exceeded the configured limit for enough samples.
    Memory,
}

/// A sustained-pressure warning. The monitor never takes action automatically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResourcePressureWarning {
    /// Stable Pau process identifier.
    pub process_id: String,
    /// Session that owns the process, when applicable.
    pub session_id: Option<String>,
    /// Counter that remained above its threshold.
    pub kind: ResourcePressureKind,
    /// Number of consecutive samples above the threshold.
    pub sustained_samples: u32,
}

/// Small durable record written after a process tree exits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProcessResourceSummary {
    /// Stable Pau process identifier.
    pub process_id: String,
    /// Final sampling timestamp in milliseconds since the Unix epoch.
    pub ended_at_millis: u64,
    /// Total elapsed time observed by Pau.
    pub elapsed_millis: u64,
    /// Highest aggregate resident memory observed for the tree.
    pub peak_resident_memory_bytes: u64,
    /// Final accumulated CPU time across the tree.
    pub cpu_time_millis: u64,
    /// Highest process count observed for the tree.
    pub peak_process_count: u32,
    /// Final disk bytes read across the tree, when reliable.
    pub disk_read_bytes: Option<u64>,
    /// Final disk bytes written across the tree, when reliable.
    pub disk_write_bytes: Option<u64>,
}

/// Thresholds used to identify sustained resource pressure.
#[derive(Debug, Clone, Copy)]
pub struct ResourcePressureConfig {
    /// Aggregate CPU percentage that counts as pressure.
    pub cpu_percent: f32,
    /// Resident memory in bytes that counts as pressure.
    pub resident_memory_bytes: u64,
    /// Consecutive samples required before a warning is emitted.
    pub sustained_samples: u32,
}

impl Default for ResourcePressureConfig {
    fn default() -> Self {
        Self {
            cpu_percent: 200.0,
            resident_memory_bytes: 2 * 1024 * 1024 * 1024,
            sustained_samples: 3,
        }
    }
}

/// Changes produced by one process-table observation.
#[derive(Debug, Default, PartialEq)]
pub struct ResourceMonitorUpdate {
    /// Latest tree snapshots. Empty when client publication is throttled.
    pub published: Vec<ProcessResourceSnapshot>,
    /// New sustained-pressure warnings.
    pub warnings: Vec<ResourcePressureWarning>,
    /// Final summaries for roots that exited or were replaced through PID reuse.
    pub completed: Vec<ProcessResourceSummary>,
}

#[derive(Default)]
struct PressureState {
    cpu: u32,
    memory: u32,
    cpu_warned: bool,
    memory_warned: bool,
}

/// Aggregates process trees, bounds raw history, and detects process exit.
pub struct ResourceMonitor {
    history_capacity: usize,
    publish_interval_millis: u64,
    pressure: ResourcePressureConfig,
    registrations: HashMap<String, MonitoredProcess>,
    history: HashMap<String, VecDeque<ProcessResourceSnapshot>>,
    pressure_state: HashMap<String, PressureState>,
    last_published_at: Option<u64>,
}

impl Default for ResourceMonitor {
    fn default() -> Self {
        Self::new(
            DEFAULT_HISTORY_CAPACITY,
            DEFAULT_PUBLISH_INTERVAL_MILLIS,
            ResourcePressureConfig::default(),
        )
    }
}

impl ResourceMonitor {
    /// Creates a monitor with explicit retention, publication, and warning limits.
    pub fn new(
        history_capacity: usize,
        publish_interval_millis: u64,
        pressure: ResourcePressureConfig,
    ) -> Self {
        assert!(
            history_capacity > 0,
            "resource history capacity must be positive"
        );
        Self {
            history_capacity,
            publish_interval_millis,
            pressure,
            registrations: HashMap::new(),
            history: HashMap::new(),
            pressure_state: HashMap::new(),
            last_published_at: None,
        }
    }

    /// Registers or replaces one root process without sampling it immediately.
    pub fn register(&mut self, process: MonitoredProcess) {
        self.history.remove(&process.id);
        self.pressure_state.remove(&process.id);
        self.registrations.insert(process.id.clone(), process);
    }

    /// Stops sampling one process tree and drops its history, for an owner
    /// that no longer tracks it. Unlike an exit, this yields no summary.
    pub fn unregister(&mut self, process_id: &str) {
        self.registrations.remove(process_id);
        self.history.remove(process_id);
        self.pressure_state.remove(process_id);
    }

    /// Returns bounded raw history for one stable process identifier.
    pub fn history(&self, process_id: &str) -> Option<&VecDeque<ProcessResourceSnapshot>> {
        self.history.get(process_id)
    }

    /// Returns the latest snapshot for every active process tree in one workspace.
    pub fn workspace_snapshots(&self, workspace_id: &str) -> Vec<ProcessResourceSnapshot> {
        let mut snapshots: Vec<_> = self
            .registrations
            .values()
            .filter(|process| process.workspace_id.as_deref() == Some(workspace_id))
            .filter_map(|process| self.history.get(&process.id)?.back().cloned())
            .collect();
        snapshots.sort_by(|left, right| left.process_id.cmp(&right.process_id));
        snapshots
    }

    /// Samples through a supplied platform or fixture sampler.
    pub fn sample<S: ProcessSampler>(
        &mut self,
        sampled_at_millis: u64,
        sampler: &mut S,
    ) -> ResourceMonitorUpdate {
        self.observe(sampled_at_millis, sampler.sample())
    }

    /// Applies one deterministic process-table observation.
    pub fn observe(
        &mut self,
        sampled_at_millis: u64,
        observed: Vec<ObservedProcess>,
    ) -> ResourceMonitorUpdate {
        let by_pid: HashMap<u32, &ObservedProcess> = observed
            .iter()
            .map(|process| (process.identity.pid, process))
            .collect();
        let should_publish = self.last_published_at.is_none_or(|last| {
            sampled_at_millis.saturating_sub(last) >= self.publish_interval_millis
        });
        let mut update = ResourceMonitorUpdate::default();
        let ids: Vec<_> = self.registrations.keys().cloned().collect();

        for id in ids {
            let registration = self
                .registrations
                .get(&id)
                .expect("ID came from registrations");
            let root_alive = by_pid
                .get(&registration.root.pid)
                .is_some_and(|root| root.identity == registration.root);
            if !root_alive {
                if let Some(summary) = self.finish(&id, sampled_at_millis) {
                    update.completed.push(summary);
                }
                continue;
            }

            let tree = collect_tree(registration.root, &observed, &by_pid);
            let previous = self.history.get(&id).and_then(|history| history.back());
            let peak_memory = previous.map_or(0, |snapshot| snapshot.peak_resident_memory_bytes);
            let peak_count = previous.map_or(0, |snapshot| snapshot.peak_process_count);
            let disk_reliable = tree.iter().all(|process| {
                process.disk_read_bytes.is_some() && process.disk_write_bytes.is_some()
            });
            let snapshot = ProcessResourceSnapshot {
                process_id: registration.id.clone(),
                workspace_id: registration.workspace_id.clone(),
                session_id: registration.session_id.clone(),
                kind: registration.kind.clone(),
                sampled_at_millis,
                elapsed_millis: sampled_at_millis.saturating_sub(registration.started_at_millis),
                cpu_percent: tree.iter().map(|process| process.cpu_percent).sum(),
                cpu_time_millis: tree.iter().map(|process| process.cpu_time_millis).sum(),
                resident_memory_bytes: tree
                    .iter()
                    .map(|process| process.resident_memory_bytes)
                    .sum(),
                peak_resident_memory_bytes: 0,
                process_count: u32::try_from(tree.len()).unwrap_or(u32::MAX),
                peak_process_count: 0,
                disk_read_bytes: disk_reliable.then(|| {
                    tree.iter()
                        .filter_map(|process| process.disk_read_bytes)
                        .sum()
                }),
                disk_write_bytes: disk_reliable.then(|| {
                    tree.iter()
                        .filter_map(|process| process.disk_write_bytes)
                        .sum()
                }),
                processes: tree
                    .iter()
                    .map(|process| ProcessResourceNode {
                        identity: process.identity,
                        parent_pid: process.parent_pid,
                        name: process.name.clone(),
                        cpu_percent: process.cpu_percent,
                        resident_memory_bytes: process.resident_memory_bytes,
                        disk_read_bytes: process.disk_read_bytes,
                        disk_write_bytes: process.disk_write_bytes,
                    })
                    .collect(),
            };
            let snapshot = ProcessResourceSnapshot {
                peak_resident_memory_bytes: peak_memory.max(snapshot.resident_memory_bytes),
                peak_process_count: peak_count.max(snapshot.process_count),
                ..snapshot
            };
            self.record_warning(&snapshot, &mut update.warnings);
            let history = self.history.entry(id).or_default();
            history.push_back(snapshot.clone());
            while history.len() > self.history_capacity {
                history.pop_front();
            }
            if should_publish {
                update.published.push(snapshot);
            }
        }

        if should_publish {
            self.last_published_at = Some(sampled_at_millis);
            update
                .published
                .sort_by(|left, right| left.process_id.cmp(&right.process_id));
        }
        update
            .completed
            .sort_by(|left, right| left.process_id.cmp(&right.process_id));
        update
    }

    fn record_warning(
        &mut self,
        snapshot: &ProcessResourceSnapshot,
        warnings: &mut Vec<ResourcePressureWarning>,
    ) {
        let state = self
            .pressure_state
            .entry(snapshot.process_id.clone())
            .or_default();
        state.cpu = if snapshot.cpu_percent >= self.pressure.cpu_percent {
            state.cpu.saturating_add(1)
        } else {
            state.cpu_warned = false;
            0
        };
        state.memory = if snapshot.resident_memory_bytes >= self.pressure.resident_memory_bytes {
            state.memory.saturating_add(1)
        } else {
            state.memory_warned = false;
            0
        };
        if state.cpu >= self.pressure.sustained_samples && !state.cpu_warned {
            state.cpu_warned = true;
            warnings.push(ResourcePressureWarning {
                process_id: snapshot.process_id.clone(),
                session_id: snapshot.session_id.clone(),
                kind: ResourcePressureKind::Cpu,
                sustained_samples: state.cpu,
            });
        }
        if state.memory >= self.pressure.sustained_samples && !state.memory_warned {
            state.memory_warned = true;
            warnings.push(ResourcePressureWarning {
                process_id: snapshot.process_id.clone(),
                session_id: snapshot.session_id.clone(),
                kind: ResourcePressureKind::Memory,
                sustained_samples: state.memory,
            });
        }
    }

    fn finish(&mut self, process_id: &str, ended_at_millis: u64) -> Option<ProcessResourceSummary> {
        let registration = self.registrations.remove(process_id)?;
        self.pressure_state.remove(process_id);
        let history = self.history.remove(process_id);
        let latest = history.as_ref().and_then(|history| history.back());
        Some(ProcessResourceSummary {
            process_id: process_id.to_owned(),
            ended_at_millis,
            elapsed_millis: ended_at_millis.saturating_sub(registration.started_at_millis),
            peak_resident_memory_bytes: latest
                .map_or(0, |sample| sample.peak_resident_memory_bytes),
            cpu_time_millis: latest.map_or(0, |sample| sample.cpu_time_millis),
            peak_process_count: latest.map_or(0, |sample| sample.peak_process_count),
            disk_read_bytes: latest.and_then(|sample| sample.disk_read_bytes),
            disk_write_bytes: latest.and_then(|sample| sample.disk_write_bytes),
        })
    }
}

fn collect_tree<'a>(
    root: ProcessIdentity,
    observed: &'a [ObservedProcess],
    by_pid: &HashMap<u32, &'a ObservedProcess>,
) -> Vec<&'a ObservedProcess> {
    let mut tree = Vec::new();
    for process in observed {
        let mut current = process;
        let mut visited = HashSet::new();
        loop {
            if current.identity == root {
                tree.push(process);
                break;
            }
            if !visited.insert(current.identity.pid) {
                break;
            }
            let Some(parent_pid) = current.parent_pid else {
                break;
            };
            let Some(parent) = by_pid.get(&parent_pid) else {
                break;
            };
            // A process cannot be a descendant of a parent created after it.
            if parent.identity.started_at_seconds > current.identity.started_at_seconds {
                break;
            }
            current = parent;
        }
    }
    tree
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(
        pid: u32,
        start: u64,
        parent: Option<u32>,
        cpu: f32,
        memory: u64,
    ) -> ObservedProcess {
        ObservedProcess {
            identity: ProcessIdentity {
                pid,
                started_at_seconds: start,
            },
            parent_pid: parent,
            name: format!("process-{pid}"),
            cpu_percent: cpu,
            cpu_time_millis: (pid as u64) * 10,
            resident_memory_bytes: memory,
            disk_read_bytes: Some((pid as u64) * 100),
            disk_write_bytes: Some((pid as u64) * 200),
        }
    }

    fn registration() -> MonitoredProcess {
        MonitoredProcess {
            id: "process-1".to_owned(),
            workspace_id: Some("workspace-1".to_owned()),
            session_id: Some("session-1".to_owned()),
            kind: "pi".to_owned(),
            root: ProcessIdentity {
                pid: 10,
                started_at_seconds: 100,
            },
            started_at_millis: 100_000,
        }
    }

    #[test]
    fn aggregates_descendants_and_rejects_pid_reuse() {
        let mut monitor = ResourceMonitor::new(4, 0, ResourcePressureConfig::default());
        monitor.register(registration());
        let first = monitor.observe(
            102_000,
            vec![
                process(10, 100, None, 20.0, 1_000),
                process(11, 101, Some(10), 30.0, 2_000),
                process(12, 102, Some(11), 10.0, 3_000),
                process(99, 90, None, 90.0, 9_000),
            ],
        );
        assert_eq!(first.published.len(), 1);
        let snapshot = &first.published[0];
        assert_eq!(snapshot.process_count, 3);
        assert_eq!(snapshot.cpu_percent, 60.0);
        assert_eq!(snapshot.resident_memory_bytes, 6_000);
        assert_eq!(snapshot.disk_read_bytes, Some(3_300));
        assert_eq!(snapshot.processes[1].name, "process-11");

        let reused = monitor.observe(104_000, vec![process(10, 103, None, 1.0, 10)]);
        assert_eq!(reused.completed.len(), 1);
        assert!(reused.published.is_empty());
        assert!(monitor.workspace_snapshots("workspace-1").is_empty());
    }

    #[test]
    fn bounds_history_throttles_publication_and_keeps_missing_io_unknown() {
        let mut monitor = ResourceMonitor::new(2, 4_000, ResourcePressureConfig::default());
        monitor.register(registration());
        for (index, timestamp) in [102_000, 104_000, 106_000].into_iter().enumerate() {
            let mut root = process(10, 100, None, index as f32, 1_000 + index as u64);
            root.disk_read_bytes = None;
            root.disk_write_bytes = None;
            let update = monitor.observe(timestamp, vec![root]);
            assert_eq!(update.published.len(), usize::from(index != 1));
        }
        let history = monitor.history("process-1").unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history.front().unwrap().sampled_at_millis, 104_000);
        assert_eq!(history.back().unwrap().disk_read_bytes, None);
    }

    #[test]
    fn warns_only_after_sustained_pressure_and_never_removes_the_process() {
        let mut monitor = ResourceMonitor::new(
            8,
            0,
            ResourcePressureConfig {
                cpu_percent: 50.0,
                resident_memory_bytes: 2_000,
                sustained_samples: 3,
            },
        );
        monitor.register(registration());
        for timestamp in [102_000, 104_000] {
            assert!(
                monitor
                    .observe(timestamp, vec![process(10, 100, None, 75.0, 3_000)])
                    .warnings
                    .is_empty()
            );
        }
        let warned = monitor.observe(106_000, vec![process(10, 100, None, 75.0, 3_000)]);
        assert_eq!(warned.warnings.len(), 2);
        assert_eq!(monitor.workspace_snapshots("workspace-1").len(), 1);
        assert!(
            monitor
                .observe(108_000, vec![process(10, 100, None, 75.0, 3_000)])
                .warnings
                .is_empty()
        );
    }

    #[test]
    fn sampler_fixture_covers_exit_and_summary_values() {
        struct FixtureSampler(VecDeque<Vec<ObservedProcess>>);
        impl ProcessSampler for FixtureSampler {
            fn sample(&mut self) -> Vec<ObservedProcess> {
                self.0.pop_front().unwrap_or_default()
            }
        }

        let mut sampler = FixtureSampler(VecDeque::from([
            vec![process(10, 100, None, 12.0, 4_096)],
            Vec::new(),
        ]));
        let mut monitor = ResourceMonitor::new(4, 0, ResourcePressureConfig::default());
        monitor.register(registration());
        monitor.sample(102_000, &mut sampler);
        let ended = monitor.sample(105_000, &mut sampler);
        assert_eq!(
            ended.completed,
            vec![ProcessResourceSummary {
                process_id: "process-1".to_owned(),
                ended_at_millis: 105_000,
                elapsed_millis: 5_000,
                peak_resident_memory_bytes: 4_096,
                cpu_time_millis: 100,
                peak_process_count: 1,
                disk_read_bytes: Some(1_000),
                disk_write_bytes: Some(2_000),
            }]
        );
        assert!(monitor.history("process-1").is_none());
    }

    #[test]
    fn unregister_stops_sampling_and_drops_history() {
        let mut monitor = ResourceMonitor::new(4, 0, ResourcePressureConfig::default());
        monitor.register(registration());
        monitor.observe(102_000, vec![process(10, 100, None, 12.0, 4_096)]);
        assert!(monitor.history("process-1").is_some());

        monitor.unregister("process-1");
        assert!(monitor.history("process-1").is_none());
        let update = monitor.observe(104_000, vec![process(10, 100, None, 12.0, 4_096)]);
        assert_eq!(update, ResourceMonitorUpdate::default());
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn platform_sampler_reports_this_process() {
        let mut sampler = SystemProcessSampler::default();
        let samples = sampler.sample();
        let current = std::process::id();
        let sample = samples
            .iter()
            .find(|sample| sample.identity.pid == current)
            .expect("current process is sampled");
        assert!(sample.identity.started_at_seconds > 0);
        assert!(sample.resident_memory_bytes > 0);
        assert!(!sample.name.is_empty());

        // The test process has arguments and an environment, so this fails if
        // the refresh kind starts reading them again.
        let this = sampler
            .system
            .process(sysinfo::Pid::from_u32(current))
            .expect("current process is kept");
        assert!(this.cmd().is_empty());
        assert!(this.environ().is_empty());
        assert!(this.cwd().is_none());
        assert!(this.exe().is_none());
    }
}
