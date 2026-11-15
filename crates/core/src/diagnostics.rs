//! Bounded, redacted diagnostics shared by Pau subsystems.
//!
//! Diagnostic data is sanitized before it enters the in-memory ring. The ring
//! therefore never depends on export-time redaction for confidentiality.

use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs,
    io::{self, Write},
    path::Path,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

const DEFAULT_RECORD_CAPACITY: usize = 1_024;
const MAX_PAYLOAD_TRACE_DURATION: Duration = Duration::from_secs(15 * 60);
pub(crate) const REDACTED: &str = "[REDACTED]";

/// Severity threshold for diagnostic records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum DiagnosticLevel {
    /// Detailed records used during focused investigation.
    Debug,
    /// Normal lifecycle and state records.
    Info,
    /// Recoverable pressure, gaps, or degraded behavior.
    Warn,
    /// Failed operations.
    Error,
}

/// Release-safe settings controlled by the operator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiagnosticSettings {
    /// Whether collection and the diagnostics view are enabled.
    pub enabled: bool,
    /// Lowest severity retained in the record ring.
    pub min_level: DiagnosticLevel,
    /// Whether temporary payload-shape tracing is active.
    pub payload_tracing: bool,
    /// Unix timestamp at which payload tracing stops.
    pub payload_tracing_expires_at: Option<u64>,
}

impl Default for DiagnosticSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            min_level: DiagnosticLevel::Info,
            payload_tracing: false,
            payload_tracing_expires_at: None,
        }
    }
}

/// One adapter's reported protocol compatibility.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdapterDiagnostic {
    /// Adapter name shown to the operator.
    pub name: String,
    /// Adapter or package version when discovered.
    pub version: Option<String>,
    /// Result of the latest protocol handshake.
    pub handshake: String,
    /// Capability names reported by the adapter.
    pub capabilities: Vec<String>,
}

/// Current transport and replay state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TransportDiagnostic {
    /// Transport name, such as `websocket` or `pi_rpc`.
    pub name: String,
    /// Current state.
    pub state: String,
    /// Number of reconnect attempts.
    pub reconnects: u64,
    /// Latest observed event sequence.
    pub last_sequence: Option<u64>,
    /// Number of replay gaps.
    pub replay_gaps: u64,
    /// Current queue depth.
    pub queue_depth: u64,
    /// Number of updates dropped before delivery.
    pub dropped_updates: u64,
}

/// A sanitized record retained by diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiagnosticRecord {
    /// RFC 3339 timestamp assigned by the producing subsystem.
    pub timestamp: String,
    /// Component that produced the record.
    pub component: String,
    /// Record severity.
    pub level: DiagnosticLevel,
    /// Stable operation name. It must not contain user content.
    pub operation: String,
    /// Stable process identifier, when applicable.
    pub process_id: Option<String>,
    /// Stable session identifier, when applicable.
    pub session_id: Option<String>,
    /// Safe metadata selected from an allowlist.
    pub metadata: BTreeMap<String, String>,
    /// Whether this is a temporary protocol payload-shape trace.
    pub payload_trace: bool,
}

/// Input accepted from a diagnostic producer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticRecordInput {
    /// RFC 3339 timestamp assigned by the producing subsystem.
    pub timestamp: String,
    /// Component that produced the record.
    pub component: String,
    /// Record severity.
    pub level: DiagnosticLevel,
    /// Stable operation name.
    pub operation: String,
    /// Stable process identifier, when applicable.
    pub process_id: Option<String>,
    /// Stable session identifier, when applicable.
    pub session_id: Option<String>,
    /// Candidate metadata. Unknown and sensitive fields are omitted.
    pub metadata: BTreeMap<String, String>,
}

/// Redacted snapshot used by the diagnostics view and export preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiagnosticBundle {
    /// Schema version for support tooling.
    pub schema_version: u32,
    /// Frontend build version.
    pub frontend_version: String,
    /// Backend build version.
    pub backend_version: String,
    /// Relevant dependency versions.
    pub dependencies: BTreeMap<String, String>,
    /// Adapter versions, handshakes, and capabilities.
    pub adapters: Vec<AdapterDiagnostic>,
    /// Transport and replay state.
    pub transports: Vec<TransportDiagnostic>,
    /// Current release-safe settings.
    pub settings: DiagnosticSettings,
    /// Recent sanitized records.
    pub records: Vec<DiagnosticRecord>,
    /// Records discarded because the ring reached its limit.
    pub dropped_records: u64,
    /// Revision that must match when this preview is exported.
    pub revision: u64,
}

/// Removes secrets from free text before it is retained anywhere.
///
/// It replaces every registered value, such as the API token, with
/// `[REDACTED]`, and replaces the whole value when it looks like an absolute
/// path or a URL, which can name a user or carry credentials. The result is
/// then cut to 256 bytes. Replacing before cutting keeps a registered value
/// that crosses the cut from leaving its first bytes behind. Clones share one
/// set of registered values.
#[derive(Clone, Debug, Default)]
pub struct Redactor(Arc<RwLock<HashSet<String>>>);

impl Redactor {
    /// Registers a value that every later [`Redactor::redact`] removes.
    pub fn register(&self, value: impl Into<String>) {
        let value = value.into();
        if value.is_empty() {
            return;
        }
        self.0
            .write()
            .expect("redactor lock poisoned")
            .insert(value);
    }

    /// Returns `value` with registered values, paths, and URLs removed.
    pub fn redact(&self, value: impl Into<String>) -> String {
        let mut value = value.into();
        for sensitive in self.0.read().expect("redactor lock poisoned").iter() {
            if value.contains(sensitive.as_str()) {
                value = value.replace(sensitive.as_str(), REDACTED);
            }
        }
        if value.contains("://") || value.starts_with('/') || value.starts_with('~') {
            return REDACTED.to_owned();
        }
        value.truncate(value.floor_char_boundary(256));
        value
    }
}

#[derive(Debug)]
struct DiagnosticState {
    settings: DiagnosticSettings,
    records: VecDeque<DiagnosticRecord>,
    dropped_records: u64,
    revision: u64,
    adapters: BTreeMap<String, AdapterDiagnostic>,
    transports: BTreeMap<String, TransportDiagnostic>,
    trace_deadline: Option<SystemTime>,
}

/// Thread-safe diagnostics collector with bounded retention.
#[derive(Clone, Debug)]
pub struct Diagnostics {
    frontend_version: String,
    backend_version: String,
    dependencies: BTreeMap<String, String>,
    capacity: usize,
    redactor: Redactor,
    state: Arc<Mutex<DiagnosticState>>,
}

impl Diagnostics {
    /// Creates a collector with the default retention limit.
    pub fn new(
        frontend_version: impl Into<String>,
        backend_version: impl Into<String>,
        dependencies: BTreeMap<String, String>,
    ) -> Self {
        Self::with_capacity(
            frontend_version,
            backend_version,
            dependencies,
            DEFAULT_RECORD_CAPACITY,
        )
    }

    /// Creates a collector with an explicit retention limit.
    pub fn with_capacity(
        frontend_version: impl Into<String>,
        backend_version: impl Into<String>,
        dependencies: BTreeMap<String, String>,
        capacity: usize,
    ) -> Self {
        assert!(capacity > 0, "diagnostic capacity must be positive");
        Self {
            frontend_version: frontend_version.into(),
            backend_version: backend_version.into(),
            dependencies,
            capacity,
            redactor: Redactor::default(),
            state: Arc::new(Mutex::new(DiagnosticState {
                settings: DiagnosticSettings::default(),
                records: VecDeque::with_capacity(capacity),
                dropped_records: 0,
                revision: 0,
                adapters: BTreeMap::new(),
                transports: BTreeMap::new(),
                trace_deadline: None,
            })),
        }
    }

    /// Enables or disables collection without changing application behavior.
    pub fn set_enabled(&self, enabled: bool) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        state.settings.enabled = enabled;
        if !enabled {
            state.trace_deadline = None;
            state.settings.payload_tracing = false;
            state.settings.payload_tracing_expires_at = None;
        }
        state.revision = state.revision.saturating_add(1);
    }

    /// Changes the runtime retention threshold.
    pub fn set_min_level(&self, level: DiagnosticLevel) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        state.settings.min_level = level;
        state.revision = state.revision.saturating_add(1);
    }

    /// Registers a value that must be removed before any later record enters the ring.
    pub fn register_sensitive_value(&self, value: impl Into<String>) {
        self.redactor.register(value);
    }

    /// The redactor these diagnostics apply, shared with other stores that
    /// must remove the same values.
    pub fn redactor(&self) -> Redactor {
        self.redactor.clone()
    }

    /// Starts temporary payload-shape tracing for at most fifteen minutes.
    pub fn enable_payload_tracing(&self, duration: Duration, now: SystemTime) -> io::Result<()> {
        if duration.is_zero() || duration > MAX_PAYLOAD_TRACE_DURATION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "payload tracing duration must be between 1 and 900 seconds",
            ));
        }
        let deadline = now + duration;
        let expires_at = deadline
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_secs();
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        if !state.settings.enabled {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "diagnostics must be enabled before payload tracing",
            ));
        }
        state.trace_deadline = Some(deadline);
        state.settings.payload_tracing = true;
        state.settings.payload_tracing_expires_at = Some(expires_at);
        state.revision = state.revision.saturating_add(1);
        Ok(())
    }

    /// Records safe structured metadata after filtering unknown fields and values.
    pub fn record(&self, input: DiagnosticRecordInput) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        expire_trace(&mut state, SystemTime::now());
        if !state.settings.enabled || input.level < state.settings.min_level {
            return;
        }
        let record = sanitize_record(input, &self.redactor, false);
        push_record(&mut state, self.capacity, record);
    }

    /// Records only the safe shape of a protocol payload while tracing is active.
    pub fn trace_payload(
        &self,
        mut input: DiagnosticRecordInput,
        payload: &Value,
        now: SystemTime,
    ) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        expire_trace(&mut state, now);
        if !state.settings.enabled || !state.settings.payload_tracing {
            return;
        }
        let mut metadata = BTreeMap::new();
        metadata.insert("payload_shape".to_owned(), payload_shape(payload));
        input.level = DiagnosticLevel::Debug;
        input.metadata = metadata;
        let record = sanitize_record(input, &self.redactor, true);
        push_record(&mut state, self.capacity, record);
    }

    /// Replaces one adapter's version, handshake, and capability report.
    pub fn update_adapter(&self, mut adapter: AdapterDiagnostic) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        if !state.settings.enabled {
            return;
        }
        adapter.name = identifier(adapter.name);
        adapter.version = adapter.version.map(|value| self.redactor.redact(value));
        adapter.handshake = identifier(adapter.handshake);
        adapter.capabilities = adapter.capabilities.into_iter().map(identifier).collect();
        adapter.capabilities.sort();
        adapter.capabilities.dedup();
        state.adapters.insert(adapter.name.clone(), adapter);
        state.revision = state.revision.saturating_add(1);
    }

    /// Replaces one transport's state and pressure counters.
    pub fn update_transport(&self, mut transport: TransportDiagnostic) {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        if !state.settings.enabled {
            return;
        }
        transport.name = identifier(transport.name);
        transport.state = identifier(transport.state);
        state.transports.insert(transport.name.clone(), transport);
        state.revision = state.revision.saturating_add(1);
    }

    /// Returns a redacted, user-reviewable snapshot.
    pub fn snapshot(&self, now: SystemTime) -> DiagnosticBundle {
        let mut state = self.state.lock().expect("diagnostics lock poisoned");
        expire_trace(&mut state, now);
        DiagnosticBundle {
            schema_version: 1,
            frontend_version: self.frontend_version.clone(),
            backend_version: self.backend_version.clone(),
            dependencies: self.dependencies.clone(),
            adapters: state.adapters.values().cloned().collect(),
            transports: state.transports.values().cloned().collect(),
            settings: state.settings.clone(),
            records: state.records.iter().cloned().collect(),
            dropped_records: state.dropped_records,
            revision: state.revision,
        }
    }

    /// Writes exactly the reviewed revision to a new diagnostic bundle.
    pub fn export_reviewed(
        &self,
        path: impl AsRef<Path>,
        reviewed_revision: u64,
        now: SystemTime,
    ) -> io::Result<()> {
        let bundle = self.snapshot(now);
        if bundle.revision != reviewed_revision {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "diagnostics changed after the export preview was reviewed",
            ));
        }
        let bytes = serde_json::to_vec_pretty(&bundle).map_err(io::Error::other)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        file.write_all(&bytes)
    }
}

fn push_record(state: &mut DiagnosticState, capacity: usize, record: DiagnosticRecord) {
    if state.records.len() == capacity {
        state.records.pop_front();
        state.dropped_records = state.dropped_records.saturating_add(1);
    }
    state.records.push_back(record);
    state.revision = state.revision.saturating_add(1);
}

fn expire_trace(state: &mut DiagnosticState, now: SystemTime) {
    if state.trace_deadline.is_some_and(|deadline| now >= deadline) {
        state.trace_deadline = None;
        state.settings.payload_tracing = false;
        state.settings.payload_tracing_expires_at = None;
        state.revision = state.revision.saturating_add(1);
    }
}

fn sanitize_record(
    input: DiagnosticRecordInput,
    redactor: &Redactor,
    payload_trace: bool,
) -> DiagnosticRecord {
    let metadata = input
        .metadata
        .into_iter()
        .filter(|(key, _)| safe_metadata_key(key))
        .map(|(key, value)| (key, redactor.redact(value)))
        .collect();
    DiagnosticRecord {
        timestamp: redactor.redact(input.timestamp),
        component: identifier(input.component),
        level: input.level,
        operation: identifier(input.operation),
        process_id: input.process_id.map(identifier),
        session_id: input.session_id.map(identifier),
        metadata,
        payload_trace,
    }
}

fn safe_metadata_key(key: &str) -> bool {
    matches!(
        key,
        "adapter_version"
            | "backend_version"
            | "capability"
            | "count"
            | "dependency_version"
            | "dropped_count"
            | "duration_ms"
            | "error_class"
            | "exit_code"
            | "frontend_version"
            | "handshake"
            | "payload_shape"
            | "pid"
            | "process_count"
            | "queue_capacity"
            | "queue_depth"
            | "reason_code"
            | "reconnect_count"
            | "replay_gap"
            | "sequence"
            | "state"
            | "transport"
    )
}

fn identifier(value: String) -> String {
    let filtered: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || "._:-".contains(*character))
        .take(96)
        .collect();
    if filtered.is_empty() {
        "unknown".to_owned()
    } else {
        filtered
    }
}

fn payload_shape(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(_) => "boolean".to_owned(),
        Value::Number(_) => "number".to_owned(),
        Value::String(_) => "string".to_owned(),
        Value::Array(values) => format!("array[{}]", values.len()),
        Value::Object(values) => {
            let safe_keys = values
                .keys()
                .filter(|key| safe_metadata_key(key))
                .take(16)
                .cloned()
                .collect::<Vec<_>>();
            format!("object{{{}}}", safe_keys.join(","))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, thread};

    use tempfile::tempdir;

    use super::*;

    fn input(index: usize) -> DiagnosticRecordInput {
        DiagnosticRecordInput {
            timestamp: "2026-04-01T12:00:00Z".to_owned(),
            component: "pau-server".to_owned(),
            level: DiagnosticLevel::Info,
            operation: format!("event.received.{index}"),
            process_id: Some("process-1".to_owned()),
            session_id: Some("session-1".to_owned()),
            metadata: BTreeMap::from([("sequence".to_owned(), index.to_string())]),
        }
    }

    #[test]
    fn redacts_registered_values_at_every_offset_around_the_cut() {
        let token = "pau-secret-token-0123456789abcdef";
        let redactor = Redactor::default();
        redactor.register(token);
        // Offsets put the token wholly before the cut, ending at it,
        // straddling it, starting at it, and past it.
        for offset in [0, 200, 256 - token.len(), 240, 250, 255, 256, 300] {
            let value = format!("{}{token}{}", "a".repeat(offset), "b".repeat(64));
            let redacted = redactor.redact(value);
            assert!(redacted.len() <= 256, "offset {offset}");
            for end in 4..=token.len() {
                assert!(
                    !redacted.contains(&token[..end]),
                    "offset {offset} kept {:?}",
                    &token[..end]
                );
            }
        }
    }

    #[test]
    fn bounds_retention_under_concurrent_writers() {
        let diagnostics = Arc::new(Diagnostics::with_capacity(
            "0.1.0",
            "0.1.0",
            BTreeMap::new(),
            8,
        ));
        diagnostics.set_enabled(true);
        let writers: Vec<_> = (0..4)
            .map(|writer| {
                let diagnostics = Arc::clone(&diagnostics);
                thread::spawn(move || {
                    for index in 0..16 {
                        diagnostics.record(input(writer * 16 + index));
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }

        let bundle = diagnostics.snapshot(SystemTime::now());
        assert_eq!(bundle.records.len(), 8);
        assert_eq!(bundle.dropped_records, 56);
    }

    #[test]
    fn applies_runtime_levels_and_temporary_payload_tracing() {
        let diagnostics = Diagnostics::new("0.1.0", "0.1.0", BTreeMap::new());
        diagnostics.set_enabled(true);
        diagnostics.set_min_level(DiagnosticLevel::Warn);
        diagnostics.record(input(1));
        assert!(diagnostics.snapshot(SystemTime::now()).records.is_empty());

        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100);
        diagnostics
            .enable_payload_tracing(Duration::from_secs(2), now)
            .unwrap();
        diagnostics.trace_payload(
            DiagnosticRecordInput {
                timestamp: "2026-04-01T12:00:00Z".to_owned(),
                component: "pau-pi".to_owned(),
                level: DiagnosticLevel::Debug,
                operation: "protocol.payload".to_owned(),
                process_id: None,
                session_id: Some("session-1".to_owned()),
                metadata: BTreeMap::new(),
            },
            &serde_json::json!({"sequence": 9, "prompt": "do not retain"}),
            now,
        );
        let active = diagnostics.snapshot(now);
        assert!(active.settings.payload_tracing);
        assert_eq!(
            active.records[0].metadata["payload_shape"],
            "object{sequence}"
        );
        let expired = diagnostics.snapshot(now + Duration::from_secs(3));
        assert!(!expired.settings.payload_tracing);
    }

    #[test]
    fn removes_every_sensitive_field_class_before_retention_and_export() {
        let diagnostics = Diagnostics::new("frontend", "backend", BTreeMap::new());
        diagnostics.set_enabled(true);
        diagnostics.register_sensitive_value("registered-secret");
        diagnostics.record(DiagnosticRecordInput {
            timestamp: "2026-04-01T12:00:00Z".to_owned(),
            component: "adapter".to_owned(),
            level: DiagnosticLevel::Error,
            operation: "request.failed".to_owned(),
            process_id: Some("process-1".to_owned()),
            session_id: Some("session-1".to_owned()),
            metadata: BTreeMap::from([
                ("credential".to_owned(), "registered-secret".to_owned()),
                ("environment".to_owned(), "PRIVATE=value".to_owned()),
                ("prompt".to_owned(), "rewrite this".to_owned()),
                ("file_content".to_owned(), "private source".to_owned()),
                (
                    "tool_arguments".to_owned(),
                    "--token registered-secret".to_owned(),
                ),
                ("transcript".to_owned(), "private answer".to_owned()),
                ("path".to_owned(), "/home/operator/private".to_owned()),
                (
                    "url".to_owned(),
                    "https://user:pass@example.test/?token=secret".to_owned(),
                ),
                ("error_class".to_owned(), "registered-secret".to_owned()),
            ]),
        });

        let directory = tempdir().unwrap();
        let preview = diagnostics.snapshot(SystemTime::now());
        let path = directory.path().join("diagnostics.json");
        diagnostics
            .export_reviewed(&path, preview.revision, SystemTime::now())
            .unwrap();
        let serialized = fs::read_to_string(path).unwrap();
        for secret in [
            "registered-secret",
            "PRIVATE=value",
            "rewrite this",
            "private source",
            "private answer",
            "/home/operator/private",
            "user:pass",
            "token=secret",
        ] {
            assert!(!serialized.contains(secret), "bundle contained {secret}");
        }
        assert!(serialized.contains(REDACTED));
    }

    #[test]
    fn requires_export_to_match_the_reviewed_revision_and_reports_write_failures() {
        let diagnostics = Diagnostics::new("frontend", "backend", BTreeMap::new());
        diagnostics.set_enabled(true);
        let preview = diagnostics.snapshot(SystemTime::now());
        diagnostics.record(input(1));
        let error = diagnostics
            .export_reviewed("ignored.json", preview.revision, SystemTime::now())
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);

        let current = diagnostics.snapshot(SystemTime::now());
        let directory = tempdir().unwrap();
        let error = diagnostics
            .export_reviewed(directory.path(), current.revision, SystemTime::now())
            .unwrap_err();
        assert!(matches!(
            error.kind(),
            io::ErrorKind::AlreadyExists
                | io::ErrorKind::IsADirectory
                | io::ErrorKind::PermissionDenied
        ));
    }

    #[test]
    fn correlates_adapters_transports_processes_and_sessions_without_content() {
        let diagnostics = Diagnostics::new(
            "0.1.0",
            "0.1.0",
            BTreeMap::from([("axum".to_owned(), "0.8.8".to_owned())]),
        );
        diagnostics.set_enabled(true);
        diagnostics.update_adapter(AdapterDiagnostic {
            name: "Pi".to_owned(),
            version: Some("0.52.0".to_owned()),
            handshake: "ready".to_owned(),
            capabilities: vec!["prompt".to_owned(), "interrupt".to_owned()],
        });
        diagnostics.update_transport(TransportDiagnostic {
            name: "websocket".to_owned(),
            state: "connected".to_owned(),
            reconnects: 2,
            last_sequence: Some(42),
            replay_gaps: 1,
            queue_depth: 12,
            dropped_updates: 3,
        });
        diagnostics.record(input(42));

        let bundle = diagnostics.snapshot(SystemTime::now());
        assert_eq!(bundle.dependencies["axum"], "0.8.8");
        assert_eq!(bundle.adapters[0].handshake, "ready");
        assert_eq!(bundle.transports[0].dropped_updates, 3);
        assert_eq!(bundle.records[0].process_id.as_deref(), Some("process-1"));
        assert_eq!(bundle.records[0].session_id.as_deref(), Some("session-1"));
    }
}
