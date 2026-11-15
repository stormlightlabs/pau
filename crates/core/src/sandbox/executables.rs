//! Containment executables pinned when Pau starts.

use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{SandboxAdapter, SandboxError};

/// Oldest Bubblewrap release whose behavior Pau has verified.
const MINIMUM_BUBBLEWRAP: (u64, u64) = (0, 11);

/// One containment executable resolved at startup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxExecutable {
    /// Executable name.
    pub name: String,
    /// Absolute path used for every launch.
    pub path: String,
    /// Reported version, when the executable reports one.
    pub version: Option<String>,
}

/// Containment executables pinned once when Pau starts.
///
/// sandbox-runtime would otherwise look each one up on `PATH` for every
/// command, so a directory added to `PATH` later could replace Bubblewrap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxExecutables {
    pub(super) platform: SandboxPlatform,
    pub(super) bubblewrap: Option<SandboxExecutable>,
    pub(super) socat: Option<SandboxExecutable>,
    pub(super) ripgrep: SandboxExecutable,
    /// sandbox-runtime's command-line launcher, which sandboxed terminals
    /// need. Agent tools start the runtime from Node instead, so a missing
    /// `srt` disables only terminals.
    pub(super) srt: Option<SandboxExecutable>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SandboxPlatform {
    /// Bubblewrap, network namespaces, and seccomp.
    Linux,
    /// Seatbelt.
    MacOs,
}

impl SandboxExecutables {
    /// Resolves the executables from `search_path` and checks the Bubblewrap
    /// version. Fails when the platform has no supported sandbox.
    pub fn resolve(search_path: &OsStr) -> Result<Self, SandboxError> {
        let platform = match std::env::consts::OS {
            "linux" => SandboxPlatform::Linux,
            "macos" => SandboxPlatform::MacOs,
            other => return Err(SandboxError::UnsupportedPlatform(other.to_owned())),
        };
        let ripgrep = required_executable("rg", search_path)?;
        let srt = required_executable("srt", search_path).ok();
        if platform == SandboxPlatform::MacOs {
            return Ok(Self {
                platform,
                bubblewrap: None,
                socat: None,
                ripgrep,
                srt,
            });
        }
        let mut bubblewrap = required_executable("bwrap", search_path)?;
        let version = executable_version(Path::new(&bubblewrap.path), search_path)
            .ok_or_else(|| SandboxError::Executable("bwrap did not report a version".into()))?;
        let number = version.trim_start_matches("bubblewrap").trim();
        if !version_at_least(number, MINIMUM_BUBBLEWRAP) {
            return Err(SandboxError::Executable(format!(
                "Bubblewrap {number} is older than the verified {}.{}",
                MINIMUM_BUBBLEWRAP.0, MINIMUM_BUBBLEWRAP.1
            )));
        }
        bubblewrap.version = Some(number.to_owned());
        let socat = required_executable("socat", search_path)?;
        Ok(Self {
            platform,
            bubblewrap: Some(bubblewrap),
            socat: Some(socat),
            ripgrep,
            srt,
        })
    }

    /// Returns the `srt` launcher, or why sandboxed terminals cannot start.
    pub fn srt(&self) -> Result<&SandboxExecutable, SandboxError> {
        self.srt.as_ref().ok_or_else(|| {
            SandboxError::Executable(
                "sandbox-runtime's srt command was not found on PATH. Install \
                 @anthropic-ai/sandbox-runtime 0.0.77 to open sandboxed terminals"
                    .into(),
            )
        })
    }

    /// Executables a launch for `adapter` uses, as the effective profile
    /// lists them.
    pub(super) fn listed(&self, adapter: SandboxAdapter) -> Vec<SandboxExecutable> {
        let srt = self
            .srt
            .clone()
            .filter(|_| adapter == SandboxAdapter::Terminal);
        [self.bubblewrap.clone(), self.socat.clone()]
            .into_iter()
            .flatten()
            .chain([self.ripgrep.clone()])
            .chain(srt)
            .collect()
    }
}

fn required_executable(name: &str, search_path: &OsStr) -> Result<SandboxExecutable, SandboxError> {
    find_executable(name, search_path)
        .map(|path| SandboxExecutable {
            name: name.to_owned(),
            path: path.to_string_lossy().into_owned(),
            version: None,
        })
        .ok_or_else(|| SandboxError::Executable(format!("{name} was not found on PATH")))
}

fn find_executable(name: &str, search_path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(search_path)
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(name))
        .find(|candidate| is_executable(candidate))
        .and_then(|candidate| fs::canonicalize(candidate).ok())
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn executable_version(path: &Path, search_path: &OsStr) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .env("PATH", search_path)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|version| !version.is_empty())
}

fn version_at_least(version: &str, minimum: (u64, u64)) -> bool {
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor)) => (major, minor) >= minimum,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_bubblewrap_versions() {
        assert!(version_at_least("0.12.0", MINIMUM_BUBBLEWRAP));
        assert!(version_at_least("1.0", MINIMUM_BUBBLEWRAP));
        assert!(!version_at_least("0.10.9", MINIMUM_BUBBLEWRAP));
        assert!(!version_at_least("unknown", MINIMUM_BUBBLEWRAP));
    }
}
