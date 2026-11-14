//! File watching for open workspaces.
//!
//! A [`WorkspaceWatcher`] reports what changed on disk so clients can refresh
//! the file tree, Git status, and open files without polling. It reports only
//! paths the file tree would show by default: paths excluded by Git and ignore
//! files, credential files, and Git's internal files are dropped. Changes to
//! Git's branch, index, and refs still count, so branch state stays current.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Component, Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{AccessKind, AccessMode},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::workspace::{WorkspaceError, is_sensitive};

/// Quiet time that ends a batch. Editors that save through a temporary file
/// and Git operations that touch many files finish within it.
const QUIET: Duration = Duration::from_millis(150);
/// Longest a batch waits, so a process that writes without pause still
/// produces regular updates.
const MAX_BATCH_DELAY: Duration = Duration::from_secs(2);
/// Most paths one update lists. Larger bursts, such as a branch switch, mark
/// the update as truncated and clients reload everything they show.
const MAX_PATHS: usize = 500;

/// Paths that changed on disk in one watched workspace.
///
/// One update covers a burst of changes. The server sends it as the payload
/// of a `workspace_files_changed` event.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct WorkspaceFileChanges {
    /// Workspace-relative paths that were created, changed, renamed, or
    /// removed, in sorted order. Empty when `truncated` is set.
    pub paths: Vec<String>,
    /// Whether Git's branch, index, or refs changed, so branch and
    /// changed-file state may differ even when `paths` is empty.
    pub git: bool,
    /// Whether more paths changed than one update lists. Clients reload every
    /// listing and file they show.
    pub truncated: bool,
}

enum Signal {
    Event(notify::Result<Event>),
    Stop,
}

/// Watches one workspace root until dropped.
///
/// Dropping the watcher stops the operating-system watch and joins the thread
/// that batches events, so `on_change` is never called afterwards.
pub struct WorkspaceWatcher {
    watcher: Option<RecommendedWatcher>,
    signals: mpsc::Sender<Signal>,
    thread: Option<JoinHandle<()>>,
}

impl WorkspaceWatcher {
    /// Starts watching `root`, which must be canonical, and calls `on_change`
    /// with each batch of changes from a background thread.
    pub fn start(
        root: &Path,
        on_change: impl FnMut(WorkspaceFileChanges) + Send + 'static,
    ) -> Result<Self, WorkspaceError> {
        let (signals, receiver) = mpsc::channel();
        let sender = signals.clone();
        // Following symlinks would let a link to a large folder outside the
        // workspace, such as the home folder, use up the system's watch
        // limit. The file tree does not follow them either.
        let mut watcher = RecommendedWatcher::new(
            move |event| {
                let _ = sender.send(Signal::Event(event));
            },
            Config::default().with_follow_symlinks(false),
        )
        .map_err(watch_error)?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(watch_error)?;
        // A linked worktree keeps HEAD and its index outside the workspace.
        let linked_git_dir = linked_git_dir(root);
        if let Some(git_dir) = &linked_git_dir {
            watcher
                .watch(git_dir, RecursiveMode::NonRecursive)
                .map_err(watch_error)?;
        }

        let mut filter = ChangeFilter::new(root.to_path_buf(), linked_git_dir);
        let thread = thread::Builder::new()
            .name("pau-workspace-watch".to_owned())
            .spawn(move || batch_events(&receiver, &mut filter, on_change))?;
        Ok(Self {
            watcher: Some(watcher),
            signals,
            thread: Some(thread),
        })
    }
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        self.watcher.take();
        let _ = self.signals.send(Signal::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn watch_error(error: notify::Error) -> WorkspaceError {
    match error.kind {
        notify::ErrorKind::Io(error) => WorkspaceError::Io(error),
        _ => WorkspaceError::Io(std::io::Error::other(error.to_string())),
    }
}

/// Reads the Git directory that a linked worktree's `.git` file names.
fn linked_git_dir(root: &Path) -> Option<PathBuf> {
    let pointer = fs::read_to_string(root.join(".git")).ok()?;
    let target = pointer.strip_prefix("gitdir:")?.trim();
    fs::canonicalize(root.join(target)).ok()
}

/// Collects events until the workspace has been quiet for [`QUIET`], then
/// reports them as one batch.
fn batch_events(
    receiver: &mpsc::Receiver<Signal>,
    filter: &mut ChangeFilter,
    mut on_change: impl FnMut(WorkspaceFileChanges),
) {
    loop {
        let mut batch = Batch::default();
        match receiver.recv() {
            Ok(Signal::Event(event)) => batch.add(filter, event),
            Ok(Signal::Stop) | Err(_) => return,
        }
        let started = Instant::now();
        loop {
            let remaining = MAX_BATCH_DELAY.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(QUIET.min(remaining)) {
                Ok(Signal::Event(event)) => batch.add(filter, event),
                Ok(Signal::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => break,
            }
        }
        if let Some(changes) = batch.finish() {
            on_change(changes);
        }
    }
}

#[derive(Default)]
struct Batch {
    paths: BTreeSet<String>,
    git: bool,
    truncated: bool,
}

impl Batch {
    fn add(&mut self, filter: &mut ChangeFilter, event: notify::Result<Event>) {
        let event = match event {
            Ok(event) => event,
            // The watcher lost events, so no path list is complete.
            Err(_) => {
                self.truncate();
                return;
            }
        };
        if event.need_rescan() {
            self.truncate();
            return;
        }
        // Reading a file is not a change. Counting it would make every
        // refresh trigger another one.
        if matches!(event.kind, EventKind::Access(kind) if kind != AccessKind::Close(AccessMode::Write))
        {
            return;
        }
        for path in &event.paths {
            match filter.classify(path) {
                Some(Change::Git) => self.git = true,
                Some(Change::Path(relative)) if !self.truncated => {
                    self.paths.insert(relative);
                    if self.paths.len() > MAX_PATHS {
                        self.truncate();
                    }
                }
                _ => {}
            }
        }
    }

    fn truncate(&mut self) {
        self.truncated = true;
        self.paths.clear();
    }

    fn finish(self) -> Option<WorkspaceFileChanges> {
        (self.truncated || self.git || !self.paths.is_empty()).then(|| WorkspaceFileChanges {
            paths: self.paths.into_iter().collect(),
            git: self.git,
            truncated: self.truncated,
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Change {
    /// A workspace-relative path the file tree shows.
    Path(String),
    /// Git branch, index, or ref state.
    Git,
}

/// Decides which event paths clients hear about, using the same Git and
/// ignore-file rules as the file tree.
struct ChangeFilter {
    root: PathBuf,
    linked_git_dir: Option<PathBuf>,
    /// Matchers for each directory's `.gitignore` and `.ignore`, built on
    /// first use and dropped when either file changes.
    directories: HashMap<PathBuf, Gitignore>,
    /// The repository's `info/exclude` file and the user's global excludes.
    repository: [Gitignore; 2],
}

impl ChangeFilter {
    fn new(root: PathBuf, linked_git_dir: Option<PathBuf>) -> Self {
        let mut exclude = GitignoreBuilder::new(&root);
        exclude.add(root.join(".git/info/exclude"));
        let exclude = exclude.build().unwrap_or_else(|_| Gitignore::empty());
        let (global, _) = GitignoreBuilder::new(&root).build_global();
        Self {
            root,
            linked_git_dir,
            directories: HashMap::new(),
            repository: [exclude, global],
        }
    }

    fn classify(&mut self, path: &Path) -> Option<Change> {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            let git_dir = self.linked_git_dir.as_deref()?;
            let name = path.strip_prefix(git_dir).ok()?;
            return is_git_state(name).then_some(Change::Git);
        };
        if let Some(Component::Normal(first)) = relative.components().next()
            && first == ".git"
        {
            let name = relative.strip_prefix(".git").ok()?;
            return is_git_state(name).then_some(Change::Git);
        }
        let display = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if display.is_empty() || is_sensitive(&display) {
            return None;
        }
        if matches!(
            relative.file_name().and_then(|name| name.to_str()),
            Some(".gitignore" | ".ignore")
        ) {
            self.directories.remove(path.parent().unwrap_or(&self.root));
        }
        if self.is_ignored(path) {
            return None;
        }
        Some(Change::Path(display))
    }

    /// Checks the path's folders from the top down, then the path itself, so
    /// anything inside an ignored folder is ignored.
    fn is_ignored(&mut self, path: &Path) -> bool {
        let candidates: Vec<PathBuf> = path
            .ancestors()
            .take_while(|ancestor| *ancestor != self.root)
            .map(Path::to_path_buf)
            .collect();
        candidates.iter().rev().any(|candidate| {
            let is_dir = candidate != path || path.is_dir();
            self.matches(candidate, is_dir)
        })
    }

    /// Applies the nearest matching rule, as Git does: deeper ignore files
    /// win, then the repository's excludes, then the global excludes.
    fn matches(&mut self, path: &Path, is_dir: bool) -> bool {
        let Some(parent) = path.parent() else {
            return false;
        };
        for directory in parent.ancestors() {
            if !directory.starts_with(&self.root) {
                break;
            }
            let matcher = self
                .directories
                .entry(directory.to_path_buf())
                .or_insert_with(|| directory_matcher(directory));
            let found = matcher.matched(path, is_dir);
            if found.is_ignore() {
                return true;
            }
            if found.is_whitelist() {
                return false;
            }
        }
        for matcher in &self.repository {
            let found = matcher.matched(path, is_dir);
            if !found.is_none() {
                return found.is_ignore();
            }
        }
        false
    }
}

fn directory_matcher(directory: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(directory);
    builder.add(directory.join(".gitignore"));
    builder.add(directory.join(".ignore"));
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

/// Whether a path inside a Git directory holds branch, index, or ref state.
/// Object writes, logs, and lock files churn during every Git command and
/// say nothing on their own.
fn is_git_state(name: &Path) -> bool {
    if name
        .extension()
        .is_some_and(|extension| extension == "lock")
    {
        return false;
    }
    name == Path::new("HEAD")
        || name == Path::new("index")
        || name == Path::new("packed-refs")
        || name.starts_with("refs")
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::Receiver;

    use super::*;

    /// Upper bound for the operating system to report a change. Tests wait
    /// for an expected update and return as soon as it arrives.
    const EVENT_WAIT: Duration = Duration::from_secs(10);

    fn watched() -> (
        tempfile::TempDir,
        PathBuf,
        WorkspaceWatcher,
        Receiver<WorkspaceFileChanges>,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        fs::write(root.join(".gitignore"), "node_modules/\ntarget/\n*.log\n").unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        let (watcher, receiver) = watch(&root);
        (directory, root, watcher, receiver)
    }

    fn watch(root: &Path) -> (WorkspaceWatcher, Receiver<WorkspaceFileChanges>) {
        let (sender, receiver) = mpsc::channel();
        let watcher = WorkspaceWatcher::start(root, move |changes| {
            let _ = sender.send(changes);
        })
        .unwrap();
        (watcher, receiver)
    }

    /// Waits for an update that lists `path`, skipping earlier updates such
    /// as the fixture's own setup arriving late.
    fn wait_for_path(
        receiver: &Receiver<WorkspaceFileChanges>,
        path: &str,
    ) -> WorkspaceFileChanges {
        let deadline = Instant::now() + EVENT_WAIT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let changes = receiver
                .recv_timeout(remaining)
                .unwrap_or_else(|_| panic!("no update listed {path}"));
            if changes.paths.iter().any(|changed| changed == path) {
                return changes;
            }
        }
    }

    /// Waits for an update that says Git state changed.
    fn wait_for_git(receiver: &Receiver<WorkspaceFileChanges>) {
        let deadline = Instant::now() + EVENT_WAIT;
        while !receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("no update reported a Git change")
            .git
        {}
    }

    #[test]
    fn reports_created_changed_renamed_and_removed_files() {
        let (_directory, root, _watcher, receiver) = watched();

        fs::write(root.join("src/new.rs"), "// new\n").unwrap();
        wait_for_path(&receiver, "src/new.rs");

        fs::write(root.join("src/main.rs"), "fn main() { println!(); }\n").unwrap();
        wait_for_path(&receiver, "src/main.rs");

        fs::rename(root.join("src/new.rs"), root.join("src/renamed.rs")).unwrap();
        let renamed = wait_for_path(&receiver, "src/renamed.rs");
        if !renamed.paths.contains(&"src/new.rs".to_owned()) {
            wait_for_path(&receiver, "src/new.rs");
        }

        fs::remove_file(root.join("src/renamed.rs")).unwrap();
        wait_for_path(&receiver, "src/renamed.rs");
    }

    #[test]
    fn batches_a_burst_into_one_update() {
        let (_directory, root, _watcher, receiver) = watched();
        for index in 0..40 {
            fs::write(root.join(format!("src/file-{index}.rs")), "// burst\n").unwrap();
        }

        let changes = wait_for_path(&receiver, "src/file-0.rs");
        let listed = (0..40)
            .filter(|index| changes.paths.contains(&format!("src/file-{index}.rs")))
            .count();
        assert_eq!(listed, 40, "one update lists the whole burst: {changes:?}");
    }

    #[test]
    fn truncates_bursts_larger_than_one_update_lists() {
        let mut batch = Batch::default();
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let mut filter = ChangeFilter::new(root.clone(), None);
        let event = (0..=MAX_PATHS).fold(Event::new(EventKind::Any), |event, index| {
            event.add_path(root.join(format!("file-{index}")))
        });
        batch.add(&mut filter, Ok(event));

        let changes = batch.finish().unwrap();
        assert!(changes.truncated);
        assert!(changes.paths.is_empty());
    }

    #[test]
    fn skips_ignored_sensitive_and_git_internal_paths() {
        let (_directory, root, _watcher, receiver) = watched();
        fs::write(root.join("node_modules/pkg/index.js"), "ignored").unwrap();
        fs::create_dir(root.join("target")).unwrap();
        fs::write(root.join("target/out"), "ignored").unwrap();
        fs::write(root.join("build.log"), "ignored").unwrap();
        fs::write(root.join(".env"), "SECRET=1").unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join(".git/objects/blob"), "object").unwrap();
        // A visible file written last marks the end of the sequence.
        fs::write(root.join("src/visible.rs"), "// visible\n").unwrap();

        let mut seen = wait_for_path(&receiver, "src/visible.rs").paths;
        seen.extend(receiver.try_iter().flat_map(|changes| changes.paths));
        for path in &seen {
            assert!(
                [
                    "src/visible.rs",
                    "src",
                    "target",
                    ".gitignore",
                    "src/main.rs"
                ]
                .contains(&path.as_str()),
                "reported a path the tree hides: {path}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn skips_changes_behind_a_symlinked_folder() {
        let outside = tempfile::tempdir().unwrap();
        let outside_root = fs::canonicalize(outside.path()).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        std::os::unix::fs::symlink(&outside_root, root.join("linked")).unwrap();
        let (_watcher, receiver) = watch(&root);
        fs::write(outside_root.join("outside.txt"), "outside").unwrap();
        // A visible file written last marks the end of the sequence.
        fs::write(root.join("visible.txt"), "visible").unwrap();

        let mut seen = wait_for_path(&receiver, "visible.txt").paths;
        seen.extend(receiver.try_iter().flat_map(|changes| changes.paths));
        assert!(
            seen.iter().all(|path| !path.starts_with("linked/")),
            "followed the symlink: {seen:?}"
        );
    }

    #[test]
    fn reports_branch_changes_in_the_git_directory_and_a_linked_worktree() {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let repository = base.join("repo");
        let worktree = base.join("worktree");
        let linked_git_dir = repository.join(".git/worktrees/worktree");
        fs::create_dir_all(&linked_git_dir).unwrap();
        fs::create_dir(&worktree).unwrap();
        fs::write(repository.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(linked_git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", linked_git_dir.display()),
        )
        .unwrap();
        let (_repository_watcher, repository_changes) = watch(&repository);
        let (_worktree_watcher, worktree_changes) = watch(&worktree);

        fs::write(repository.join(".git/HEAD"), "ref: refs/heads/topic\n").unwrap();
        wait_for_git(&repository_changes);
        fs::write(linked_git_dir.join("HEAD"), "ref: refs/heads/topic\n").unwrap();
        wait_for_git(&worktree_changes);
    }

    #[test]
    fn classifies_git_state_and_nested_ignore_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        fs::create_dir_all(root.join("app/cache")).unwrap();
        fs::write(root.join("app/.gitignore"), "cache/\n!keep.log\n").unwrap();
        fs::write(root.join(".gitignore"), "*.log\n").unwrap();
        let mut filter = ChangeFilter::new(root.clone(), None);

        assert_eq!(filter.classify(&root.join(".git/HEAD")), Some(Change::Git));
        assert_eq!(
            filter.classify(&root.join(".git/refs/heads/main")),
            Some(Change::Git)
        );
        assert_eq!(filter.classify(&root.join(".git/index.lock")), None);
        assert_eq!(filter.classify(&root.join(".git/objects/ab/cd")), None);
        assert_eq!(filter.classify(&root.join("app/cache/data")), None);
        assert_eq!(filter.classify(&root.join("app/debug.log")), None);
        assert_eq!(
            filter.classify(&root.join("app/keep.log")),
            Some(Change::Path("app/keep.log".to_owned()))
        );
        assert_eq!(filter.classify(&root.join(".env.local")), None);
    }

    #[test]
    fn stops_reporting_once_dropped() {
        let (_directory, root, watcher, receiver) = watched();
        drop(watcher);
        fs::write(root.join("src/after.rs"), "// after\n").unwrap();

        // Dropping joins the batching thread, which owned the only sender.
        let remaining: Vec<_> = receiver.try_iter().collect();
        assert!(
            remaining
                .iter()
                .all(|changes| !changes.paths.contains(&"src/after.rs".to_owned()))
        );
        assert_eq!(
            receiver.recv_timeout(EVENT_WAIT),
            Err(RecvTimeoutError::Disconnected)
        );
    }
}
