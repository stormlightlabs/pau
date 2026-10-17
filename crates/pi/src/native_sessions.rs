//! Pi's native session files for one workspace.
//!
//! Pi owns these JSONL files. This module only reads them: it never creates,
//! rewrites, or deletes a session file, and a resumed session is opened by Pi
//! itself.

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

/// How much of the first user message a summary keeps.
const FIRST_MESSAGE_LIMIT: usize = 200;

/// A Pi session file that belongs to a workspace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiSessionFile {
    /// The session identifier from the file header.
    pub id: String,
    /// The latest name set with `session_info`, when one exists.
    pub name: Option<String>,
    /// The start of the first user message, for sessions without a name.
    pub first_message: Option<String>,
    /// The working directory recorded in the header.
    pub cwd: String,
    /// The header's ISO 8601 creation time.
    pub created_at: String,
    /// The file's last modification time, when the platform reports it.
    pub modified_at: Option<SystemTime>,
    /// The session file.
    pub path: PathBuf,
}

/// A session file that could not be listed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiSessionFileWarning {
    /// The unreadable or malformed file.
    pub path: PathBuf,
    /// What is wrong with it.
    pub message: String,
}

/// The session files found for a workspace.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PiSessionFiles {
    /// Readable sessions, most recently modified first.
    pub sessions: Vec<PiSessionFile>,
    /// Files that were skipped.
    pub warnings: Vec<PiSessionFileWarning>,
}

/// Why a session cannot be resumed.
#[derive(Debug, Eq, PartialEq)]
pub enum PiSessionFileError {
    /// The workspace has no readable session with this identifier.
    NotFound(String),
    /// The session file exists but its header is unusable.
    Malformed(String),
}

impl std::fmt::Display for PiSessionFileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(id) => write!(formatter, "Pi has no session {id} for this workspace"),
            Self::Malformed(message) => write!(formatter, "the Pi session is unusable: {message}"),
        }
    }
}

impl std::error::Error for PiSessionFileError {}

/// Returns the directory in which Pi stores a working directory's sessions:
/// `--<path>--`, where the path loses its leading separator and every `/`, `\`,
/// and `:` becomes `-`.
fn workspace_directory(sessions_directory: &Path, workspace_root: &Path) -> PathBuf {
    let path = workspace_root.to_string_lossy();
    let encoded: String = path
        .trim_start_matches(['/', '\\'])
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' => '-',
            other => other,
        })
        .collect();
    sessions_directory.join(format!("--{encoded}--"))
}

/// Lists the sessions Pi stored for `workspace_root`.
///
/// A missing session directory is an empty list. A file whose header is
/// unreadable, malformed, or recorded for another working directory becomes a
/// warning, so one bad file never hides the rest.
pub fn list_pi_session_files(sessions_directory: &Path, workspace_root: &Path) -> PiSessionFiles {
    let directory = workspace_directory(sessions_directory, workspace_root);
    let mut files = PiSessionFiles::default();
    let Ok(entries) = fs::read_dir(&directory) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
            || !path.is_file()
        {
            continue;
        }
        match read_session_file(&path) {
            Ok(session) if Path::new(&session.cwd) == workspace_root => {
                files.sessions.push(session);
            }
            Ok(session) => files.warnings.push(PiSessionFileWarning {
                path,
                message: format!("recorded for another directory: {}", session.cwd),
            }),
            Err(message) => files.warnings.push(PiSessionFileWarning { path, message }),
        }
    }
    files
        .sessions
        .sort_by_key(|session| std::cmp::Reverse(session.modified_at));
    files
        .warnings
        .sort_by(|left, right| left.path.cmp(&right.path));
    files
}

/// Finds the file of the session `id` among the workspace's own sessions.
///
/// The identifier is matched against listed headers and never joined into a
/// path, so a request cannot reach another workspace's files or anywhere else.
pub fn find_pi_session_file(
    sessions_directory: &Path,
    workspace_root: &Path,
    id: &str,
) -> Result<PathBuf, PiSessionFileError> {
    let files = list_pi_session_files(sessions_directory, workspace_root);
    if let Some(session) = files.sessions.into_iter().find(|session| session.id == id) {
        return Ok(session.path);
    }
    // A skipped file named for the session is malformed, which is a different
    // answer from a session that does not exist.
    match files
        .warnings
        .iter()
        .find(|warning| file_name_has_id(&warning.path, id))
    {
        Some(warning) => Err(PiSessionFileError::Malformed(warning.message.clone())),
        None => Err(PiSessionFileError::NotFound(id.to_owned())),
    }
}

/// Pi names files `<timestamp>_<session-id>.jsonl`.
fn file_name_has_id(path: &Path, id: &str) -> bool {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| stem.rsplit_once('_'))
        .is_some_and(|(_, file_id)| file_id == id)
}

fn read_session_file(path: &Path) -> Result<PiSessionFile, String> {
    let modified_at = fs::metadata(path).and_then(|meta| meta.modified()).ok();
    let mut lines = BufReader::new(File::open(path).map_err(|error| error.to_string())?).lines();
    let header: Value = serde_json::from_str(
        &lines
            .next()
            .ok_or("the file is empty")?
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("the header is not JSON: {error}"))?;
    if header["type"] != "session" {
        return Err("the first line is not a session header".to_owned());
    }
    let text = |key: &str| header[key].as_str().filter(|value| !value.is_empty());
    let (Some(id), Some(cwd), Some(created_at)) = (text("id"), text("cwd"), text("timestamp"))
    else {
        return Err("the header lacks an id, cwd, or timestamp".to_owned());
    };

    let mut name = None;
    let mut first_message = None;
    for line in lines {
        let Ok(line) = line else { break };
        // Parse only the entries a summary needs. Other lines are skipped by
        // substring test.
        let is_name = line.contains("\"session_info\"");
        if !is_name && (first_message.is_some() || !line.contains("\"user\"")) {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match entry["type"].as_str() {
            Some("session_info") => {
                name = entry["name"]
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned);
            }
            Some("message") if entry["message"]["role"] == "user" => {
                first_message = user_text(&entry["message"]["content"]);
            }
            _ => {}
        }
    }

    Ok(PiSessionFile {
        id: id.to_owned(),
        name,
        first_message,
        cwd: cwd.to_owned(),
        created_at: created_at.to_owned(),
        modified_at,
        path: path.to_path_buf(),
    })
}

/// The leading text of a user message, whose content is a string or blocks.
fn user_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then(|| text.chars().take(FIRST_MESSAGE_LIMIT).collect())
}
