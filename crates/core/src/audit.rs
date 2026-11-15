//! The mutation audit log: a redacted record of the processes, files, and
//! sandbox settings Pau changes.
//!
//! The audit log is separate from diagnostics. Diagnostics are off by
//! default, live in a bounded memory ring, and describe Pau's health. Audit
//! records are always kept, persist in the database up to
//! [`AUDIT_RETENTION`] records, and describe what changed, in which workspace
//! and session, at whose request, and with what result.
//!
//! Recording never changes the operation it describes. Callers record after
//! the operation has run, [`AuditLog::record`] neither blocks nor fails, and a
//! record that cannot be stored is dropped with a warning in the server log.
//! Records are written in the background, so a server that shuts down awaits
//! [`AuditLog::close`] last, after its final records are made.
//!
//! Records hold no file content, process arguments, environment, or sandbox
//! grants. The free-text fields are redacted before they are stored: see
//! [`AuditLog::record`].

use std::{fs, io::Write as _, path::Path, time::Duration};

use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::{mpsc, oneshot};
use ts_rs::TS;

use crate::{
    diagnostics::{REDACTED, Redactor},
    persistence::{AuditRepository, Result},
    workspace::is_sensitive,
};

/// Records the audit log keeps. Older records are dropped as new ones arrive.
pub const AUDIT_RETENTION: usize = 10_000;

/// Longest time [`AuditLog::close`] waits for queued records to be written.
///
/// A write takes milliseconds on a working disk. The limit only keeps a stuck
/// disk from holding up exit.
pub const AUDIT_CLOSE_LIMIT: Duration = Duration::from_secs(5);

/// Who asked for an audited change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AuditActor {
    /// A client of the local API, acting for the operator.
    Operator,
    /// Pau itself, such as stopping sessions when the server shuts down.
    Pau,
    /// Nobody: the process ended on its own.
    Process,
}

/// What an audited change did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AuditOperation {
    /// An agent session's process started.
    SessionStart,
    /// An agent session's process stopped.
    SessionStop,
    /// A terminal's process started.
    TerminalStart,
    /// A terminal's process stopped.
    TerminalStop,
    /// A workspace file was written.
    FileWrite,
    /// A transcript, diagnostic bundle, or audit log was exported to a file.
    FileExport,
    /// A workspace's default sandbox selection changed.
    SandboxUpdate,
}

/// How an audited change ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AuditResult {
    /// The change happened.
    Succeeded,
    /// Pau refused the request before changing anything, such as a write to
    /// a credential file or an invalid sandbox grant.
    Denied,
    /// The change was attempted and failed, or a process ended with an error.
    Failed,
    /// The request was abandoned before it finished, such as when the client
    /// disconnected. Work already done is not undone.
    Cancelled,
}

/// One audited change, as a caller describes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AuditEntry {
    /// Workspace the change applies to, when there is one.
    pub workspace_id: Option<String>,
    /// Agent session the change applies to, when there is one.
    pub session_id: Option<String>,
    /// Who asked for the change.
    pub actor: AuditActor,
    /// What the change did.
    pub operation: AuditOperation,
    /// How it ended.
    pub result: AuditResult,
    /// What was changed: an agent name, a terminal ID, a workspace-relative
    /// path, an export's file name, or a sandbox profile name.
    pub target: Option<String>,
    /// The API error code of a refused or failed request.
    pub reason: Option<String>,
    /// Exit code of a stopped process, when the platform reported one.
    pub exit_code: Option<i32>,
}

impl AuditEntry {
    /// An entry with no workspace, session, target, reason, or exit code.
    pub fn new(actor: AuditActor, operation: AuditOperation, result: AuditResult) -> Self {
        Self {
            workspace_id: None,
            session_id: None,
            actor,
            operation,
            result,
            target: None,
            reason: None,
            exit_code: None,
        }
    }
}

/// A stored, redacted audit entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AuditRecord {
    /// Increasing record number. Numbers are never reused.
    pub sequence: u64,
    /// RFC 3339 time the change was recorded.
    pub recorded_at: String,
    /// The change.
    #[serde(flatten)]
    #[ts(flatten)]
    pub entry: AuditEntry,
}

enum Command {
    Record(String, AuditEntry),
    List(oneshot::Sender<Result<Vec<AuditRecord>>>),
    Close(oneshot::Sender<()>),
}

/// Writes audit records in the order they are recorded.
///
/// One task owns the repository and handles records and reads in arrival
/// order, so a read sees every record made before it. The queue is unbounded
/// so that recording never waits. Each record comes from one API request or
/// one process exit, which limits how fast it can grow.
///
/// The default log discards every record, for routers built without a
/// database.
#[derive(Clone, Default)]
pub struct AuditLog {
    sender: Option<mpsc::UnboundedSender<Command>>,
    redactor: Redactor,
    /// How long [`AuditLog::close`] waits: [`AUDIT_CLOSE_LIMIT`] outside
    /// tests. The default log has no writer, so it never waits.
    close_limit: Duration,
}

impl std::fmt::Debug for AuditLog {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("AuditLog").finish_non_exhaustive()
    }
}

impl AuditLog {
    /// Starts the writer for `repository`, keeping [`AUDIT_RETENTION`]
    /// records and removing the values `redactor` knows.
    ///
    /// Must be called inside a Tokio runtime.
    pub fn new(repository: AuditRepository, redactor: Redactor) -> Self {
        Self::with_retention(repository, redactor, AUDIT_RETENTION)
    }

    /// Starts the writer like [`AuditLog::new`], keeping `retention` records.
    ///
    /// # Panics
    ///
    /// Panics when `retention` is zero.
    pub fn with_retention(
        repository: AuditRepository,
        redactor: Redactor,
        retention: usize,
    ) -> Self {
        assert!(retention > 0, "audit retention must be positive");
        let (sender, mut receiver) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Some(command) = receiver.recv().await {
                match command {
                    Command::Record(recorded_at, entry) => {
                        if let Err(error) = repository.insert(recorded_at, entry, retention).await {
                            tracing::warn!(
                                event = "audit.record_failed",
                                %error,
                                "could not store an audit record"
                            );
                        }
                    }
                    Command::List(reply) => {
                        let _ = reply.send(repository.list().await);
                    }
                    Command::Close(done) => {
                        let _ = done.send(());
                        break;
                    }
                }
            }
        });
        Self {
            sender: Some(sender),
            redactor,
            close_limit: AUDIT_CLOSE_LIMIT,
        }
    }

    /// Makes [`AuditLog::close`] wait at most `limit`, so a test can reach
    /// the limit on the real clock, which SQLite's thread runs on.
    #[cfg(test)]
    fn with_close_limit(mut self, limit: Duration) -> Self {
        self.close_limit = limit;
        self
    }

    /// Queues one entry, timestamped now, and returns without waiting.
    ///
    /// Every text field passes through the redactor. A target that names a
    /// credential file, such as `.env`, is replaced as a whole, as is any
    /// value that looks like an absolute path or a URL.
    pub fn record(&self, mut entry: AuditEntry) {
        let Some(sender) = &self.sender else {
            return;
        };
        let redact = |value: Option<String>| value.map(|value| self.redactor.redact(value));
        entry.target = entry.target.map(|target| {
            if is_sensitive(&target) {
                REDACTED.to_owned()
            } else {
                self.redactor.redact(target)
            }
        });
        entry.workspace_id = redact(entry.workspace_id);
        entry.session_id = redact(entry.session_id);
        entry.reason = redact(entry.reason);
        let recorded_at = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
        let _ = sender.send(Command::Record(recorded_at, entry));
    }

    /// Lists the retained records, oldest first, including every record made
    /// before this call.
    pub async fn list(&self) -> Result<Vec<AuditRecord>> {
        let Some(sender) = &self.sender else {
            return Ok(Vec::new());
        };
        let (reply, response) = oneshot::channel();
        sender
            .send(Command::List(reply))
            .map_err(|_| tokio_rusqlite::Error::ConnectionClosed)?;
        response
            .await
            .map_err(|_| tokio_rusqlite::Error::ConnectionClosed)?
    }

    /// Writes every record queued before this call, then stops the writer,
    /// waiting at most [`AUDIT_CLOSE_LIMIT`].
    ///
    /// Returns `false` when the limit passed first, in which case the records
    /// still queued are lost. Every clone shares the writer, so records made
    /// after the writer stops, through any clone, are discarded.
    pub async fn close(&self) -> bool {
        let Some(sender) = &self.sender else {
            return true;
        };
        let (done, closed) = oneshot::channel();
        if sender.send(Command::Close(done)).is_err() {
            return true;
        }
        match tokio::time::timeout(self.close_limit, closed).await {
            Ok(_) => true,
            Err(_) => {
                tracing::warn!(
                    event = "audit.close_timed_out",
                    limit_ms = self.close_limit.as_millis(),
                    "audit records were still being written when the limit passed"
                );
                false
            }
        }
    }

    /// Writes the retained records to a new JSON file at `path`, as an array
    /// of [`AuditRecord`] values. An existing file is never replaced.
    pub async fn export(&self, path: &Path) -> std::io::Result<()> {
        let records = self.list().await.map_err(std::io::Error::other)?;
        let bytes = serde_json::to_vec_pretty(&records).map_err(std::io::Error::other)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?
            .write_all(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::persistence::Database;

    const SECRET: &str = "sk-seeded-secret-0123456789";

    fn entry(target: &str) -> AuditEntry {
        AuditEntry {
            workspace_id: Some(format!("workspace-{SECRET}")),
            session_id: Some(format!("session-{SECRET}")),
            target: Some(target.to_owned()),
            reason: Some(format!("reason-{SECRET}")),
            ..AuditEntry::new(
                AuditActor::Operator,
                AuditOperation::FileWrite,
                AuditResult::Succeeded,
            )
        }
    }

    #[tokio::test]
    async fn keeps_records_in_order_up_to_the_retention_limit() {
        let database = Database::open(":memory:").await.unwrap();
        let log = AuditLog::with_retention(database.audit(), Redactor::default(), 3);
        for index in 0..5 {
            log.record(AuditEntry {
                exit_code: Some(index),
                ..AuditEntry::new(
                    AuditActor::Process,
                    AuditOperation::TerminalStop,
                    AuditResult::Succeeded,
                )
            });
        }

        let records = log.list().await.unwrap();
        let kept: Vec<_> = records
            .iter()
            .map(|record| (record.sequence, record.entry.exit_code))
            .collect();
        assert_eq!(kept, [(3, Some(2)), (4, Some(3)), (5, Some(4))]);
    }

    #[tokio::test]
    async fn removes_seeded_values_from_storage_and_exports() {
        let directory = tempdir().unwrap();
        let database_path = directory.path().join("pau.sqlite3");
        let database = Database::open(&database_path).await.unwrap();
        let redactor = Redactor::default();
        redactor.register(SECRET);
        let log = AuditLog::new(database.audit(), redactor);
        let targets = [
            format!("src/{SECRET}.rs"),
            format!("config/.env.{SECRET}"),
            format!("/Users/someone/{SECRET}"),
            format!("https://user:{SECRET}@example.com"),
            ".env".to_owned(),
        ];
        for target in &targets {
            log.record(entry(target));
        }

        let records = log.list().await.unwrap();
        let stored: Vec<_> = records
            .iter()
            .map(|record| record.entry.target.as_deref().unwrap())
            .collect();
        assert_eq!(
            stored,
            [
                "src/[REDACTED].rs",
                "[REDACTED]",
                "[REDACTED]",
                "[REDACTED]",
                "[REDACTED]"
            ]
        );
        let export = directory.path().join("audit.json");
        log.export(&export).await.unwrap();
        assert!(log.export(&export).await.is_err(), "export replaced a file");
        drop(log);
        drop(database);

        let exported = fs::read_to_string(&export).unwrap();
        let exported: Vec<AuditRecord> = serde_json::from_str(&exported).unwrap();
        assert_eq!(exported, records);
        for entry in fs::read_dir(directory.path()).unwrap() {
            let bytes = fs::read(entry.unwrap().path()).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(SECRET), "a seeded value reached a file");
            assert!(!text.contains("someone"), "a home path reached a file");
        }
    }

    fn stop(exit_code: i32) -> AuditEntry {
        AuditEntry {
            exit_code: Some(exit_code),
            ..AuditEntry::new(
                AuditActor::Pau,
                AuditOperation::SessionStop,
                AuditResult::Succeeded,
            )
        }
    }

    #[test]
    fn close_writes_every_queued_record_before_the_runtime_ends() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("pau.sqlite3");
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let database = Database::open(&path).await.unwrap();
            let log = AuditLog::new(database.audit(), Redactor::default());
            for index in 0..200 {
                log.record(stop(index));
            }
            assert!(log.close().await);
            log.record(stop(200));
        });
        // The server binary drops its runtime right after shutdown, which
        // cancels the writer.
        drop(runtime);

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let stored = runtime.block_on(async {
            let database = Database::open(&path).await.unwrap();
            database.audit().list().await.unwrap()
        });
        let exit_codes: Vec<_> = stored
            .iter()
            .map(|record| record.entry.exit_code.unwrap())
            .collect();
        assert_eq!(exit_codes, (0..200).collect::<Vec<_>>());
    }

    /// Runs on the real clock: SQLite's thread does, so a paused clock would
    /// reach the limit while a healthy insert was still running.
    #[tokio::test]
    async fn close_gives_up_on_a_stuck_disk_after_the_limit() {
        let limit = Duration::from_millis(300);
        let directory = tempdir().unwrap();
        let path = directory.path().join("pau.sqlite3");
        let database = Database::open(&path).await.unwrap();

        // On a working disk, Close replies well before the limit.
        let healthy = AuditLog::new(database.audit(), Redactor::default()).with_close_limit(limit);
        healthy.record(stop(0));
        let started = std::time::Instant::now();
        assert!(healthy.close().await);
        assert!(started.elapsed() < limit);

        // Another connection holds the write lock, so the insert waits on
        // SQLite's five-second busy timeout and Close cannot reply in time.
        let stuck = AuditLog::new(database.audit(), Redactor::default()).with_close_limit(limit);
        let blocker = tokio_rusqlite::rusqlite::Connection::open(&path).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        stuck.record(stop(1));
        let started = std::time::Instant::now();
        assert!(!stuck.close().await);
        let elapsed = started.elapsed();
        assert!(elapsed >= limit, "returned after {elapsed:?}");
        assert!(
            elapsed < Duration::from_secs(4),
            "returned after {elapsed:?}"
        );
        blocker.execute_batch("ROLLBACK").unwrap();
    }

    #[tokio::test]
    async fn the_default_log_keeps_nothing() {
        let log = AuditLog::default();
        log.record(entry("README.md"));
        assert!(log.list().await.unwrap().is_empty());
    }
}
