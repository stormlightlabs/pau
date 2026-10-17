//! Listing and locating Pi session files against fixture session directories.

use std::fs;
use std::path::Path;

use pau_pi::{PiSessionFileError, find_pi_session_file, list_pi_session_files};

fn header(id: &str, cwd: &str) -> String {
    format!(
        r#"{{"type":"session","version":3,"id":"{id}","timestamp":"2026-01-02T03:04:05.000Z","cwd":"{cwd}"}}"#
    )
}

/// Writes a session file where Pi would, for a workspace at `/work/app`.
fn write(sessions: &Path, file: &str, lines: &[String]) {
    let directory = sessions.join("--work-app--");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join(file), lines.join("\n")).unwrap();
}

const USER: &str = r#"{"type":"message","id":"a1","parentId":null,"timestamp":"2026-01-02T03:05:00.000Z","message":{"role":"user","content":"  Fix the\nlogin bug "}}"#;
const NAME: &str = r#"{"type":"session_info","id":"b2","parentId":"a1","timestamp":"2026-01-02T03:06:00.000Z","name":"Login fix"}"#;
const BLOCKS: &str = r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Hello"},{"type":"image"}]}}"#;

#[test]
fn lists_named_and_unnamed_sessions_and_skips_bad_files() {
    let sessions = tempfile::tempdir().unwrap();
    let root = Path::new("/work/app");
    write(
        sessions.path(),
        "2026_named.jsonl",
        &[
            header("named", "/work/app"),
            USER.to_owned(),
            NAME.to_owned(),
        ],
    );
    write(
        sessions.path(),
        "2026_blocks.jsonl",
        &[header("blocks", "/work/app"), BLOCKS.to_owned()],
    );
    write(
        sessions.path(),
        "2026_empty.jsonl",
        &[header("empty", "/work/app")],
    );
    write(
        sessions.path(),
        "2026_broken.jsonl",
        &["not json".to_owned()],
    );
    write(sessions.path(), "2026_blank.jsonl", &[]);
    write(
        sessions.path(),
        "2026_other.jsonl",
        &[header("other", "/work/elsewhere")],
    );
    write(sessions.path(), "notes.txt", &["ignored".to_owned()]);

    let files = list_pi_session_files(sessions.path(), root);

    let mut ids: Vec<_> = files.sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, ["blocks", "empty", "named"]);
    let named = files.sessions.iter().find(|s| s.id == "named").unwrap();
    assert_eq!(named.name.as_deref(), Some("Login fix"));
    assert_eq!(named.first_message.as_deref(), Some("Fix the login bug"));
    assert_eq!(named.created_at, "2026-01-02T03:04:05.000Z");
    assert!(named.modified_at.is_some());
    let blocks = files.sessions.iter().find(|s| s.id == "blocks").unwrap();
    assert_eq!(blocks.name, None);
    assert_eq!(blocks.first_message.as_deref(), Some("Hello"));
    assert_eq!(files.warnings.len(), 3);
}

#[test]
fn a_workspace_without_a_session_directory_has_no_sessions() {
    let sessions = tempfile::tempdir().unwrap();
    let files = list_pi_session_files(sessions.path(), Path::new("/work/app"));
    assert!(files.sessions.is_empty() && files.warnings.is_empty());
}

#[test]
fn finds_only_this_workspaces_sessions_by_identifier() {
    let sessions = tempfile::tempdir().unwrap();
    let root = Path::new("/work/app");
    write(
        sessions.path(),
        "2026_one.jsonl",
        &[header("one", "/work/app")],
    );
    write(sessions.path(), "2026_bad.jsonl", &["{".to_owned()]);
    write(
        sessions.path(),
        "2026_other.jsonl",
        &[header("other", "/work/elsewhere")],
    );

    let found = find_pi_session_file(sessions.path(), root, "one").unwrap();
    assert!(found.starts_with(sessions.path().join("--work-app--")));
    assert!(matches!(
        find_pi_session_file(sessions.path(), root, "missing"),
        Err(PiSessionFileError::NotFound(_))
    ));
    assert!(matches!(
        find_pi_session_file(sessions.path(), root, "bad"),
        Err(PiSessionFileError::Malformed(_))
    ));
    // Traversal and other workspaces' sessions never match.
    for id in ["../--work-app--/2026_one", "other", "/etc/passwd"] {
        assert!(
            find_pi_session_file(sessions.path(), root, id).is_err(),
            "{id}"
        );
    }
}
