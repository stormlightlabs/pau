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
    time::{Duration, Instant, SystemTime},
};

use ignore::{
    WalkBuilder,
    gitignore::{Gitignore, GitignoreBuilder},
};
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{AccessKind, AccessMode, ModifyKind},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::workspace::{TraversalOptions, WorkspaceError, is_git_dir, is_sensitive, walker};

/// Quiet time that ends a batch. Editors that save through a temporary file
/// and Git operations that touch many files finish within it.
const QUIET: Duration = Duration::from_millis(150);
/// Longest a batch waits, so a process that writes without pause still
/// produces regular updates.
const MAX_BATCH_DELAY: Duration = Duration::from_secs(2);
/// Most paths one update lists. Larger bursts, such as a branch switch, mark
/// the update as truncated and clients reload everything they show.
const MAX_PATHS: usize = 500;
/// How often a workspace is rescanned once the system refuses more watches.
/// Each rescan also retries the missing watches.
const RESCAN_INTERVAL: Duration = Duration::from_secs(5);
/// Most entries one rescan compares in the workspace, and again in Git's
/// folders, so a huge tree costs a bounded walk. Changes past this many
/// entries reach clients only through the watches the system did grant.
const MAX_RESCAN_ENTRIES: usize = 20_000;
/// Whether each shown folder gets its own non-recursive watch. inotify and
/// kqueue spend one watch per folder, and a recursive watch would spend them
/// on ignored trees such as `target/` and `node_modules` too, until the
/// system limit makes it fail. FSEvents and Windows watch a whole tree for
/// the cost of one, so they keep a recursive watch on the root.
const PER_FOLDER: bool = !cfg!(any(target_os = "macos", windows));
/// What the file tree can show: hidden paths, but not ignored ones.
const SHOWN: TraversalOptions = TraversalOptions {
    include_hidden: true,
    include_ignored: false,
};

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
/// Dropping the watcher stops the batching thread, which owns the
/// operating-system watches, and joins it, so `on_change` is never called
/// afterwards.
pub struct WorkspaceWatcher {
    signals: mpsc::Sender<Signal>,
    thread: Option<JoinHandle<()>>,
}

impl WorkspaceWatcher {
    /// Starts watching `root`, which must be canonical, and calls `on_change`
    /// with each batch of changes from a background thread.
    ///
    /// A watch the system refuses does not fail the start. Past Linux's
    /// `max_user_watches`, the workspace is also rescanned every few seconds
    /// until the missing watches can be added. A folder refused for another
    /// reason, such as permissions, is left unwatched.
    pub fn start(
        root: &Path,
        on_change: impl FnMut(WorkspaceFileChanges) + Send + 'static,
    ) -> Result<Self, WorkspaceError> {
        let (signals, receiver) = mpsc::channel();
        let sender = signals.clone();
        // Following symlinks would let a link to a large folder outside the
        // workspace, such as the home folder, use up the system's watch
        // limit. The file tree does not follow them either.
        let watcher = RecommendedWatcher::new(
            move |event| {
                let _ = sender.send(Signal::Event(event));
            },
            Config::default().with_follow_symlinks(false),
        )
        .map_err(watch_error)?;
        let mut tracker = Tracker::start(watcher, root, PER_FOLDER);
        let thread = thread::Builder::new()
            .name("pau-workspace-watch".to_owned())
            .spawn(move || batch_events(&receiver, &mut tracker, on_change))?;
        Ok(Self {
            signals,
            thread: Some(thread),
        })
    }
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
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

/// Where a workspace keeps the Git state that counts as a branch change.
///
/// The `.git` file, `commondir`, and `.git/refs` can all be symlinks or name
/// any folder, such as `/` or the home folder. Only a real folder holding a
/// `HEAD` file counts as a Git directory, and only a `refs` folder that is
/// not a symlink is watched, so neither the watches nor the rescan walk can
/// leave Git's own folders.
#[derive(Clone)]
struct GitDirs {
    /// The worktree's own Git directory: `.git`, or the folder a linked
    /// worktree's `.git` file names. Its `HEAD`, `index`, and refs count.
    own: PathBuf,
    /// The shared Git directory a linked worktree's `commondir` file names.
    /// Branch refs and `packed-refs` live there, so a commit, amend, or reset
    /// in the worktree changes only this directory. Its `HEAD` and `index`
    /// belong to the main worktree and do not count.
    common: Option<PathBuf>,
}

impl GitDirs {
    fn find(root: &Path) -> Self {
        let own = linked_git_dir(root).unwrap_or_else(|| root.join(".git"));
        let common = fs::read_to_string(own.join("commondir"))
            .ok()
            .and_then(|common| fs::canonicalize(own.join(common.trim())).ok())
            .filter(|common| looks_like_git_dir(common));
        Self { own, common }
    }

    /// The Git folders whose changes count, each with the depth to watch.
    /// Only `refs` is watched recursively, so object writes and logs cost no
    /// watches.
    fn folders(&self) -> Vec<(PathBuf, RecursiveMode)> {
        [Some(&self.own), self.common.as_ref()]
            .into_iter()
            .flatten()
            .filter(|dir| looks_like_git_dir(dir))
            .flat_map(|dir| {
                let refs = dir.join("refs");
                let refs = is_real_dir(&refs).then_some((refs, RecursiveMode::Recursive));
                std::iter::once((dir.clone(), RecursiveMode::NonRecursive)).chain(refs)
            })
            .collect()
    }

    /// Whether `path` outside the workspace holds branch, index, or ref
    /// state.
    fn holds_state(&self, path: &Path) -> bool {
        if let Ok(name) = path.strip_prefix(&self.own) {
            return is_git_state(name);
        }
        let Some(name) = self
            .common
            .as_deref()
            .and_then(|common| path.strip_prefix(common).ok())
        else {
            return false;
        };
        is_git_state(name) && name != Path::new("HEAD") && name != Path::new("index")
    }
}

/// Reads the Git directory that a linked worktree's `.git` file names.
fn linked_git_dir(root: &Path) -> Option<PathBuf> {
    let pointer = fs::read_to_string(root.join(".git")).ok()?;
    let target = pointer.strip_prefix("gitdir:")?.trim();
    fs::canonicalize(root.join(target))
        .ok()
        .filter(|dir| looks_like_git_dir(dir))
}

/// Whether `path` is a folder itself rather than a symlink to one.
fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

/// Whether `dir` is a real folder with a `HEAD` file, as every Git directory
/// has.
fn looks_like_git_dir(dir: &Path) -> bool {
    is_real_dir(dir) && dir.join("HEAD").is_file()
}

/// The watches one workspace holds and the filter for their events. The
/// batching thread owns it, so watches change only between events.
struct Tracker<W> {
    watcher: W,
    filter: ChangeFilter,
    /// Whether each shown folder has its own watch, as [`PER_FOLDER`] says.
    per_folder: bool,
    /// Workspace folders with a non-recursive watch of their own. Empty when
    /// one recursive watch covers the root.
    folders: BTreeSet<PathBuf>,
    /// The other watches: Git's folders, and the recursive watch on the root
    /// when folders have no watches of their own.
    others: BTreeSet<PathBuf>,
    /// Set while the system refuses watches for its limit. The workspace is
    /// then rescanned on a timer, and each rescan retries the missing
    /// watches until they all succeed.
    rescan: Option<Rescan>,
    /// Whether a folder refused for a reason other than the limit has been
    /// logged, so a workspace full of them logs once.
    logged_skip: bool,
}

/// The last rescan's view of the workspace.
struct Rescan {
    due: Instant,
    seen: HashMap<PathBuf, Fingerprint>,
}

/// Modification time and size, enough to tell that an entry changed.
type Fingerprint = (Option<SystemTime>, u64);

/// What became of one watch request.
#[derive(PartialEq, Eq)]
enum Watched {
    Added,
    /// The folder is gone, or the system refused it for a reason of its own,
    /// such as permissions. Other folders can still be watched.
    Skipped,
    /// The system is out of watches, so later requests would fail too.
    Limited,
}

impl<W: Watcher> Tracker<W> {
    fn start(watcher: W, root: &Path, per_folder: bool) -> Self {
        let git = GitDirs::find(root);
        let mut tracker = Self {
            watcher,
            filter: ChangeFilter::new(root.to_path_buf(), git),
            per_folder,
            folders: BTreeSet::new(),
            others: BTreeSet::new(),
            rescan: None,
            logged_skip: false,
        };
        tracker.add_watches();
        tracker
    }

    /// Adds every watch the workspace needs that it does not hold yet, Git's
    /// folders first, and returns whether the system granted them all.
    fn add_watches(&mut self) -> bool {
        let root = self.filter.root.clone();
        for (folder, mode) in self.filter.git.folders() {
            // A recursive watch on the root already covers its `.git`.
            if (self.per_folder || !folder.starts_with(&root)) && !self.watch_other(&folder, mode) {
                return false;
            }
        }
        if self.per_folder {
            self.add_tree(&root, None)
        } else {
            self.watch_other(&root, RecursiveMode::Recursive)
        }
    }

    /// Adds a watch kept in `others`, and returns false when the system is
    /// out of watches.
    fn watch_other(&mut self, path: &Path, mode: RecursiveMode) -> bool {
        if self.others.contains(path) {
            return true;
        }
        match self.watch(path, mode) {
            Watched::Added => {
                self.others.insert(path.to_path_buf());
                true
            }
            Watched::Skipped => true,
            Watched::Limited => false,
        }
    }

    /// Applies one event: keeps folder watches current, then records what
    /// the event changed.
    fn handle(&mut self, batch: &mut Batch, event: notify::Result<Event>) {
        if let Ok(event) = &event {
            self.follow(event, batch);
        }
        batch.add(&mut self.filter, event);
    }

    /// Asks the system for a watch. Running out of watches starts rescans,
    /// and any other refusal skips the folder.
    fn watch(&mut self, path: &Path, mode: RecursiveMode) -> Watched {
        let error = match self.watcher.watch(path, mode) {
            Ok(()) => return Watched::Added,
            Err(_) if !path.exists() => return Watched::Skipped,
            Err(error) => error,
        };
        let limited = match &error.kind {
            notify::ErrorKind::MaxFilesWatch => true,
            notify::ErrorKind::Io(io) => io.kind() == std::io::ErrorKind::StorageFull,
            _ => false,
        };
        if limited {
            self.degrade(&error);
            return Watched::Limited;
        }
        if !self.logged_skip {
            self.logged_skip = true;
            tracing::warn!(
                event = "workspace.watch_skipped",
                path = %path.display(),
                %error,
                "the system refused a file watch; changes in that folder go unreported"
            );
        }
        Watched::Skipped
    }

    /// Watches `folder` and every shown folder below it that is not watched
    /// yet, and returns false when the system runs out of watches. The walk
    /// follows the file tree's rules, so ignored trees, Git's folder, and
    /// symlinked folders get no watches.
    ///
    /// With a `batch`, every shown entry the walk finds is recorded as
    /// changed. Each folder is watched before the walk reads it, so a file
    /// written into a new folder is either seen here or by its watch.
    fn add_tree(&mut self, folder: &Path, mut batch: Option<&mut Batch>) -> bool {
        let walk = walker(folder, SHOWN, None)
            .filter_entry(|entry| !is_git_dir(entry.file_name()))
            .build();
        for entry in walk.flatten() {
            let path = entry.path();
            if let Some(batch) = batch.as_deref_mut() {
                batch.add_path(&mut self.filter, path);
            }
            if !entry.file_type().is_some_and(|kind| kind.is_dir()) || self.folders.contains(path) {
                continue;
            }
            match self.watch(path, RecursiveMode::NonRecursive) {
                Watched::Added => {
                    self.folders.insert(path.to_path_buf());
                }
                Watched::Skipped => {}
                Watched::Limited => return false,
            }
        }
        true
    }

    /// Drops the watches on `folder` and every folder below it.
    fn remove_tree(&mut self, folder: &Path) {
        let gone: Vec<PathBuf> = self
            .folders
            .range(folder.to_path_buf()..)
            .take_while(|path| path.starts_with(folder))
            .cloned()
            .collect();
        for path in gone {
            // The system drops the watch of a deleted folder by itself.
            let _ = self.watcher.unwatch(&path);
            self.folders.remove(&path);
        }
    }

    /// Keeps one watch per shown folder as folders appear, move, and go, and
    /// records what a new folder already holds.
    fn follow(&mut self, event: &Event, batch: &mut Batch) {
        if !self.per_folder {
            return;
        }
        if event.need_rescan() {
            let root = self.filter.root.clone();
            self.add_tree(&root, None);
            return;
        }
        let moved = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        );
        for path in &event.paths {
            let parent_watched = path
                .parent()
                .is_some_and(|parent| self.folders.contains(parent));
            if is_ignore_file(path) {
                // A changed ignore file can show folders it used to hide.
                if let Some(parent) = path.parent().filter(|_| parent_watched) {
                    self.add_tree(parent, None);
                }
                continue;
            }
            if !moved {
                continue;
            }
            // A watch follows the folder, not its name, so a folder moved
            // away or replaced under the same name loses its watches and
            // whatever is there now is watched afresh.
            if self.folders.contains(path) {
                self.remove_tree(path);
            }
            if is_real_dir(path)
                && parent_watched
                && matches!(self.filter.classify(path), Some(Change::Path(_)))
            {
                self.add_tree(path, Some(batch));
            }
        }
    }

    /// Starts rescanning after the system runs out of watches, and logs it
    /// once.
    fn degrade(&mut self, error: &notify::Error) {
        if self.rescan.is_some() {
            return;
        }
        tracing::warn!(
            event = "workspace.watch_limit",
            %error,
            "the system is out of file watches; rescanning the workspace instead"
        );
        self.rescan = Some(Rescan {
            due: Instant::now() + RESCAN_INTERVAL,
            seen: self.snapshot(),
        });
    }

    fn rescan_due(&self) -> Option<Instant> {
        self.rescan.as_ref().map(|rescan| rescan.due)
    }

    /// Compares the workspace with the last rescan, when one is due, and
    /// records every entry that appeared, changed, or went. Then retries the
    /// missing watches, and stops rescanning once they all succeed.
    fn rescan(&mut self, batch: &mut Batch) {
        let Some(previous) = self.rescan.take_if(|rescan| Instant::now() >= rescan.due) else {
            return;
        };
        let seen = self.snapshot();
        let changed = seen
            .iter()
            .filter(|(path, fingerprint)| previous.seen.get(*path) != Some(fingerprint))
            .map(|(path, _)| path)
            .chain(
                previous
                    .seen
                    .keys()
                    .filter(|path| !seen.contains_key(*path)),
            );
        for path in changed {
            batch.add_path(&mut self.filter, path);
        }
        // Restored before the retry, so a refused watch does not log again.
        self.rescan = Some(Rescan {
            due: Instant::now() + RESCAN_INTERVAL,
            seen,
        });
        if self.add_watches() {
            self.rescan = None;
            tracing::info!(
                event = "workspace.watch_resumed",
                "file watches are available again; rescans stopped"
            );
        }
    }

    /// Fingerprints up to [`MAX_RESCAN_ENTRIES`] shown entries, and as many
    /// entries of the Git folders that hold branch state.
    fn snapshot(&self) -> HashMap<PathBuf, Fingerprint> {
        let tree = walker(&self.filter.root, SHOWN, None)
            .filter_entry(|entry| !is_git_dir(entry.file_name()))
            .build()
            .take(MAX_RESCAN_ENTRIES);
        let git = self
            .filter
            .git
            .folders()
            .into_iter()
            .flat_map(|(folder, mode)| {
                WalkBuilder::new(folder)
                    .standard_filters(false)
                    .follow_links(false)
                    .max_depth((mode == RecursiveMode::NonRecursive).then_some(1))
                    .build()
            })
            .take(MAX_RESCAN_ENTRIES);
        tree.chain(git)
            .flatten()
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                Some((
                    entry.into_path(),
                    (metadata.modified().ok(), metadata.len()),
                ))
            })
            .collect()
    }
}

/// Collects events until the workspace has been quiet for [`QUIET`], then
/// reports them as one batch. A workspace that is being rescanned also wakes
/// when its rescan is due.
fn batch_events<W: Watcher>(
    receiver: &mpsc::Receiver<Signal>,
    tracker: &mut Tracker<W>,
    mut on_change: impl FnMut(WorkspaceFileChanges),
) {
    loop {
        let mut batch = Batch::default();
        let first = match tracker.rescan_due() {
            Some(due) => receiver.recv_timeout(due.saturating_duration_since(Instant::now())),
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match first {
            Ok(Signal::Event(event)) => {
                tracker.handle(&mut batch, event);
                let started = Instant::now();
                loop {
                    let remaining = MAX_BATCH_DELAY.saturating_sub(started.elapsed());
                    if remaining.is_zero() {
                        break;
                    }
                    match receiver.recv_timeout(QUIET.min(remaining)) {
                        Ok(Signal::Event(event)) => tracker.handle(&mut batch, event),
                        Ok(Signal::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                        Err(RecvTimeoutError::Timeout) => break,
                    }
                }
            }
            Ok(Signal::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        tracker.rescan(&mut batch);
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
            self.add_path(filter, path);
        }
    }

    fn add_path(&mut self, filter: &mut ChangeFilter, path: &Path) {
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
    git: GitDirs,
    /// Matchers for each directory's `.gitignore` and `.ignore`, built on
    /// first use and dropped when either file changes.
    directories: HashMap<PathBuf, Gitignore>,
    /// The repository's `info/exclude` file and the user's global excludes.
    repository: [Gitignore; 2],
}

impl ChangeFilter {
    fn new(root: PathBuf, git: GitDirs) -> Self {
        let mut exclude = GitignoreBuilder::new(&root);
        exclude.add(root.join(".git/info/exclude"));
        let exclude = exclude.build().unwrap_or_else(|_| Gitignore::empty());
        let (global, _) = GitignoreBuilder::new(&root).build_global();
        Self {
            root,
            git,
            directories: HashMap::new(),
            repository: [exclude, global],
        }
    }

    fn classify(&mut self, path: &Path) -> Option<Change> {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return self.git.holds_state(path).then_some(Change::Git);
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
        if is_ignore_file(path) {
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

/// Whether a path names an ignore file, whose rules the tree applies to its
/// folder.
fn is_ignore_file(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".gitignore" | ".ignore")
    )
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::Receiver;

    use notify::{EventHandler, WatcherKind, event::CreateKind, event::RemoveKind};

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
        let mut filter = ChangeFilter::new(root.clone(), GitDirs::find(&root));
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
        let mut filter = ChangeFilter::new(root.clone(), GitDirs::find(&root));

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

    /// Records watches instead of asking the system. Refuses any past
    /// `limit` as Linux does past `max_user_watches`, and any `denied` path
    /// as it does a folder the user cannot read.
    #[derive(Default)]
    struct FakeWatcher {
        watched: BTreeSet<PathBuf>,
        limit: Option<usize>,
        denied: BTreeSet<PathBuf>,
    }

    impl Watcher for FakeWatcher {
        fn new<F: EventHandler>(_: F, _: Config) -> notify::Result<Self> {
            Ok(Self::default())
        }

        fn watch(&mut self, path: &Path, _: RecursiveMode) -> notify::Result<()> {
            if self.denied.contains(path) {
                return Err(notify::Error::io(std::io::Error::from(
                    std::io::ErrorKind::PermissionDenied,
                )));
            }
            if self.limit.is_some_and(|limit| self.watched.len() >= limit) {
                return Err(notify::Error::new(notify::ErrorKind::MaxFilesWatch));
            }
            self.watched.insert(path.to_path_buf());
            Ok(())
        }

        fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
            self.watched.remove(path);
            Ok(())
        }

        fn kind() -> WatcherKind {
            WatcherKind::NullWatcher
        }
    }

    fn tracked(root: &Path, limit: Option<usize>) -> Tracker<FakeWatcher> {
        let watcher = FakeWatcher {
            limit,
            ..FakeWatcher::default()
        };
        Tracker::start(watcher, root, true)
    }

    #[test]
    fn watches_shown_folders_but_none_inside_ignored_ones() {
        let (_directory, root, _watcher, _receiver) = watched();
        for index in 0..200 {
            fs::create_dir_all(root.join(format!("node_modules/pkg-{index}/lib"))).unwrap();
        }
        fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();

        let tracker = tracked(&root, None);

        assert_eq!(
            tracker.folders,
            BTreeSet::from([root.clone(), root.join("src")]),
        );
        assert!(
            tracker
                .watcher
                .watched
                .iter()
                .all(|path| !path.starts_with(root.join("node_modules"))),
            "watched an ignored folder: {:?}",
            tracker.watcher.watched
        );
        assert!(tracker.watcher.watched.contains(&root.join(".git/refs")));
    }

    #[test]
    fn watches_new_folders_and_drops_the_watches_of_removed_ones() {
        let (_directory, root, _watcher, _receiver) = watched();
        let mut tracker = tracked(&root, None);
        let mut batch = Batch::default();

        fs::create_dir_all(root.join("src/new/inner")).unwrap();
        let created =
            Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("src/new"));
        tracker.handle(&mut batch, Ok(created));
        assert!(tracker.watcher.watched.contains(&root.join("src/new")));
        assert!(
            tracker
                .watcher
                .watched
                .contains(&root.join("src/new/inner"))
        );

        fs::create_dir(root.join("target")).unwrap();
        let ignored =
            Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("target"));
        tracker.handle(&mut batch, Ok(ignored));
        assert!(!tracker.watcher.watched.contains(&root.join("target")));

        fs::remove_dir_all(root.join("src/new")).unwrap();
        let removed =
            Event::new(EventKind::Remove(RemoveKind::Folder)).add_path(root.join("src/new"));
        tracker.handle(&mut batch, Ok(removed));
        assert!(
            tracker
                .watcher
                .watched
                .iter()
                .all(|path| !path.starts_with(root.join("src/new")))
        );
        assert_eq!(batch.finish().unwrap().paths, ["src/new", "src/new/inner"]);
    }

    #[test]
    fn reports_files_written_into_a_new_folder() {
        let (_directory, root, _watcher, receiver) = watched();

        // Written at once, before the watcher can add the folder's watch.
        fs::create_dir(root.join("src/fresh")).unwrap();
        fs::write(root.join("src/fresh/first.rs"), "// first\n").unwrap();
        wait_for_path(&receiver, "src/fresh/first.rs");

        // Written once the folder's own watch is in place.
        fs::write(root.join("src/fresh/second.rs"), "// second\n").unwrap();
        wait_for_path(&receiver, "src/fresh/second.rs");
    }

    #[test]
    fn reports_what_a_new_folder_held_before_its_watch() {
        let (_directory, root, _watcher, _receiver) = watched();
        let mut tracker = tracked(&root, None);
        let mut batch = Batch::default();

        fs::create_dir_all(root.join("src/new/inner")).unwrap();
        fs::write(root.join("src/new/inner/early.rs"), "// early\n").unwrap();
        let created =
            Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("src/new"));
        tracker.handle(&mut batch, Ok(created));

        assert_eq!(
            batch.finish().unwrap().paths,
            ["src/new", "src/new/inner", "src/new/inner/early.rs"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_watches_git_folders_that_lead_outside_git() {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let outside = base.join("outside");
        for index in 0..50 {
            fs::create_dir_all(outside.join(format!("folder-{index}/refs"))).unwrap();
        }
        // `.git/refs` is a symlink to a large folder.
        let repository = base.join("repo");
        fs::create_dir_all(repository.join(".git")).unwrap();
        fs::write(repository.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::os::unix::fs::symlink(&outside, repository.join(".git/refs")).unwrap();
        // A linked worktree's `commondir` names a large folder that is not a
        // Git directory, though it has a `refs` folder.
        let linked_git_dir = repository.join(".git/worktrees/worktree");
        let worktree = base.join("worktree");
        fs::create_dir_all(&linked_git_dir).unwrap();
        fs::create_dir(&worktree).unwrap();
        fs::create_dir(outside.join("refs")).unwrap();
        fs::write(linked_git_dir.join("HEAD"), "ref: refs/heads/topic\n").unwrap();
        fs::write(
            linked_git_dir.join("commondir"),
            outside.display().to_string(),
        )
        .unwrap();
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", linked_git_dir.display()),
        )
        .unwrap();

        let refs = repository.join(".git/refs");
        for root in [&repository, &worktree] {
            let tracker = tracked(root, None);
            assert!(tracker.filter.git.common.is_none());
            let watched = &tracker.watcher.watched;
            assert!(
                watched
                    .iter()
                    .all(|path| !path.starts_with(&outside) && !path.starts_with(&refs)),
                "watched outside Git: {watched:?}"
            );
            // The rescan sees the `refs` link itself but not through it.
            let seen = tracker.snapshot();
            assert!(
                seen.keys().all(|path| !path.starts_with(&outside)
                    && (path == &refs || !path.starts_with(&refs))),
                "rescanned outside Git: {:?}",
                seen.keys()
            );
        }
    }

    #[test]
    fn skips_a_refused_folder_and_watches_the_rest() {
        let (_directory, root, _watcher, _receiver) = watched();
        fs::create_dir(root.join("private")).unwrap();
        let watcher = FakeWatcher {
            denied: BTreeSet::from([root.join("private")]),
            ..FakeWatcher::default()
        };
        let mut tracker = Tracker::start(watcher, &root, true);

        assert!(tracker.rescan.is_none(), "a refused folder started rescans");
        assert_eq!(
            tracker.folders,
            BTreeSet::from([root.clone(), root.join("src")]),
        );
        fs::create_dir(root.join("src/later")).unwrap();
        let created =
            Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("src/later"));
        tracker.handle(&mut Batch::default(), Ok(created));
        assert!(tracker.folders.contains(&root.join("src/later")));
    }

    #[test]
    fn returns_to_watches_once_the_system_grants_them() {
        let (_directory, root, _watcher, _receiver) = watched();
        let mut tracker = tracked(&root, Some(1));
        assert!(tracker.rescan.is_some());

        // A new folder is watched while rescans run, when the system can.
        tracker.watcher.limit = Some(2);
        fs::create_dir(root.join("later")).unwrap();
        let created =
            Event::new(EventKind::Create(CreateKind::Folder)).add_path(root.join("later"));
        tracker.handle(&mut Batch::default(), Ok(created));
        assert!(tracker.folders.contains(&root.join("later")));
        assert!(tracker.rescan.is_some());

        // A due rescan that still hits the limit keeps rescanning.
        if let Some(rescan) = &mut tracker.rescan {
            rescan.due = Instant::now();
        }
        tracker.rescan(&mut Batch::default());
        assert!(tracker.rescan.is_some());

        tracker.watcher.limit = None;
        if let Some(rescan) = &mut tracker.rescan {
            rescan.due = Instant::now();
        }
        tracker.rescan(&mut Batch::default());
        assert!(tracker.rescan.is_none(), "rescans did not stop");
        assert_eq!(
            tracker.folders,
            BTreeSet::from([root.clone(), root.join("later"), root.join("src")]),
        );
    }

    #[test]
    fn rescans_instead_of_failing_when_the_watch_limit_is_reached() {
        let (_directory, root, _watcher, _receiver) = watched();
        let mut tracker = tracked(&root, Some(1));
        assert!(
            tracker.rescan.is_some(),
            "the refused watch did not start rescans"
        );

        fs::write(root.join("src/later.rs"), "// later\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "ignored").unwrap();
        if let Some(rescan) = &mut tracker.rescan {
            rescan.due = Instant::now();
        }
        let mut batch = Batch::default();
        tracker.rescan(&mut batch);

        let changes = batch.finish().expect("the rescan found no change");
        assert!(
            changes.paths.contains(&"src/later.rs".to_owned()),
            "{changes:?}"
        );
        assert!(
            changes
                .paths
                .iter()
                .all(|path| !path.starts_with("node_modules"))
        );
    }

    #[test]
    fn reports_ref_changes_in_a_linked_worktrees_common_directory() {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let common = base.join("repo/.git");
        let linked_git_dir = common.join("worktrees/worktree");
        let worktree = base.join("worktree");
        fs::create_dir_all(common.join("refs/heads")).unwrap();
        fs::write(common.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(&linked_git_dir).unwrap();
        fs::create_dir(&worktree).unwrap();
        fs::write(linked_git_dir.join("HEAD"), "ref: refs/heads/topic\n").unwrap();
        fs::write(linked_git_dir.join("commondir"), "../..\n").unwrap();
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", linked_git_dir.display()),
        )
        .unwrap();

        let mut filter = ChangeFilter::new(worktree.clone(), GitDirs::find(&worktree));
        assert_eq!(
            filter.classify(&common.join("packed-refs")),
            Some(Change::Git)
        );
        assert_eq!(filter.classify(&common.join("HEAD")), None);
        assert_eq!(filter.classify(&common.join("ORIG_HEAD")), None);
        assert_eq!(filter.classify(&common.join("logs/refs/heads/topic")), None);
        assert_eq!(filter.classify(&common.join("refs/heads/topic.lock")), None);

        let (_watcher, changes) = watch(&worktree);
        fs::write(common.join("refs/heads/topic"), "0123456789abcdef\n").unwrap();
        wait_for_git(&changes);
    }
}
