CREATE TABLE audit_records (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    workspace_id TEXT,
    session_id TEXT,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL,
    result TEXT NOT NULL,
    target TEXT,
    reason TEXT,
    exit_code INTEGER
);
