//! SQLite persistence for application-owned state.
//!
//! Native agent session files are intentionally outside this database and are
//! never read, changed, or removed by these repositories.

use std::{path::Path, time::Duration};

use serde::{Deserialize, Serialize};
use tokio_rusqlite::{Connection, OptionalExtension, params, rusqlite};
use ts_rs::TS;

use crate::resource_monitor::ProcessResourceSummary;
use crate::sandbox::{SandboxSelection, SandboxSelectionState};

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_workspaces_and_settings.sql"),
    include_str!("../migrations/0002_process_metadata.sql"),
    include_str!("../migrations/0003_mcp_enablement.sql"),
    include_str!("../migrations/0004_process_resource_summaries.sql"),
    include_str!("../migrations/0005_sandbox.sql"),
];

/// Result returned by persistence operations.
pub type Result<T> = tokio_rusqlite::Result<T>;

/// One application database backed by one serialized SQLite connection.
///
/// Repository handles clone the asynchronous handle, but all work remains
/// queued on the same `tokio-rusqlite` connection thread.
#[derive(Clone)]
pub struct Database {
    connection: Connection,
}

impl Database {
    /// Opens a database, configures the connection, and applies pending
    /// migrations.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).await?;
        connection
            .call(|connection| {
                connection.pragma_update(None, "foreign_keys", true)?;
                connection.pragma_update(None, "journal_mode", "WAL")?;
                connection.busy_timeout(BUSY_TIMEOUT)?;
                apply_migrations(connection)
            })
            .await?;

        Ok(Self { connection })
    }

    /// Returns a repository for remembered workspaces.
    pub fn workspaces(&self) -> WorkspaceRepository {
        WorkspaceRepository::new(self.connection.clone())
    }

    /// Returns a repository for application settings.
    pub fn settings(&self) -> ApplicationSettingsRepository {
        ApplicationSettingsRepository::new(self.connection.clone())
    }

    /// Returns a repository for Pau-managed MCP enablement.
    pub fn mcp_enablement(&self) -> McpEnablementRepository {
        McpEnablementRepository::new(self.connection.clone())
    }

    /// Returns a repository for sandbox selections.
    pub fn sandbox_selection(&self) -> SandboxSelectionRepository {
        SandboxSelectionRepository::new(self.connection.clone())
    }

    /// Returns a repository for persisted process metadata.
    pub fn processes(&self) -> ProcessMetadataRepository {
        ProcessMetadataRepository::new(self.connection.clone())
    }

    /// Returns a repository for completed process resource summaries.
    pub fn process_resource_summaries(&self) -> ProcessResourceSummaryRepository {
        ProcessResourceSummaryRepository::new(self.connection.clone())
    }
}

fn apply_migrations(connection: &mut rusqlite::Connection) -> rusqlite::Result<()> {
    let current_version: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let current_version = usize::try_from(current_version)
        .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, current_version))?;

    if current_version > MIGRATIONS.len() {
        return Err(rusqlite::Error::InvalidQuery);
    }

    for (index, migration) in MIGRATIONS.iter().enumerate().skip(current_version) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", (index + 1) as i64)?;
        transaction.commit()?;
    }

    Ok(())
}

/// A remembered local directory or Git worktree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Workspace {
    /// Stable application identifier.
    pub id: String,
    /// Canonical workspace path encoded for storage.
    pub path: String,
    /// Optional display name chosen by the operator.
    pub name: Option<String>,
    /// RFC 3339 creation timestamp.
    pub created_at: String,
    /// RFC 3339 timestamp of the latest update.
    pub updated_at: String,
}

/// Access to remembered workspaces.
#[derive(Clone)]
pub struct WorkspaceRepository {
    connection: Connection,
}

impl WorkspaceRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Inserts a workspace or replaces its mutable fields.
    pub async fn upsert(&self, workspace: Workspace) -> Result<()> {
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO workspaces (id, path, name, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET
                       path = excluded.path,
                       name = excluded.name,
                       updated_at = excluded.updated_at",
                    params![
                        workspace.id,
                        workspace.path,
                        workspace.name,
                        workspace.created_at,
                        workspace.updated_at
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Finds a workspace by its stable identifier.
    pub async fn get(&self, id: &str) -> Result<Option<Workspace>> {
        let id = id.to_owned();
        self.connection
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT id, path, name, created_at, updated_at
                         FROM workspaces WHERE id = ?1",
                        [id],
                        workspace_from_row,
                    )
                    .optional()
            })
            .await
    }

    /// Finds a workspace by its canonical path.
    pub async fn get_by_path(&self, path: &str) -> Result<Option<Workspace>> {
        let path = path.to_owned();
        self.connection
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT id, path, name, created_at, updated_at
                         FROM workspaces WHERE path = ?1",
                        [path],
                        workspace_from_row,
                    )
                    .optional()
            })
            .await
    }

    /// Lists workspaces in stable path order.
    pub async fn list(&self) -> Result<Vec<Workspace>> {
        self.connection
            .call(|connection| {
                let mut statement = connection.prepare(
                    "SELECT id, path, name, created_at, updated_at
                     FROM workspaces ORDER BY path",
                )?;
                statement.query_map([], workspace_from_row)?.collect()
            })
            .await
    }

    /// Removes a workspace registration without touching its directory.
    pub async fn remove(&self, id: &str) -> Result<bool> {
        let id = id.to_owned();
        self.connection
            .call(move |connection| {
                Ok(connection.execute("DELETE FROM workspaces WHERE id = ?1", [id])? > 0)
            })
            .await
    }
}

fn workspace_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// One persisted application setting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationSetting {
    /// Stable setting name.
    pub key: String,
    /// Serialized setting value.
    pub value: String,
    /// RFC 3339 timestamp of the latest update.
    pub updated_at: String,
}

/// Access to application settings.
#[derive(Clone)]
pub struct ApplicationSettingsRepository {
    connection: Connection,
}

impl ApplicationSettingsRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Inserts or replaces a setting.
    pub async fn set(&self, setting: ApplicationSetting) -> Result<()> {
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO application_settings (key, value, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET
                       value = excluded.value,
                       updated_at = excluded.updated_at",
                    params![setting.key, setting.value, setting.updated_at],
                )?;
                Ok(())
            })
            .await
    }

    /// Finds a setting by key.
    pub async fn get(&self, key: &str) -> Result<Option<ApplicationSetting>> {
        let key = key.to_owned();
        self.connection
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT key, value, updated_at
                         FROM application_settings WHERE key = ?1",
                        [key],
                        |row| {
                            Ok(ApplicationSetting {
                                key: row.get(0)?,
                                value: row.get(1)?,
                                updated_at: row.get(2)?,
                            })
                        },
                    )
                    .optional()
            })
            .await
    }

    /// Removes a setting.
    pub async fn remove(&self, key: &str) -> Result<bool> {
        let key = key.to_owned();
        self.connection
            .call(move |connection| {
                Ok(
                    connection.execute("DELETE FROM application_settings WHERE key = ?1", [key])?
                        > 0,
                )
            })
            .await
    }
}

/// Pau-managed MCP selection for a workspace and optional session override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct McpEnablement {
    /// Workspace default. Missing persisted state is always `false`.
    pub workspace_default: bool,
    /// Session-specific choice, when one has been recorded.
    pub session_override: Option<bool>,
}

impl McpEnablement {
    /// Returns the session override or the workspace default.
    pub fn effective(self) -> bool {
        self.session_override.unwrap_or(self.workspace_default)
    }
}

/// Persistence for Pau-managed MCP selection.
#[derive(Clone)]
pub struct McpEnablementRepository {
    connection: Connection,
}

impl McpEnablementRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Reads enablement without changing native agent configuration.
    pub async fn get(&self, workspace_id: &str, session_id: Option<&str>) -> Result<McpEnablement> {
        let workspace_id = workspace_id.to_owned();
        let session_id = session_id.map(str::to_owned);
        self.connection
            .call(move |connection| {
                let workspace_default = connection
                    .query_row(
                        "SELECT enabled FROM workspace_mcp_enablement WHERE workspace_id = ?1",
                        [&workspace_id],
                        |row| row.get(0),
                    )
                    .optional()?
                    .unwrap_or(false);
                let session_override = match session_id {
                    Some(session_id) => connection
                        .query_row(
                            "SELECT enabled FROM session_mcp_enablement
                             WHERE session_id = ?1 AND workspace_id = ?2",
                            params![session_id, workspace_id],
                            |row| row.get(0),
                        )
                        .optional()?,
                    None => None,
                };
                Ok(McpEnablement {
                    workspace_default,
                    session_override,
                })
            })
            .await
    }

    /// Sets the workspace default after explicit operator enablement or disablement.
    pub async fn set_workspace_default(
        &self,
        workspace_id: &str,
        enabled: bool,
        updated_at: &str,
    ) -> Result<()> {
        let workspace_id = workspace_id.to_owned();
        let updated_at = updated_at.to_owned();
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO workspace_mcp_enablement (workspace_id, enabled, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(workspace_id) DO UPDATE SET
                       enabled = excluded.enabled,
                       updated_at = excluded.updated_at",
                    params![workspace_id, enabled, updated_at],
                )?;
                Ok(())
            })
            .await
    }

    /// Sets one session override without changing the workspace default.
    pub async fn set_session_override(
        &self,
        workspace_id: &str,
        session_id: &str,
        enabled: bool,
        updated_at: &str,
    ) -> Result<()> {
        let workspace_id = workspace_id.to_owned();
        let session_id = session_id.to_owned();
        let updated_at = updated_at.to_owned();
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO session_mcp_enablement
                       (session_id, workspace_id, enabled, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(session_id) DO UPDATE SET
                       workspace_id = excluded.workspace_id,
                       enabled = excluded.enabled,
                       updated_at = excluded.updated_at",
                    params![session_id, workspace_id, enabled, updated_at],
                )?;
                Ok(())
            })
            .await
    }

    /// Removes a session override so the workspace default applies again.
    pub async fn clear_session_override(&self, session_id: &str) -> Result<bool> {
        let session_id = session_id.to_owned();
        self.connection
            .call(move |connection| {
                Ok(connection.execute(
                    "DELETE FROM session_mcp_enablement WHERE session_id = ?1",
                    [session_id],
                )? > 0)
            })
            .await
    }
}

/// Persistence for sandbox selections.
///
/// Selections are stored as JSON so a later profile field does not need a
/// schema change. Missing state is always unsandboxed.
#[derive(Clone)]
pub struct SandboxSelectionRepository {
    connection: Connection,
}

impl SandboxSelectionRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Reads the workspace default and the session override, when one exists.
    pub async fn get(
        &self,
        workspace_id: &str,
        session_id: Option<&str>,
    ) -> Result<SandboxSelectionState> {
        let workspace_id = workspace_id.to_owned();
        let session_id = session_id.map(str::to_owned);
        self.connection
            .call(move |connection| {
                let workspace_default = connection
                    .query_row(
                        "SELECT selection FROM workspace_sandbox_selection WHERE workspace_id = ?1",
                        [&workspace_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .map(|selection| parse_selection(&selection))
                    .transpose()?
                    .unwrap_or_default();
                let session_override = match session_id {
                    Some(session_id) => connection
                        .query_row(
                            "SELECT selection FROM session_sandbox_selection
                             WHERE session_id = ?1 AND workspace_id = ?2",
                            params![session_id, workspace_id],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?
                        .map(|selection| parse_selection(&selection))
                        .transpose()?,
                    None => None,
                };
                Ok(SandboxSelectionState {
                    workspace_default,
                    session_override,
                })
            })
            .await
    }

    /// Sets the workspace default for new sessions.
    pub async fn set_workspace_default(
        &self,
        workspace_id: &str,
        selection: &SandboxSelection,
        updated_at: &str,
    ) -> Result<()> {
        let workspace_id = workspace_id.to_owned();
        let selection = serde_json::to_string(selection).expect("selection is serializable");
        let updated_at = updated_at.to_owned();
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO workspace_sandbox_selection (workspace_id, selection, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(workspace_id) DO UPDATE SET
                       selection = excluded.selection,
                       updated_at = excluded.updated_at",
                    params![workspace_id, selection, updated_at],
                )?;
                Ok(())
            })
            .await
    }

    /// Sets one session override without changing the workspace default.
    pub async fn set_session_override(
        &self,
        workspace_id: &str,
        session_id: &str,
        selection: &SandboxSelection,
        updated_at: &str,
    ) -> Result<()> {
        let workspace_id = workspace_id.to_owned();
        let session_id = session_id.to_owned();
        let selection = serde_json::to_string(selection).expect("selection is serializable");
        let updated_at = updated_at.to_owned();
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO session_sandbox_selection
                       (session_id, workspace_id, selection, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(session_id) DO UPDATE SET
                       workspace_id = excluded.workspace_id,
                       selection = excluded.selection,
                       updated_at = excluded.updated_at",
                    params![session_id, workspace_id, selection, updated_at],
                )?;
                Ok(())
            })
            .await
    }

    /// Removes a session override so the workspace default applies again.
    pub async fn clear_session_override(&self, session_id: &str) -> Result<bool> {
        let session_id = session_id.to_owned();
        self.connection
            .call(move |connection| {
                Ok(connection.execute(
                    "DELETE FROM session_sandbox_selection WHERE session_id = ?1",
                    [session_id],
                )? > 0)
            })
            .await
    }
}

fn parse_selection(selection: &str) -> rusqlite::Result<SandboxSelection> {
    serde_json::from_str(selection).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, error.into())
    })
}

/// Recovery metadata for an application-owned process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessMetadata {
    /// Stable process identifier.
    pub id: String,
    /// Associated workspace registration, when one exists.
    pub workspace_id: Option<String>,
    /// Adapter or subsystem that owns the process.
    pub process_kind: String,
    /// Identifier of the native agent session, when one exists.
    pub native_session_id: Option<String>,
    /// RFC 3339 process start timestamp.
    pub started_at: String,
    /// RFC 3339 process end timestamp, when the process has exited.
    pub ended_at: Option<String>,
    /// Process exit code, when the platform supplied one.
    pub exit_code: Option<i32>,
    /// Absolute placeholder paths the process's sandbox creates. They are
    /// hidden while the process runs and removed if it ends without cleanup.
    pub sandbox_placeholders: Vec<String>,
}

/// Access to process recovery metadata.
#[derive(Clone)]
pub struct ProcessMetadataRepository {
    connection: Connection,
}

impl ProcessMetadataRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Inserts or replaces process metadata.
    pub async fn upsert(&self, process: ProcessMetadata) -> Result<()> {
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO process_metadata (
                       id, workspace_id, process_kind, native_session_id,
                       started_at, ended_at, exit_code, sandbox_placeholders
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(id) DO UPDATE SET
                       workspace_id = excluded.workspace_id,
                       process_kind = excluded.process_kind,
                       native_session_id = excluded.native_session_id,
                       started_at = excluded.started_at,
                       ended_at = excluded.ended_at,
                       exit_code = excluded.exit_code,
                       sandbox_placeholders = excluded.sandbox_placeholders",
                    params![
                        process.id,
                        process.workspace_id,
                        process.process_kind,
                        process.native_session_id,
                        process.started_at,
                        process.ended_at,
                        process.exit_code,
                        serde_json::to_string(&process.sandbox_placeholders)
                            .expect("paths are serializable")
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Finds process metadata by its stable identifier.
    pub async fn get(&self, id: &str) -> Result<Option<ProcessMetadata>> {
        let id = id.to_owned();
        self.connection
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT id, workspace_id, process_kind, native_session_id,
                                started_at, ended_at, exit_code, sandbox_placeholders
                         FROM process_metadata WHERE id = ?1",
                        [id],
                        process_from_row,
                    )
                    .optional()
            })
            .await
    }

    /// Lists process metadata in stable start order.
    pub async fn list(&self) -> Result<Vec<ProcessMetadata>> {
        self.connection
            .call(|connection| {
                let mut statement = connection.prepare(
                    "SELECT id, workspace_id, process_kind, native_session_id,
                            started_at, ended_at, exit_code, sandbox_placeholders
                     FROM process_metadata ORDER BY started_at, id",
                )?;
                statement.query_map([], process_from_row)?.collect()
            })
            .await
    }

    /// Replaces the recorded sandbox placeholders for one process.
    pub async fn set_sandbox_placeholders(
        &self,
        id: &str,
        placeholders: Vec<String>,
    ) -> Result<()> {
        let id = id.to_owned();
        self.connection
            .call(move |connection| {
                connection.execute(
                    "UPDATE process_metadata SET sandbox_placeholders = ?2 WHERE id = ?1",
                    params![
                        id,
                        serde_json::to_string(&placeholders).expect("paths are serializable")
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Removes process metadata without touching native session files.
    pub async fn remove(&self, id: &str) -> Result<bool> {
        let id = id.to_owned();
        self.connection
            .call(move |connection| {
                Ok(connection.execute("DELETE FROM process_metadata WHERE id = ?1", [id])? > 0)
            })
            .await
    }
}

fn process_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProcessMetadata> {
    Ok(ProcessMetadata {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        process_kind: row.get(2)?,
        native_session_id: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        exit_code: row.get(6)?,
        sandbox_placeholders: serde_json::from_str(&row.get::<_, String>(7)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, error.into())
        })?,
    })
}

/// Persistence for small summaries retained after a process exits.
#[derive(Clone)]
pub struct ProcessResourceSummaryRepository {
    connection: Connection,
}

impl ProcessResourceSummaryRepository {
    fn new(connection: Connection) -> Self {
        Self { connection }
    }

    /// Inserts or replaces the final resource summary for one process.
    pub async fn upsert(&self, summary: ProcessResourceSummary) -> Result<()> {
        self.connection
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO process_resource_summaries (
                       process_id, ended_at_millis, elapsed_millis,
                       peak_resident_memory_bytes, cpu_time_millis,
                       peak_process_count, disk_read_bytes, disk_write_bytes
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(process_id) DO UPDATE SET
                       ended_at_millis = excluded.ended_at_millis,
                       elapsed_millis = excluded.elapsed_millis,
                       peak_resident_memory_bytes = excluded.peak_resident_memory_bytes,
                       cpu_time_millis = excluded.cpu_time_millis,
                       peak_process_count = excluded.peak_process_count,
                       disk_read_bytes = excluded.disk_read_bytes,
                       disk_write_bytes = excluded.disk_write_bytes",
                    params![
                        summary.process_id,
                        summary.ended_at_millis as i64,
                        summary.elapsed_millis as i64,
                        summary.peak_resident_memory_bytes as i64,
                        summary.cpu_time_millis as i64,
                        summary.peak_process_count,
                        summary.disk_read_bytes.map(|value| value as i64),
                        summary.disk_write_bytes.map(|value| value as i64),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Finds a completed resource summary by its stable process identifier.
    pub async fn get(&self, process_id: &str) -> Result<Option<ProcessResourceSummary>> {
        let process_id = process_id.to_owned();
        self.connection
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT process_id, ended_at_millis, elapsed_millis,
                                peak_resident_memory_bytes, cpu_time_millis,
                                peak_process_count, disk_read_bytes, disk_write_bytes
                         FROM process_resource_summaries WHERE process_id = ?1",
                        [process_id],
                        |row| {
                            Ok(ProcessResourceSummary {
                                process_id: row.get(0)?,
                                ended_at_millis: row.get::<_, i64>(1)? as u64,
                                elapsed_millis: row.get::<_, i64>(2)? as u64,
                                peak_resident_memory_bytes: row.get::<_, i64>(3)? as u64,
                                cpu_time_millis: row.get::<_, i64>(4)? as u64,
                                peak_process_count: row.get(5)?,
                                disk_read_bytes: row
                                    .get::<_, Option<i64>>(6)?
                                    .map(|value| value as u64),
                                disk_write_bytes: row
                                    .get::<_, Option<i64>>(7)?
                                    .map(|value| value as u64),
                            })
                        },
                    )
                    .optional()
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    const CREATED_AT: &str = "2026-03-01T10:00:00Z";
    const UPDATED_AT: &str = "2026-03-01T11:00:00Z";

    fn workspace() -> Workspace {
        Workspace {
            id: "workspace-1".to_owned(),
            path: "/work/pau".to_owned(),
            name: Some("Pau".to_owned()),
            created_at: CREATED_AT.to_owned(),
            updated_at: UPDATED_AT.to_owned(),
        }
    }

    #[tokio::test]
    async fn applies_migrations_to_empty_and_existing_states() {
        for starting_version in 0..=MIGRATIONS.len() {
            let directory = tempdir().unwrap();
            let path = directory.path().join("pau.sqlite3");

            if starting_version > 0 {
                let connection = rusqlite::Connection::open(&path).unwrap();
                for (index, migration) in MIGRATIONS.iter().take(starting_version).enumerate() {
                    connection.execute_batch(migration).unwrap();
                    connection
                        .pragma_update(None, "user_version", (index + 1) as i64)
                        .unwrap();
                }
            }

            let database = Database::open(&path).await.unwrap();
            let version = database
                .connection
                .call(|connection| {
                    connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                })
                .await
                .unwrap();
            assert_eq!(version, MIGRATIONS.len() as i64);
            assert!(database.workspaces().list().await.is_ok());
            assert!(database.processes().list().await.is_ok());
        }
    }

    #[tokio::test]
    async fn configures_wal_foreign_keys_and_busy_timeout() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("pau.sqlite3"))
            .await
            .unwrap();

        let configuration = database
            .connection
            .call(|connection| -> rusqlite::Result<_> {
                let journal_mode: String =
                    connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
                let foreign_keys: bool =
                    connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
                let busy_timeout: i64 =
                    connection.pragma_query_value(None, "busy_timeout", |row| row.get(0))?;
                Ok((journal_mode, foreign_keys, busy_timeout))
            })
            .await
            .unwrap();

        assert_eq!(configuration, ("wal".to_owned(), true, 5_000));
    }

    #[tokio::test]
    async fn round_trips_workspace_settings_and_process_metadata() {
        let directory = tempdir().unwrap();
        let database = Database::open(directory.path().join("pau.sqlite3"))
            .await
            .unwrap();

        let workspace = workspace();
        database
            .workspaces()
            .upsert(workspace.clone())
            .await
            .unwrap();
        assert_eq!(
            database.workspaces().get(&workspace.id).await.unwrap(),
            Some(workspace)
        );

        let setting = ApplicationSetting {
            key: "theme".to_owned(),
            value: "nord".to_owned(),
            updated_at: UPDATED_AT.to_owned(),
        };
        database.settings().set(setting.clone()).await.unwrap();
        assert_eq!(
            database.settings().get(&setting.key).await.unwrap(),
            Some(setting)
        );

        let initial = database
            .mcp_enablement()
            .get("workspace-1", Some("session-1"))
            .await
            .unwrap();
        assert_eq!(
            initial,
            McpEnablement {
                workspace_default: false,
                session_override: None,
            }
        );
        assert!(!initial.effective());
        database
            .mcp_enablement()
            .set_workspace_default("workspace-1", true, UPDATED_AT)
            .await
            .unwrap();
        database
            .mcp_enablement()
            .set_session_override("workspace-1", "session-1", false, UPDATED_AT)
            .await
            .unwrap();
        let overridden = database
            .mcp_enablement()
            .get("workspace-1", Some("session-1"))
            .await
            .unwrap();
        assert!(overridden.workspace_default);
        assert_eq!(overridden.session_override, Some(false));
        assert!(!overridden.effective());
        assert!(
            database
                .mcp_enablement()
                .clear_session_override("session-1")
                .await
                .unwrap()
        );
        assert!(
            database
                .mcp_enablement()
                .get("workspace-1", Some("session-1"))
                .await
                .unwrap()
                .effective()
        );

        let process = ProcessMetadata {
            id: "process-1".to_owned(),
            workspace_id: Some("workspace-1".to_owned()),
            process_kind: "pi".to_owned(),
            native_session_id: Some("native-session-1".to_owned()),
            started_at: CREATED_AT.to_owned(),
            ended_at: Some(UPDATED_AT.to_owned()),
            exit_code: Some(0),
            sandbox_placeholders: vec!["/work/pau/.mcp.json".to_owned()],
        };
        database.processes().upsert(process.clone()).await.unwrap();
        assert_eq!(
            database.processes().get(&process.id).await.unwrap(),
            Some(process.clone())
        );
        database
            .processes()
            .set_sandbox_placeholders(&process.id, Vec::new())
            .await
            .unwrap();
        assert!(
            database
                .processes()
                .get(&process.id)
                .await
                .unwrap()
                .unwrap()
                .sandbox_placeholders
                .is_empty()
        );

        let sandboxes = database.sandbox_selection();
        let initial = sandboxes
            .get("workspace-1", Some("session-1"))
            .await
            .unwrap();
        assert_eq!(initial, SandboxSelectionState::default());
        let mut sandbox_settings = crate::sandbox::SandboxSettings::workspace_write();
        sandbox_settings.credential_references = vec![crate::sandbox::SandboxCredentialReference {
            source: "PACKAGE_TOKEN".to_owned(),
            shape: crate::sandbox::SandboxCredentialShape::WholeValue,
            destinations: vec!["registry.example.com".to_owned()],
        }];
        let sandboxed = SandboxSelection::Sandboxed {
            settings: sandbox_settings,
        };
        sandboxes
            .set_workspace_default("workspace-1", &sandboxed, UPDATED_AT)
            .await
            .unwrap();
        let stored_selection = database
            .connection
            .call(|connection| {
                connection.query_row(
                    "SELECT selection FROM workspace_sandbox_selection WHERE workspace_id = ?1",
                    ["workspace-1"],
                    |row| row.get::<_, String>(0),
                )
            })
            .await
            .unwrap();
        let stored_selection: serde_json::Value = serde_json::from_str(&stored_selection).unwrap();
        assert_eq!(
            stored_selection["settings"]["credential_references"],
            serde_json::json!([{
                "source": "PACKAGE_TOKEN",
                "shape": "whole-value",
                "destinations": ["registry.example.com"]
            }])
        );
        assert!(
            stored_selection["settings"]["credential_references"][0]
                .get("value")
                .is_none()
        );
        sandboxes
            .set_session_override(
                "workspace-1",
                "session-1",
                &SandboxSelection::Unsandboxed,
                UPDATED_AT,
            )
            .await
            .unwrap();
        let overridden = sandboxes
            .get("workspace-1", Some("session-1"))
            .await
            .unwrap();
        assert_eq!(overridden.workspace_default, sandboxed);
        assert_eq!(overridden.effective(), &SandboxSelection::Unsandboxed);
        assert!(sandboxes.clear_session_override("session-1").await.unwrap());
        assert_eq!(
            sandboxes
                .get("workspace-1", Some("session-1"))
                .await
                .unwrap()
                .effective(),
            &sandboxed
        );

        let summary = ProcessResourceSummary {
            process_id: "process-1".to_owned(),
            ended_at_millis: 1_772_360_400_000,
            elapsed_millis: 3_600_000,
            peak_resident_memory_bytes: 512 * 1024 * 1024,
            cpu_time_millis: 42_000,
            peak_process_count: 4,
            disk_read_bytes: Some(1_024),
            disk_write_bytes: None,
        };
        database
            .process_resource_summaries()
            .upsert(summary.clone())
            .await
            .unwrap();
        assert_eq!(
            database
                .process_resource_summaries()
                .get("process-1")
                .await
                .unwrap(),
            Some(summary)
        );
    }

    #[tokio::test]
    async fn deleting_database_does_not_delete_native_session_files() {
        let directory = tempdir().unwrap();
        let native_session = directory.path().join("sessions/native-session.jsonl");
        fs::create_dir_all(native_session.parent().unwrap()).unwrap();
        fs::write(&native_session, "native agent history").unwrap();

        let database_path = directory.path().join("pau.sqlite3");
        let database = Database::open(&database_path).await.unwrap();
        database
            .processes()
            .upsert(ProcessMetadata {
                id: "process-1".to_owned(),
                workspace_id: None,
                process_kind: "pi".to_owned(),
                native_session_id: Some(native_session.to_string_lossy().into_owned()),
                started_at: CREATED_AT.to_owned(),
                ended_at: None,
                exit_code: None,
                sandbox_placeholders: Vec::new(),
            })
            .await
            .unwrap();
        drop(database);

        fs::remove_file(database_path).unwrap();

        assert_eq!(
            fs::read_to_string(native_session).unwrap(),
            "native agent history"
        );
    }
}
