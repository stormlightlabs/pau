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
use ts_rs::TS;
use uuid::Uuid;

use crate::persistence::{Workspace, WorkspaceRepository};

const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 1_000;
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;

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
    /// File content is not valid UTF-8.
    InvalidEncoding,
    /// The requested operation expected another filesystem object type.
    WrongFileType,
    /// Persistence failed.
    Persistence(tokio_rusqlite::Error),
    /// Filesystem access failed.
    Io(io::Error),
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
            Self::InvalidEncoding => formatter.write_str("file is not valid UTF-8"),
            Self::WrongFileType => formatter.write_str("path has the wrong file type"),
            Self::Persistence(error) => write!(formatter, "workspace persistence failed: {error}"),
            Self::Io(error) => write!(formatter, "workspace file access failed: {error}"),
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

/// Root-confined file access backed by remembered workspace registrations.
#[derive(Clone)]
pub struct WorkspaceService {
    workspaces: WorkspaceRepository,
}

impl WorkspaceService {
    /// Creates a service around the application workspace repository.
    pub fn new(workspaces: WorkspaceRepository) -> Self {
        Self { workspaces }
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
            if is_sensitive(&relative) {
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
        entries.sort_by(|left, right| left.path.cmp(&right.path));
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
        let directory = Dir::open_ambient_dir(&root, ambient_authority())?;
        let bytes = directory.read(validate_relative(relative_path)?)?;
        let revision = revision(&bytes);
        let content = String::from_utf8(bytes).map_err(|_| WorkspaceError::InvalidEncoding)?;
        Ok(FileContent {
            path: relative_display(&root, &path)?,
            content,
            revision,
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
        let root = self.root(workspace_id).await?;
        reject_sensitive(relative_path)?;
        let path = confined_for_write(&root, relative_path)?;
        let relative = validate_relative(relative_path)?;
        let directory = Dir::open_ambient_dir(&root, ambient_authority())?;

        match directory.read(relative) {
            Ok(current) => {
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
        let mut matches = Vec::new();

        for item in walker(&root, options, None) {
            let item = item.map_err(|error| io::Error::other(error.to_string()))?;
            let Some(file_type) = item.file_type() else {
                continue;
            };
            if !file_type.is_file()
                || item
                    .metadata()
                    .is_ok_and(|metadata| metadata.len() > MAX_SEARCH_FILE_BYTES)
            {
                continue;
            }
            let relative = relative_display(&root, item.path())?;
            if is_sensitive(&relative) {
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

    async fn root(&self, workspace_id: &str) -> Result<PathBuf, WorkspaceError> {
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

fn is_sensitive(path: &str) -> bool {
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
}
