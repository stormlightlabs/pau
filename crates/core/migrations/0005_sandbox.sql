CREATE TABLE workspace_sandbox_selection (
    workspace_id TEXT PRIMARY KEY NOT NULL
        REFERENCES workspaces(id) ON DELETE CASCADE,
    selection TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE session_sandbox_selection (
    session_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL
        REFERENCES workspaces(id) ON DELETE CASCADE,
    selection TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE process_metadata
    ADD COLUMN sandbox_placeholders TEXT NOT NULL DEFAULT '[]';
