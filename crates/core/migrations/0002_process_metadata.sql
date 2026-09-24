CREATE TABLE process_metadata (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    process_kind TEXT NOT NULL,
    native_session_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    exit_code INTEGER
);

CREATE INDEX process_metadata_workspace_id_idx
    ON process_metadata(workspace_id);
