//! Placeholders that sandbox-runtime creates for absent protected paths.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Files that sandbox-runtime 0.0.77 denies for writes in the current
/// directory.
pub(super) const RUNTIME_DANGEROUS_FILES: &[&str] = &[
    ".gitconfig",
    ".gitmodules",
    ".bashrc",
    ".bash_profile",
    ".zshrc",
    ".zprofile",
    ".profile",
    ".ripgreprc",
    ".mcp.json",
];

/// Directories that sandbox-runtime 0.0.77 denies for writes in the current
/// directory.
pub(super) const RUNTIME_DANGEROUS_DIRECTORIES: &[&str] =
    &[".vscode", ".idea", ".claude/commands", ".claude/agents"];

/// Predicts the placeholders sandbox-runtime 0.0.77 creates for absent
/// write-denied workspace paths: Pau's protected paths and the runtime's own
/// list, which it applies to the current directory of the process that
/// wraps commands. Pau starts that process in the workspace. The boundary
/// fixtures compare this prediction with a real launch.
///
/// Bubblewrap can deny an absent path only by mounting over a placeholder.
/// The runtime places it at the first missing component: an empty file for
/// the denied path itself, or an empty directory for a missing parent. A path
/// under an existing file can never be created, so it gets none.
pub(super) fn predict_placeholders(workspace: &Path, protected: &[PathBuf]) -> Vec<PathBuf> {
    let runtime = RUNTIME_DANGEROUS_FILES
        .iter()
        .chain(RUNTIME_DANGEROUS_DIRECTORIES)
        .map(|entry| workspace.join(entry));
    let mut placeholders = Vec::new();
    for candidate in protected.iter().cloned().chain(runtime) {
        if candidate.symlink_metadata().is_ok() {
            continue;
        }
        let mut first_missing = candidate.as_path();
        let mut blocked = false;
        let mut current = candidate.parent();
        while let Some(parent) = current {
            match parent.symlink_metadata() {
                Ok(metadata) => {
                    blocked = !metadata.is_dir();
                    break;
                }
                Err(_) => first_missing = parent,
            }
            current = parent.parent();
        }
        let first_missing = first_missing.to_path_buf();
        if !blocked
            && first_missing.starts_with(workspace)
            && !placeholders.contains(&first_missing)
        {
            placeholders.push(first_missing);
        }
    }
    placeholders.sort();
    placeholders
}

/// Whether `path` still looks like a placeholder: an empty file or an empty
/// directory. Anything with content belongs to the operator.
pub fn is_placeholder(path: &Path) -> bool {
    match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() => metadata.len() == 0,
        Ok(metadata) if metadata.is_dir() => {
            fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
        }
        _ => false,
    }
}

/// Removes recorded placeholders that a crashed sandbox left behind.
///
/// Only empty files and empty directories are removed, so a file the
/// operator has since written survives. Returns the removed paths.
pub fn remove_placeholders(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths
        .iter()
        .filter(|path| is_placeholder(path))
        .filter(|path| {
            let removed = if path.is_dir() {
                fs::remove_dir(path)
            } else {
                fs::remove_file(path)
            };
            removed.is_ok()
        })
        .cloned()
        .collect()
}

/// Counts the sandboxes running in each workspace, so their placeholders
/// outlive every sandbox that relies on them.
///
/// A placeholder belongs to the workspace, not to the sandbox that created
/// it. A sandbox that starts while another's placeholder exists predicts no
/// placeholder there, yet on Linux its deny rule is a mount on that path.
/// Unlinking a mount point detaches the mount in every namespace, so removing
/// the placeholder while that sandbox runs would lift its deny. Pau therefore
/// removes a workspace's placeholders only when its last sandbox exits.
///
/// Clones share the count. One instance must cover every kind of sandboxed
/// process in a workspace, terminals and agent sessions alike.
#[derive(Clone, Debug, Default)]
pub struct PlaceholderUsers(Arc<Mutex<HashMap<String, WorkspacePlaceholders>>>);

#[derive(Debug, Default)]
struct WorkspacePlaceholders {
    users: usize,
    placeholders: BTreeSet<PathBuf>,
}

impl PlaceholderUsers {
    /// Records a sandbox about to start in `workspace_id` that may create
    /// `placeholders`. Dropping the returned lease records its exit.
    pub fn enter(&self, workspace_id: &str, placeholders: &[PathBuf]) -> PlaceholderLease {
        let mut workspaces = self.0.lock().expect("placeholder users lock poisoned");
        let workspace = workspaces.entry(workspace_id.to_owned()).or_default();
        workspace.users += 1;
        workspace.placeholders.extend(placeholders.iter().cloned());
        PlaceholderLease {
            users: self.clone(),
            workspace_id: workspace_id.to_owned(),
        }
    }

    /// Whether a sandbox is running in `workspace_id`.
    pub fn in_use(&self, workspace_id: &str) -> bool {
        self.0
            .lock()
            .expect("placeholder users lock poisoned")
            .contains_key(workspace_id)
    }

    fn leave(&self, workspace_id: &str) {
        let mut workspaces = self.0.lock().expect("placeholder users lock poisoned");
        let Some(workspace) = workspaces.get_mut(workspace_id) else {
            return;
        };
        workspace.users -= 1;
        if workspace.users == 0 {
            let workspace = workspaces
                .remove(workspace_id)
                .expect("the workspace entry exists");
            // Removed under the lock, so a sandbox entering now cannot
            // predict a placeholder that is about to disappear.
            remove_placeholders(&workspace.placeholders.into_iter().collect::<Vec<_>>());
        }
    }
}

/// One running sandbox counted by [`PlaceholderUsers`]. Dropping it records
/// that the sandbox has exited, and the last lease in a workspace removes the
/// placeholders recorded there.
#[derive(Debug)]
pub struct PlaceholderLease {
    users: PlaceholderUsers,
    workspace_id: String,
}

impl Drop for PlaceholderLease {
    fn drop(&mut self) {
        self.users.leave(&self.workspace_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::fixtures::fixture;

    #[test]
    fn removes_only_empty_placeholders() {
        let fixture = fixture();
        let empty_file = fixture.workspace.join(".mcp.json");
        let empty_directory = fixture.workspace.join(".claude");
        let written = fixture.workspace.join(".bashrc");
        fs::write(&empty_file, "").unwrap();
        fs::create_dir(&empty_directory).unwrap();
        fs::write(&written, "export KEEP=1\n").unwrap();
        let removed = remove_placeholders(&[
            empty_file.clone(),
            empty_directory.clone(),
            written.clone(),
            fixture.workspace.join("missing"),
        ]);
        assert_eq!(removed, [empty_file.clone(), empty_directory.clone()]);
        assert!(!empty_file.exists() && !empty_directory.exists());
        assert!(written.exists());
    }
}
