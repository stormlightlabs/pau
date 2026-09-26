CREATE TABLE process_resource_summaries (
    process_id TEXT PRIMARY KEY NOT NULL
        REFERENCES process_metadata(id) ON DELETE CASCADE,
    ended_at_millis INTEGER NOT NULL,
    elapsed_millis INTEGER NOT NULL,
    peak_resident_memory_bytes INTEGER NOT NULL,
    cpu_time_millis INTEGER NOT NULL,
    peak_process_count INTEGER NOT NULL,
    disk_read_bytes INTEGER,
    disk_write_bytes INTEGER
);
