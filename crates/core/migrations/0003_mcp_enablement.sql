CREATE TABLE workspace_mcp_enablement (
    workspace_id TEXT PRIMARY KEY NOT NULL
        REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
);

CREATE TABLE session_mcp_enablement (
    session_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL
        REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
);
