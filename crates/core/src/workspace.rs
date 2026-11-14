//! Workspace registration and root-confined file operations.

use std::{
    fmt, fs, io,
    path::{Component, Path, PathBuf},
};

use cap_std::{ambient_authority, fs::Dir};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::process::Command;
use ts_rs::TS;
use uuid::Uuid;

use crate::persistence::{ProcessMetadataRepository, Workspace, WorkspaceRepository};
use crate::sandbox::is_placeholder;

const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 1_000;
const DEFAULT_NAME_SEARCH_LIMIT: usize = 50;
/// Most entries one name search visits before it returns what it found.
const MAX_NAME_SEARCH_ENTRIES: usize = 200_000;
/// Largest file the editor opens, search reads, or diff review compares.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Failures returned by workspace and file operations.
#[derive(Debug)]
pub enum WorkspaceError {
    /// A requested workspace does not exist.
    NotFound,
    /// A path is invalid or resolves outside its workspace root.
    InvalidPath,
    /// A file changed after it was read.
    Conflict,
    /// A general file endpoint cannot access a credential-bearing file.
    SensitivePath,
    /// File content appears to be binary rather than text.
    BinaryFile,
    /// File content exceeds the built-in editor limit.
    FileTooLarge,
    /// File content is not valid UTF-8.
    InvalidEncoding,
    /// The file cannot be changed through the built-in editor.
    ReadOnly,
    /// The requested operation expected another filesystem object type.
    WrongFileType,
    /// Persistence failed.
    Persistence(tokio_rusqlite::Error),
    /// Filesystem access failed.
    Io(io::Error),
    /// Git could not read repository state.
    Git(String),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("workspace or file not found"),
            Self::InvalidPath => formatter.write_str("path must stay inside the workspace root"),
            Self::Conflict => formatter.write_str("file changed after it was read"),
            Self::SensitivePath => {
                formatter.write_str("general file access is denied for this path")
            }
            Self::BinaryFile => formatter.write_str("file appears to contain binary data"),
            Self::FileTooLarge => formatter.write_str("file exceeds the 2 MiB editor limit"),
            Self::InvalidEncoding => formatter.write_str("file is not valid UTF-8"),
            Self::ReadOnly => formatter.write_str("file is read-only"),
            Self::WrongFileType => formatter.write_str("path has the wrong file type"),
            Self::Persistence(error) => write!(formatter, "workspace persistence failed: {error}"),
            Self::Io(error) => write!(formatter, "workspace file access failed: {error}"),
            Self::Git(message) => write!(formatter, "Git status failed: {message}"),
        }
    }
}

impl std::error::Error for WorkspaceError {}

impl From<tokio_rusqlite::Error> for WorkspaceError {
    fn from(error: tokio_rusqlite::Error) -> Self {
        Self::Persistence(error)
    }
}

impl From<io::Error> for WorkspaceError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::NotFound {
            Self::NotFound
        } else {
            Self::Io(error)
        }
    }
}

/// Options controlling workspace file traversal.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct TraversalOptions {
    /// Include dot-prefixed files and directories.
    #[serde(default)]
    pub include_hidden: bool,
    /// Include paths excluded by Git and ignore files.
    #[serde(default)]
    pub include_ignored: bool,
}

/// Kind of object returned by a workspace listing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum FileEntryKind {
    /// A regular file.
    File,
    /// A directory.
    Directory,
    /// A symbolic link. Links are never followed by traversal.
    Symlink,
}

/// One direct child in a workspace directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FileEntry {
    /// Slash-separated path relative to the workspace root.
    pub path: String,
    /// Filesystem object kind.
    pub kind: FileEntryKind,
    /// File size in bytes. Directories and links do not report a size.
    pub size: Option<u64>,
}

/// UTF-8 file content and the revision required for a later write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FileContent {
    /// Slash-separated path relative to the workspace root.
    pub path: String,
    /// UTF-8 file content.
    pub content: String,
    /// SHA-256 revision of the returned bytes.
    pub revision: String,
    /// Whether the file's permissions allow the built-in editor to save it.
    pub writable: bool,
}

/// One matching line from workspace search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FileSearchMatch {
    /// Slash-separated path relative to the workspace root.
    pub path: String,
    /// One-based matching line number.
    pub line: u64,
    /// Matching line with surrounding whitespace removed.
    pub preview: String,
}

/// A change reported for one side of the Git index/worktree pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum GitFileState {
    /// File content changed.
    Modified,
    /// File was added.
    Added,
    /// File was deleted.
    Deleted,
    /// File moved from another path.
    Renamed,
    /// File was copied from another path.
    Copied,
    /// File type changed.
    TypeChanged,
    /// File is not tracked.
    Untracked,
}

/// Git state for one changed path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitFileStatus {
    /// Slash-separated path relative to the workspace root.
    pub path: String,
    /// Previous path for a rename or copy.
    pub previous_path: Option<String>,
    /// Change staged in the index, when present.
    pub staged: Option<GitFileState>,
    /// Unstaged worktree change, when present.
    pub worktree: Option<GitFileState>,
    /// Whether Git reports an unresolved merge conflict.
    pub conflicted: bool,
}

/// Read-only Git state for a workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitStatus {
    /// Whether the workspace is inside a Git worktree.
    pub repository: bool,
    /// Current branch name, absent for detached HEAD and new repositories.
    pub branch: Option<String>,
    /// Current commit identifier, when HEAD resolves to a commit.
    pub head: Option<String>,
    /// Whether HEAD points directly to a commit.
    pub detached: bool,
    /// Changed paths reported by Git.
    pub files: Vec<GitFileStatus>,
}

/// Text content used to render one changed file against `HEAD`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitDiff {
    /// Current slash-separated path relative to the workspace root.
    pub path: String,
    /// Path in `HEAD` when the file was renamed or copied.
    pub previous_path: Option<String>,
    /// Content from `HEAD`, absent when the diff cannot be rendered as text.
    pub old_content: Option<String>,
    /// Current worktree content, absent when the diff cannot be rendered as text.
    pub new_content: Option<String>,
    /// Whether either side contains binary or invalid UTF-8 data.
    pub binary: bool,
    /// Whether either side exceeds the built-in diff limit.
    pub too_large: bool,
}

/// Root-confined file access backed by remembered workspace registrations.
#[derive(Clone)]
pub struct WorkspaceService {
    workspaces: WorkspaceRepository,
    processes: Option<ProcessMetadataRepository>,
}

impl WorkspaceService {
    /// Creates a service around the application workspace repository.
    pub fn new(workspaces: WorkspaceRepository) -> Self {
        Self {
            workspaces,
            processes: None,
        }
    }

    /// Hides the placeholders recorded for running sandboxed processes.
    pub fn with_processes(mut self, processes: ProcessMetadataRepository) -> Self {
        self.processes = Some(processes);
        self
    }

    /// Canonicalizes and remembers a directory or Git worktree.
    pub async fn open(
        &self,
        path: impl AsRef<Path>,
        name: Option<String>,
    ) -> Result<Workspace, WorkspaceError> {
        let canonical = fs::canonicalize(path)?;
        if !canonical.is_dir() {
            return Err(WorkspaceError::WrongFileType);
        }
        let path = canonical.to_string_lossy().into_owned();
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("RFC 3339 supports every system timestamp");

        let mut workspace = if let Some(existing) = self.workspaces.get_by_path(&path).await? {
            existing
        } else {
            Workspace {
                id: Uuid::new_v4().to_string(),
                path,
                name: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            }
        };
        if name.is_some() {
            workspace.name = name;
        }
        workspace.updated_at = now;
        self.workspaces.upsert(workspace.clone()).await?;
        Ok(workspace)
    }

    /// Lists remembered workspace roots.
    pub async fn registered(&self) -> Result<Vec<Workspace>, WorkspaceError> {
        Ok(self.workspaces.list().await?)
    }

    /// Lists the direct children of a workspace directory.
    pub async fn list(
        &self,
        workspace_id: &str,
        relative_path: &str,
        options: TraversalOptions,
    ) -> Result<Vec<FileEntry>, WorkspaceError> {
        let root = self.root(workspace_id).await?;
        let directory = confined_existing(&root, relative_path)?;
        if !directory.is_dir() {
            return Err(WorkspaceError::WrongFileType);
        }

        let hidden = self.hidden_placeholders(workspace_id, &root).await?;
        let mut entries = Vec::new();
        for item in walker(&directory, options, Some(1)) {
            let item = item.map_err(|error| io::Error::other(error.to_string()))?;
            if item.depth() == 0 {
                continue;
            }
            let file_type = item.file_type().ok_or(WorkspaceError::WrongFileType)?;
            let kind = if file_type.is_dir() {
                FileEntryKind::Directory
            } else if file_type.is_symlink() {
                FileEntryKind::Symlink
            } else {
                FileEntryKind::File
            };
            let relative = relative_display(&root, item.path())?;
            if is_sensitive(&relative) || is_hidden(&hidden, &relative) {
                continue;
            }
            let size = (kind == FileEntryKind::File)
                .then(|| item.metadata().map(|metadata| metadata.len()))
                .transpose()
                .map_err(|error| io::Error::other(error.to_string()))?;
            entries.push(FileEntry {
                path: relative,
                kind,
                size,
            });
        }
        entries.sort_by(compare_entries);
        Ok(entries)
    }

    /// Reads one UTF-8 file and returns its content revision.
    pub async fn read(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<FileContent, WorkspaceError> {
        let root = self.root(workspace_id).await?;
        reject_sensitive(relative_path)?;
        let path = confined_existing(&root, relative_path)?;
        if !path.is_file() {
            return Err(WorkspaceError::WrongFileType);
        }
        let metadata = path.metadata()?;
        if metadata.len() > MAX_FILE_BYTES {
            return Err(WorkspaceError::FileTooLarge);
        }
        let directory = Dir::open_ambient_dir(&root, ambient_authority())?;
        let bytes = directory.read(validate_relative(relative_path)?)?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(WorkspaceError::FileTooLarge);
        }
        if bytes.contains(&0) {
            return Err(WorkspaceError::BinaryFile);
        }
        let revision = revision(&bytes);
        let content = String::from_utf8(bytes).map_err(|_| WorkspaceError::InvalidEncoding)?;
        Ok(FileContent {
            path: relative_display(&root, &path)?,
            content,
            revision,
            writable: !metadata.permissions().readonly(),
        })
    }

    /// Writes one UTF-8 file if its current revision matches the caller's copy.
    ///
    /// Existing files require `expected_revision`. New files require no
    /// revision. The parent directory must already exist.
    pub async fn write(
        &self,
        workspace_id: &str,
        relative_path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<FileContent, WorkspaceError> {
        if content.len() as u64 > MAX_FILE_BYTES {
            return Err(WorkspaceError::FileTooLarge);
        }
        if content.as_bytes().contains(&0) {
            return Err(WorkspaceError::BinaryFile);
        }
        let root = self.root(workspace_id).await?;
        reject_sensitive(relative_path)?;
        let path = confined_for_write(&root, relative_path)?;
        let relative = validate_relative(relative_path)?;
        let directory = Dir::open_ambient_dir(&root, ambient_authority())?;

        match directory.read(relative) {
            Ok(current) => {
                if path.metadata()?.permissions().readonly() {
                    return Err(WorkspaceError::ReadOnly);
                }
                if expected_revision != Some(revision(&current).as_str()) {
                    return Err(WorkspaceError::Conflict);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if expected_revision.is_some() {
                    return Err(WorkspaceError::Conflict);
                }
            }
            Err(error) => return Err(error.into()),
        }

        directory.write(relative, content.as_bytes())?;
        let bytes = directory.read(relative)?;
        Ok(FileContent {
            path: relative_display(&root, &path)?,
            content: String::from_utf8(bytes.clone())
                .map_err(|_| WorkspaceError::InvalidEncoding)?,
            revision: revision(&bytes),
            writable: !path.metadata()?.permissions().readonly(),
        })
    }

    /// Reads branch and changed-file state without updating the Git index.
    pub async fn git_status(&self, workspace_id: &str) -> Result<GitStatus, WorkspaceError> {
        let root = self.root(workspace_id).await?;
        let output = Command::new("git")
            .current_dir(&root)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .args([
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
                "--",
                ".",
            ])
            .output()
            .await
            .map_err(|error| WorkspaceError::Git(error.to_string()))?;

        if output.status.success() {
            let mut status = parse_git_status(&output.stdout)?;
            let hidden = self.hidden_placeholders(workspace_id, &root).await?;
            status.files.retain(|file| !is_hidden(&hidden, &file.path));
            return Ok(status);
        }

        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if message.contains("not a git repository") {
            return Ok(GitStatus {
                repository: false,
                branch: None,
                head: None,
                detached: false,
                files: Vec::new(),
            });
        }
        Err(WorkspaceError::Git(message))
    }

    /// Reads one changed file against `HEAD` without changing repository state.
    pub async fn git_diff(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<GitDiff, WorkspaceError> {
        reject_sensitive(relative_path)?;
        let root = self.root(workspace_id).await?;
        let status = self.git_status(workspace_id).await?;
        let file = status
            .files
            .iter()
            .find(|file| file.path == relative_path)
            .ok_or(WorkspaceError::NotFound)?;
        if let Some(previous_path) = file.previous_path.as_deref() {
            reject_sensitive(previous_path)?;
        }

        let is_added = matches!(file.staged, Some(GitFileState::Added))
            || matches!(file.worktree, Some(GitFileState::Untracked));
        let old_path = file.previous_path.as_deref().unwrap_or(relative_path);
        let old_bytes = if is_added {
            Vec::new()
        } else {
            git_head_file(&root, old_path).await?
        };
        let new_bytes = worktree_file(&root, relative_path)?;
        let too_large =
            old_bytes.len() as u64 > MAX_FILE_BYTES || new_bytes.len() as u64 > MAX_FILE_BYTES;
        let binary = old_bytes.contains(&0)
            || new_bytes.contains(&0)
            || std::str::from_utf8(&old_bytes).is_err()
            || std::str::from_utf8(&new_bytes).is_err();
        let (old_content, new_content) = if binary || too_large {
            (None, None)
        } else {
            (
                Some(String::from_utf8(old_bytes).expect("UTF-8 checked above")),
                Some(String::from_utf8(new_bytes).expect("UTF-8 checked above")),
            )
        };

        Ok(GitDiff {
            path: file.path.clone(),
            previous_path: file.previous_path.clone(),
            old_content,
            new_content,
            binary,
            too_large,
        })
    }

    /// Searches UTF-8 file content under one workspace root.
    pub async fn search(
        &self,
        workspace_id: &str,
        query: &str,
        options: TraversalOptions,
        limit: Option<usize>,
    ) -> Result<Vec<FileSearchMatch>, WorkspaceError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let root = self.root(workspace_id).await?;
        let limit = limit
            .unwrap_or(DEFAULT_SEARCH_LIMIT)
            .clamp(1, MAX_SEARCH_LIMIT);
        let directory = Dir::open_ambient_dir(&root, ambient_authority())?;
        let hidden = self.hidden_placeholders(workspace_id, &root).await?;
        let mut matches = Vec::new();

        for item in walker(&root, options, None) {
            let item = item.map_err(|error| io::Error::other(error.to_string()))?;
            let Some(file_type) = item.file_type() else {
                continue;
            };
            if !file_type.is_file()
                || item
                    .metadata()
                    .is_ok_and(|metadata| metadata.len() > MAX_FILE_BYTES)
            {
                continue;
            }
            let relative = relative_display(&root, item.path())?;
            if is_sensitive(&relative) || is_hidden(&hidden, &relative) {
                continue;
            }
            let Ok(content) = directory.read_to_string(&relative) else {
                continue;
            };
            for (index, line) in content.lines().enumerate() {
                if line.contains(query) {
                    matches.push(FileSearchMatch {
                        path: relative.clone(),
                        line: index as u64 + 1,
                        preview: line.trim().to_owned(),
                    });
                    if matches.len() == limit {
                        return Ok(matches);
                    }
                }
            }
        }
        Ok(matches)
    }

    /// Finds files and folders whose names match `query`, best match first.
    ///
    /// A query with a slash searches only the direct children of the folder
    /// before the last slash, by the name after it, the way Pi completes
    /// paths. An empty query lists the root. Any other query searches every
    /// folder under the root that traversal options and ignore rules allow,
    /// visiting at most [`MAX_NAME_SEARCH_ENTRIES`] entries so a huge tree
    /// cannot stall the request. A folder that does not exist yields no
    /// matches, and one outside the root is [`WorkspaceError::InvalidPath`].
    ///
    /// Names match case-insensitively as a prefix, then a substring, then
    /// letters in order. Folders come before files of the same rank, then
    /// shorter paths. Links are never followed, and a link appears only when
    /// its target stays inside the root.
    pub async fn search_names(
        &self,
        workspace_id: &str,
        query: &str,
        options: TraversalOptions,
        limit: Option<usize>,
    ) -> Result<Vec<FileEntry>, WorkspaceError> {
        let root = self.root(workspace_id).await?;
        let limit = limit
            .unwrap_or(DEFAULT_NAME_SEARCH_LIMIT)
            .clamp(1, MAX_SEARCH_LIMIT);
        let hidden = self.hidden_placeholders(workspace_id, &root).await?;
        let query = query.to_owned();
        tokio::task::spawn_blocking(move || {
            search_names_in(
                &root,
                &query,
                options,
                limit,
                MAX_NAME_SEARCH_ENTRIES,
                &hidden,
            )
        })
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
    }

    /// Returns workspace-relative placeholders of running sandboxed processes
    /// that are still empty. A placeholder the operator has since written is
    /// a real file and stays visible.
    async fn hidden_placeholders(
        &self,
        workspace_id: &str,
        root: &Path,
    ) -> Result<Vec<String>, WorkspaceError> {
        let Some(processes) = &self.processes else {
            return Ok(Vec::new());
        };
        Ok(processes
            .list()
            .await?
            .into_iter()
            .filter(|process| {
                process.ended_at.is_none() && process.workspace_id.as_deref() == Some(workspace_id)
            })
            .flat_map(|process| process.sandbox_placeholders)
            .filter_map(|path| {
                let path = PathBuf::from(path);
                let relative = path.strip_prefix(root).ok()?.to_str()?.to_owned();
                is_placeholder(&path).then_some(relative)
            })
            .collect())
    }

    /// Returns the canonical root of a remembered workspace.
    pub async fn root(&self, workspace_id: &str) -> Result<PathBuf, WorkspaceError> {
        let workspace = self
            .workspaces
            .get(workspace_id)
            .await?
            .ok_or(WorkspaceError::NotFound)?;
        let root = fs::canonicalize(workspace.path)?;
        if !root.is_dir() {
            return Err(WorkspaceError::WrongFileType);
        }
        Ok(root)
    }
}

fn is_hidden(hidden: &[String], relative: &str) -> bool {
    hidden.iter().any(|placeholder| {
        relative == placeholder
            || relative
                .strip_prefix(placeholder.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// Runs [`WorkspaceService::search_names`] under a canonical root, visiting at
/// most `budget` entries. Tests pass a small budget to exercise the cut-off.
fn search_names_in(
    root: &Path,
    query: &str,
    options: TraversalOptions,
    limit: usize,
    budget: usize,
    hidden: &[String],
) -> Result<Vec<FileEntry>, WorkspaceError> {
    let (folder, name) = query.rsplit_once('/').unwrap_or(("", query));
    let needle = name.to_lowercase();
    let start = match confined_existing(root, folder) {
        Ok(path) if path.is_dir() => path,
        Ok(_) | Err(WorkspaceError::NotFound) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let depth = (query.contains('/') || needle.is_empty()).then_some(1);
    let mut found = Vec::new();
    // An unreadable folder costs its own entries, not the whole search.
    for item in walker(&start, options, depth).take(budget).flatten() {
        if item.depth() == 0 {
            continue;
        }
        let Some(file_type) = item.file_type() else {
            continue;
        };
        let Some(rank) = item
            .file_name()
            .to_str()
            .and_then(|name| name_rank(name, &needle))
        else {
            continue;
        };
        let relative = relative_display(root, item.path())?;
        if is_sensitive(&relative) || is_hidden(hidden, &relative) {
            continue;
        }
        let kind = if file_type.is_dir() {
            FileEntryKind::Directory
        } else if file_type.is_symlink() {
            // A mention of a link that leaves the root would hand the agent a
            // path to files outside the workspace.
            if !fs::canonicalize(item.path()).is_ok_and(|target| target.starts_with(root)) {
                continue;
            }
            FileEntryKind::Symlink
        } else {
            FileEntryKind::File
        };
        found.push((
            rank,
            FileEntry {
                path: relative,
                kind,
                size: None,
            },
        ));
    }

    let folder_first = |entry: &FileEntry| entry.kind != FileEntryKind::Directory;
    found.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| folder_first(left).cmp(&folder_first(right)))
            .then_with(|| left.path.len().cmp(&right.path.len()))
            .then_with(|| left.path.cmp(&right.path))
    });
    found.truncate(limit);
    Ok(found
        .into_iter()
        .map(|(_, mut entry)| {
            if entry.kind == FileEntryKind::File {
                entry.size = fs::symlink_metadata(root.join(&entry.path))
                    .ok()
                    .map(|metadata| metadata.len());
            }
            entry
        })
        .collect())
}

/// Ranks a name against a lowercase needle: 0 for a prefix, 1 for a
/// substring, 2 for the needle's letters in order, and `None` otherwise.
fn name_rank(name: &str, needle: &str) -> Option<u8> {
    let name = name.to_lowercase();
    if name.starts_with(needle) {
        return Some(0);
    }
    if name.contains(needle) {
        return Some(1);
    }
    let mut letters = name.chars();
    needle
        .chars()
        .all(|wanted| letters.any(|letter| letter == wanted))
        .then_some(2)
}

async fn git_head_file(root: &Path, relative_path: &str) -> Result<Vec<u8>, WorkspaceError> {
    let object = format!("HEAD:{relative_path}");
    let output = Command::new("git")
        .current_dir(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(["--no-optional-locks", "show", "--no-textconv", &object])
        .output()
        .await
        .map_err(|error| WorkspaceError::Git(error.to_string()))?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(WorkspaceError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ))
    }
}

fn worktree_file(root: &Path, relative_path: &str) -> Result<Vec<u8>, WorkspaceError> {
    let relative = validate_relative(relative_path)?;
    let path = root.join(relative);
    if !path.exists() {
        return Ok(Vec::new());
    }
    confined_existing(root, relative_path)?;
    let directory = Dir::open_ambient_dir(root, ambient_authority())?;
    directory.read(relative).map_err(WorkspaceError::from)
}

fn walker(path: &Path, options: TraversalOptions, max_depth: Option<usize>) -> ignore::Walk {
    let mut builder = WalkBuilder::new(path);
    builder
        .follow_links(false)
        .hidden(!options.include_hidden)
        .ignore(!options.include_ignored)
        .git_ignore(!options.include_ignored)
        .git_global(!options.include_ignored)
        .git_exclude(!options.include_ignored)
        .require_git(false)
        .parents(true)
        .max_depth(max_depth);
    builder.build()
}

fn validate_relative(path: &str) -> Result<&Path, WorkspaceError> {
    let path = Path::new(path);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(path)
}

fn confined_existing(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let relative = validate_relative(relative)?;
    let canonical = fs::canonicalize(root.join(relative))?;
    if !canonical.starts_with(root) {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(canonical)
}

fn confined_for_write(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let relative = validate_relative(relative)?;
    if relative.as_os_str().is_empty() {
        return Err(WorkspaceError::WrongFileType);
    }
    let joined = root.join(relative);
    if joined.exists() {
        return confined_existing(root, relative.to_string_lossy().as_ref());
    }
    let parent = joined.parent().ok_or(WorkspaceError::InvalidPath)?;
    let canonical_parent = fs::canonicalize(parent)?;
    if !canonical_parent.starts_with(root) {
        return Err(WorkspaceError::InvalidPath);
    }
    Ok(canonical_parent.join(joined.file_name().ok_or(WorkspaceError::InvalidPath)?))
}

fn relative_display(root: &Path, path: &Path) -> Result<String, WorkspaceError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::InvalidPath)?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn parse_git_status(output: &[u8]) -> Result<GitStatus, WorkspaceError> {
    let mut status = GitStatus {
        repository: true,
        branch: None,
        head: None,
        detached: false,
        files: Vec::new(),
    };
    let mut records = output.split(|byte| *byte == 0);

    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let record = String::from_utf8_lossy(record);
        if let Some(head) = record.strip_prefix("# branch.head ") {
            if head == "(detached)" {
                status.detached = true;
            } else if head != "(unknown)" {
                status.branch = Some(head.to_owned());
            }
            continue;
        }
        if let Some(head) = record.strip_prefix("# branch.oid ") {
            if head != "(initial)" {
                status.head = Some(head.to_owned());
            }
            continue;
        }

        let (path, xy, previous_path, conflicted) = match record.as_bytes()[0] {
            b'1' => {
                let fields = record.splitn(9, ' ').collect::<Vec<_>>();
                if fields.len() != 9 {
                    return Err(WorkspaceError::Git(
                        "invalid ordinary status record".to_owned(),
                    ));
                }
                (fields[8].to_owned(), fields[1], None, false)
            }
            b'2' => {
                let fields = record.splitn(10, ' ').collect::<Vec<_>>();
                if fields.len() != 10 {
                    return Err(WorkspaceError::Git(
                        "invalid rename status record".to_owned(),
                    ));
                }
                let previous = records.next().ok_or_else(|| {
                    WorkspaceError::Git("rename status omitted its previous path".to_owned())
                })?;
                (
                    fields[9].to_owned(),
                    fields[1],
                    Some(String::from_utf8_lossy(previous).into_owned()),
                    false,
                )
            }
            b'u' => {
                let fields = record.splitn(11, ' ').collect::<Vec<_>>();
                if fields.len() != 11 {
                    return Err(WorkspaceError::Git(
                        "invalid conflict status record".to_owned(),
                    ));
                }
                (fields[10].to_owned(), fields[1], None, true)
            }
            b'?' => (record[2..].to_owned(), "??", None, false),
            _ => continue,
        };
        let mut states = xy.chars();
        let staged = git_file_state(states.next(), false);
        let worktree = git_file_state(states.next(), true);
        status.files.push(GitFileStatus {
            path,
            previous_path,
            staged,
            worktree,
            conflicted,
        });
    }

    Ok(status)
}

fn git_file_state(code: Option<char>, worktree: bool) -> Option<GitFileState> {
    match code? {
        'M' => Some(GitFileState::Modified),
        'A' => Some(GitFileState::Added),
        'D' => Some(GitFileState::Deleted),
        'R' => Some(GitFileState::Renamed),
        'C' => Some(GitFileState::Copied),
        'T' => Some(GitFileState::TypeChanged),
        '?' if worktree => Some(GitFileState::Untracked),
        _ => None,
    }
}

fn revision(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn reject_sensitive(path: &str) -> Result<(), WorkspaceError> {
    if is_sensitive(path) {
        Err(WorkspaceError::SensitivePath)
    } else {
        Ok(())
    }
}

/// Whether a path names a credential file that file listings and searches skip.
pub(crate) fn is_sensitive(path: &str) -> bool {
    Path::new(path).components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name == ".env"
            || name.starts_with(".env.")
            || matches!(
                name.as_ref(),
                ".git-credentials" | ".netrc" | ".npmrc" | "credentials.json"
            )
    })
}

/// Orders one directory's entries the way file browsers do: folders first,
/// then case-insensitive natural order so `file2` precedes `file10`.
///
/// Every consumer of directory listings gets this order from the service, so
/// clients render entries as received.
fn compare_entries(left: &FileEntry, right: &FileEntry) -> std::cmp::Ordering {
    let is_directory = |entry: &FileEntry| entry.kind == FileEntryKind::Directory;
    is_directory(right)
        .cmp(&is_directory(left))
        .then_with(|| natural_cmp(&left.path, &right.path))
        .then_with(|| left.path.cmp(&right.path))
}

/// Compares names case-insensitively, treating digit runs as numbers.
fn natural_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    let mut left = left.chars().peekable();
    let mut right = right.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let a = digit_run(&mut left);
                let b = digit_run(&mut right);
                let (a, b) = (a.trim_start_matches('0'), b.trim_start_matches('0'));
                let order = a.len().cmp(&b.len()).then_with(|| a.cmp(b));
                if order.is_ne() {
                    return order;
                }
            }
            (Some(a), Some(b)) => {
                left.next();
                right.next();
                let order = a.to_lowercase().cmp(b.to_lowercase());
                if order.is_ne() {
                    return order;
                }
            }
        }
    }
}

fn digit_run(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut run = String::new();
    while let Some(digit) = chars.next_if(char::is_ascii_digit) {
        run.push(digit);
    }
    run
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use crate::persistence::Database;

    use super::*;

    async fn fixture() -> (tempfile::TempDir, WorkspaceService, Workspace) {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let database = Database::open(directory.path().join("pau.sqlite3"))
            .await
            .unwrap();
        let service = WorkspaceService::new(database.workspaces());
        let workspace = service
            .open(&root, Some("Project".to_owned()))
            .await
            .unwrap();
        (directory, service, workspace)
    }

    #[test]
    fn orders_entries_folders_first_and_naturally() {
        let entry = |path: &str, kind| FileEntry {
            path: path.to_owned(),
            kind,
            size: None,
        };
        let mut entries = vec![
            entry("TODO.md", FileEntryKind::File),
            entry("file10.txt", FileEntryKind::File),
            entry("notes", FileEntryKind::Directory),
            entry(".env.example", FileEntryKind::File),
            entry("file2.txt", FileEntryKind::File),
            entry("Anki", FileEntryKind::Directory),
            entry("agents.md", FileEntryKind::File),
            entry("cards", FileEntryKind::Directory),
            entry("Claude.md", FileEntryKind::File),
        ];
        entries.sort_by(compare_entries);
        let paths: Vec<_> = entries.iter().map(|entry| entry.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "Anki",
                "cards",
                "notes",
                ".env.example",
                "agents.md",
                "Claude.md",
                "file2.txt",
                "file10.txt",
                "TODO.md"
            ]
        );
    }

    #[tokio::test]
    async fn canonicalizes_and_remembers_workspace_roots() {
        let (directory, service, workspace) = fixture().await;
        let reopened = service
            .open(directory.path().join("project/./"), None)
            .await
            .unwrap();

        assert_eq!(reopened.id, workspace.id);
        assert_eq!(reopened.name.as_deref(), Some("Project"));
        assert_eq!(service.registered().await.unwrap(), vec![reopened]);
    }

    #[tokio::test]
    async fn rejects_parent_traversal_and_symlink_escapes() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        let outside = directory.path().join("outside.txt");
        fs::write(&outside, "secret").unwrap();

        assert!(matches!(
            service.read(&workspace.id, "../outside.txt").await,
            Err(WorkspaceError::InvalidPath)
        ));

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
            assert!(matches!(
                service.read(&workspace.id, "escape").await,
                Err(WorkspaceError::InvalidPath)
            ));
            assert!(matches!(
                service
                    .write(&workspace.id, "escape", "changed", None)
                    .await,
                Err(WorkspaceError::InvalidPath)
            ));
        }
    }

    #[tokio::test]
    async fn lists_non_ascii_paths_and_controls_hidden_and_ignored_files() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        fs::write(root.join("café.txt"), "coffee").unwrap();
        fs::write(root.join(".hidden"), "hidden").unwrap();
        fs::write(root.join(".env"), "TOKEN=secret").unwrap();
        fs::write(root.join("ignored.log"), "ignored").unwrap();
        fs::write(root.join(".gitignore"), "*.log\n").unwrap();

        let visible = service
            .list(&workspace.id, "", TraversalOptions::default())
            .await
            .unwrap();
        assert_eq!(
            visible
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["café.txt"]
        );

        let all = service
            .list(
                &workspace.id,
                "",
                TraversalOptions {
                    include_hidden: true,
                    include_ignored: true,
                },
            )
            .await
            .unwrap();
        assert_eq!(all.len(), 4);
    }

    #[tokio::test]
    async fn reports_files_the_editor_cannot_open_or_change() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");

        fs::write(root.join("binary.dat"), b"text\0binary").unwrap();
        assert!(matches!(
            service.read(&workspace.id, "binary.dat").await,
            Err(WorkspaceError::BinaryFile)
        ));

        fs::write(root.join("invalid.txt"), b"text\xff").unwrap();
        assert!(matches!(
            service.read(&workspace.id, "invalid.txt").await,
            Err(WorkspaceError::InvalidEncoding)
        ));

        fs::write(
            root.join("large.txt"),
            vec![b'x'; MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        assert!(matches!(
            service.read(&workspace.id, "large.txt").await,
            Err(WorkspaceError::FileTooLarge)
        ));
        assert!(matches!(
            service
                .write(
                    &workspace.id,
                    "new-large.txt",
                    &"x".repeat(MAX_FILE_BYTES as usize + 1),
                    None,
                )
                .await,
            Err(WorkspaceError::FileTooLarge)
        ));

        let read_only = root.join("read-only.txt");
        fs::write(&read_only, "fixed").unwrap();
        let mut permissions = read_only.metadata().unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&read_only, permissions).unwrap();
        let content = service.read(&workspace.id, "read-only.txt").await.unwrap();
        assert!(!content.writable);
        assert!(matches!(
            service
                .write(
                    &workspace.id,
                    "read-only.txt",
                    "changed",
                    Some(&content.revision),
                )
                .await,
            Err(WorkspaceError::ReadOnly)
        ));
    }

    #[tokio::test]
    async fn detects_a_file_changed_between_read_and_write() {
        let (directory, service, workspace) = fixture().await;
        let path = directory.path().join("project/note.txt");
        fs::write(&path, "first").unwrap();
        let read = service.read(&workspace.id, "note.txt").await.unwrap();
        fs::write(&path, "external").unwrap();

        assert!(matches!(
            service
                .write(&workspace.id, "note.txt", "mine", Some(&read.revision))
                .await,
            Err(WorkspaceError::Conflict)
        ));
        assert_eq!(fs::read_to_string(path).unwrap(), "external");
    }

    #[test]
    fn parses_branch_and_every_required_changed_file_state() {
        let output = concat!(
            "# branch.oid abcdef1234567890\0",
            "# branch.head feature/status\0",
            "1 .M N... 100644 100644 100644 a b modified.txt\0",
            "1 M. N... 100644 100644 100644 a b staged.txt\0",
            "1 .D N... 100644 100644 000000 a b deleted.txt\0",
            "2 R. N... 100644 100644 100644 a b R100 renamed.txt\0old name.txt\0",
            "u UU N... 100644 100644 100644 100644 a b c conflicted.txt\0",
            "? untracked file.txt\0"
        );
        let status = parse_git_status(output.as_bytes()).unwrap();

        assert_eq!(status.branch.as_deref(), Some("feature/status"));
        assert_eq!(status.files.len(), 6);
        assert_eq!(status.files[0].worktree, Some(GitFileState::Modified));
        assert_eq!(status.files[1].staged, Some(GitFileState::Modified));
        assert_eq!(status.files[2].worktree, Some(GitFileState::Deleted));
        assert_eq!(status.files[3].staged, Some(GitFileState::Renamed));
        assert_eq!(
            status.files[3].previous_path.as_deref(),
            Some("old name.txt")
        );
        assert!(status.files[4].conflicted);
        assert_eq!(status.files[5].worktree, Some(GitFileState::Untracked));
    }

    #[tokio::test]
    async fn reports_detached_head_and_non_repository_workspaces() {
        let (directory, service, workspace) = fixture().await;
        assert!(!service.git_status(&workspace.id).await.unwrap().repository);

        let root = directory.path().join("project");
        let git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&root)
                .args(arguments)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        git(&["config", "user.name", "Pau Tests"]);
        git(&["config", "user.email", "pau@example.invalid"]);
        fs::write(root.join("tracked.txt"), "tracked").unwrap();
        git(&["add", "tracked.txt"]);
        git(&["commit", "--quiet", "-m", "fixture"]);
        git(&["checkout", "--quiet", "--detach"]);

        let status = service.git_status(&workspace.id).await.unwrap();
        assert!(status.repository);
        assert!(status.detached);
        assert!(status.branch.is_none());
        assert!(status.head.is_some());
    }

    #[tokio::test]
    async fn hides_placeholders_of_running_sandboxed_processes() {
        let directory = tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap().join("project");
        fs::create_dir(&root).unwrap();
        let database = Database::open(directory.path().join("pau.sqlite3"))
            .await
            .unwrap();
        let service =
            WorkspaceService::new(database.workspaces()).with_processes(database.processes());
        let workspace = service.open(&root, None).await.unwrap();
        let git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&root)
                .args(arguments)
                .output()
                .unwrap();
            assert!(output.status.success());
        };
        git(&["init", "--quiet"]);
        fs::write(root.join(".mcp.json"), "").unwrap();
        fs::create_dir(root.join(".claude")).unwrap();
        fs::write(root.join(".bashrc"), "export KEPT=1\n").unwrap();
        fs::write(root.join("notes.txt"), "notes").unwrap();
        let placeholders = [".mcp.json", ".claude", ".bashrc"]
            .map(|name| root.join(name).to_string_lossy().into_owned())
            .to_vec();
        let process = crate::persistence::ProcessMetadata {
            id: "sandboxed".to_owned(),
            workspace_id: Some(workspace.id.clone()),
            process_kind: "pi".to_owned(),
            native_session_id: None,
            started_at: "2026-09-27T00:00:00Z".to_owned(),
            ended_at: None,
            exit_code: None,
            sandbox_placeholders: placeholders,
        };
        database.processes().upsert(process.clone()).await.unwrap();
        let visible = TraversalOptions {
            include_hidden: true,
            include_ignored: true,
        };
        let names = |entries: Vec<FileEntry>| {
            entries
                .into_iter()
                .map(|entry| entry.path)
                .collect::<Vec<_>>()
        };

        let listed = names(service.list(&workspace.id, "", visible).await.unwrap());
        assert!(
            listed.contains(&".bashrc".to_owned()),
            "written placeholders stay visible"
        );
        assert!(listed.contains(&"notes.txt".to_owned()));
        assert!(!listed.contains(&".mcp.json".to_owned()));
        assert!(!listed.contains(&".claude".to_owned()));
        let changed = service.git_status(&workspace.id).await.unwrap().files;
        assert!(!changed.iter().any(|file| file.path == ".mcp.json"));
        assert!(changed.iter().any(|file| file.path == "notes.txt"));

        database
            .processes()
            .upsert(crate::persistence::ProcessMetadata {
                ended_at: Some("2026-09-27T01:00:00Z".to_owned()),
                ..process
            })
            .await
            .unwrap();
        let listed = names(service.list(&workspace.id, "", visible).await.unwrap());
        assert!(listed.contains(&".mcp.json".to_owned()));
    }

    #[tokio::test]
    async fn reads_text_and_binary_diffs_for_changed_files() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        let git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&root)
                .args(arguments)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        git(&["config", "user.name", "Pau Tests"]);
        git(&["config", "user.email", "pau@example.invalid"]);
        fs::write(root.join("changed.txt"), "before\nreplace me\n").unwrap();
        fs::write(root.join("deleted.txt"), "deleted\n").unwrap();
        fs::write(root.join("binary.dat"), b"before\0data").unwrap();
        git(&["add", "."]);
        git(&["commit", "--quiet", "-m", "fixture"]);

        fs::write(root.join("changed.txt"), "before\nreplacement\nadded\n").unwrap();
        fs::remove_file(root.join("deleted.txt")).unwrap();
        fs::write(root.join("binary.dat"), b"after\0data").unwrap();
        fs::write(root.join("new.txt"), "new\n").unwrap();

        let changed = service
            .git_diff(&workspace.id, "changed.txt")
            .await
            .unwrap();
        assert_eq!(changed.old_content.as_deref(), Some("before\nreplace me\n"));
        assert_eq!(
            changed.new_content.as_deref(),
            Some("before\nreplacement\nadded\n")
        );
        assert!(!changed.binary);

        let added = service.git_diff(&workspace.id, "new.txt").await.unwrap();
        assert_eq!(added.old_content.as_deref(), Some(""));
        assert_eq!(added.new_content.as_deref(), Some("new\n"));

        let deleted = service
            .git_diff(&workspace.id, "deleted.txt")
            .await
            .unwrap();
        assert_eq!(deleted.old_content.as_deref(), Some("deleted\n"));
        assert_eq!(deleted.new_content.as_deref(), Some(""));

        let binary = service.git_diff(&workspace.id, "binary.dat").await.unwrap();
        assert!(binary.binary);
        assert!(binary.old_content.is_none());
        assert!(binary.new_content.is_none());
    }

    #[tokio::test]
    async fn searches_visible_utf8_files_without_reading_sensitive_files() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        fs::write(root.join("main.rs"), "first\nfind me\n").unwrap();
        fs::write(root.join(".env"), "find me").unwrap();
        fs::write(root.join("ignored.txt"), "find me").unwrap();
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();

        let matches = service
            .search(&workspace.id, "find", TraversalOptions::default(), None)
            .await
            .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "main.rs");
        assert_eq!(matches[0].line, 2);
    }

    fn touch(root: &Path, relative: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "").unwrap();
    }

    fn paths(entries: &[FileEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    #[tokio::test]
    async fn ranks_name_matches_and_scopes_a_query_with_a_slash() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        for file in [
            "src/App.svelte",
            "src/lib/api.ts",
            "apple/core.rs",
            "snapper.rs",
            "docs/map-plan.md",
            "README.md",
        ] {
            touch(&root, file);
        }
        let search = |query: &'static str| {
            let service = &service;
            let id = workspace.id.clone();
            async move {
                service
                    .search_names(&id, query, TraversalOptions::default(), None)
                    .await
            }
        };

        let found = search("app").await.unwrap();
        assert_eq!(
            paths(&found),
            ["apple", "src/App.svelte", "snapper.rs", "docs/map-plan.md"]
        );
        assert_eq!(found[0].kind, FileEntryKind::Directory);
        assert_eq!(found[1].size, Some(0));
        assert_eq!(
            paths(&search("src/").await.unwrap()),
            ["src/lib", "src/App.svelte"]
        );
        assert_eq!(paths(&search("src/ap").await.unwrap()), ["src/App.svelte"]);
        assert_eq!(paths(&search("").await.unwrap()).len(), 5);
        assert!(search("missing/").await.unwrap().is_empty());
        assert!(search("zzz").await.unwrap().is_empty());
        assert!(matches!(
            search("../").await,
            Err(WorkspaceError::InvalidPath)
        ));
    }

    #[tokio::test]
    async fn leaves_out_hidden_ignored_and_credential_names_unless_asked() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        fs::write(root.join(".gitignore"), "*.log\n").unwrap();
        for file in ["notes.md", ".notes", "notes.log", ".env.notes"] {
            touch(&root, file);
        }
        let search = |include_hidden, include_ignored| {
            let options = TraversalOptions {
                include_hidden,
                include_ignored,
            };
            service.search_names(&workspace.id, "notes", options, None)
        };

        assert_eq!(paths(&search(false, false).await.unwrap()), ["notes.md"]);
        assert_eq!(
            paths(&search(true, false).await.unwrap()),
            ["notes.md", ".notes"]
        );
        assert_eq!(
            paths(&search(false, true).await.unwrap()),
            ["notes.md", "notes.log"]
        );
    }

    #[tokio::test]
    async fn returns_at_most_the_requested_number_of_names() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        for index in 0..60 {
            touch(&root, &format!("note{index}.md"));
        }
        let options = TraversalOptions::default();

        let three = service
            .search_names(&workspace.id, "note", options, Some(3))
            .await
            .unwrap();
        assert_eq!(paths(&three), ["note0.md", "note1.md", "note2.md"]);
        let default = service
            .search_names(&workspace.id, "note", options, None)
            .await
            .unwrap();
        assert_eq!(default.len(), DEFAULT_NAME_SEARCH_LIMIT);
    }

    #[tokio::test]
    async fn finds_a_deep_name_in_a_large_tree_and_stops_at_the_entry_budget() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        for index in 0..300 {
            touch(&root, &format!("pkg{index:03}/src/mod.rs"));
        }
        touch(&root, "pkg250/src/deep/nested/needle.rs");

        let found = service
            .search_names(&workspace.id, "needle", TraversalOptions::default(), None)
            .await
            .unwrap();
        assert_eq!(paths(&found), ["pkg250/src/deep/nested/needle.rs"]);

        let canonical = fs::canonicalize(&root).unwrap();
        let options = TraversalOptions::default();
        let all = search_names_in(&canonical, "mod", options, 1_000, usize::MAX, &[]).unwrap();
        assert_eq!(all.len(), 300);
        let cut = search_names_in(&canonical, "mod", options, 1_000, 100, &[]).unwrap();
        assert!(!cut.is_empty() && cut.len() < 50);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn never_follows_or_offers_links_that_leave_the_workspace() {
        let (directory, service, workspace) = fixture().await;
        let root = directory.path().join("project");
        let outside = directory.path().join("outside");
        touch(&outside, "plan-secret.md");
        touch(&root, "docs/plan.md");
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.join("plan-secret.md"), root.join("plan-out")).unwrap();
        std::os::unix::fs::symlink(root.join("docs/plan.md"), root.join("plan-in")).unwrap();
        let options = TraversalOptions::default();

        let found = service
            .search_names(&workspace.id, "plan", options, None)
            .await
            .unwrap();
        assert_eq!(paths(&found), ["plan-in", "docs/plan.md"]);
        assert_eq!(found[0].kind, FileEntryKind::Symlink);
        assert!(matches!(
            service
                .search_names(&workspace.id, "escape/", options, None)
                .await,
            Err(WorkspaceError::InvalidPath)
        ));
    }
}
