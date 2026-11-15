use semver::Version;
use std::env;
use std::error::Error;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::{ClaudeBridgeShutdownTimeouts, StartClaudeBridgeOptions};

/// The oldest Claude Code release the Claude bridge supports.
///
/// Matches `MIN_SUPPORTED_CLAUDE_VERSION` in `@stormlightlabs/pau-claude-bridge`.
pub const MIN_SUPPORTED_CLAUDE_VERSION: &str = "2.1.259";

/// The command the Claude bridge package installs.
pub const CLAUDE_BRIDGE_COMMAND: &str = "pau-claude-bridge";

/// How long `claude --version` may run before discovery gives up on it.
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

/// The most `claude --version` output discovery reads. A version line is a
/// few dozen bytes, so anything past this is not a version.
const VERSION_OUTPUT_LIMIT: u64 = 64 * 1024;

/// Overrides used while locating Claude Code and the Claude bridge.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoverClaudeOptions {
    /// An exact Claude Code executable. When set, `PATH` is not searched for it.
    pub executable_path: Option<PathBuf>,
    /// An exact bridge host executable. When set, `PATH` is not searched for it.
    pub bridge_path: Option<PathBuf>,
    /// The path list searched for executables that have no exact path, and the
    /// `PATH` the version probe and the bridge host run with.
    pub path: OsString,
}

impl Default for DiscoverClaudeOptions {
    fn default() -> Self {
        Self {
            executable_path: None,
            bridge_path: None,
            path: env::var_os("PATH").unwrap_or_default(),
        }
    }
}

/// A supported Claude Code executable and the bridge host that runs it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeDiscovery {
    /// The configured or `PATH`-resolved Claude Code executable.
    pub executable_path: PathBuf,
    /// The version `claude --version` reported.
    pub version: Version,
    /// The configured or `PATH`-resolved `pau-claude-bridge` executable.
    pub bridge_path: PathBuf,
    /// The `PATH` discovery searched, which the bridge host also receives.
    pub path: OsString,
}

impl ClaudeDiscovery {
    /// Builds the bridge host launch for a session in `working_directory`.
    ///
    /// The host resumes `native_session_id` when one is given and starts a new
    /// Claude session otherwise. It checks the Claude Code version again, and
    /// also refuses a release newer than it has verified that lacks a flag it
    /// needs.
    pub fn bridge_options(
        &self,
        working_directory: PathBuf,
        native_session_id: Option<&str>,
    ) -> StartClaudeBridgeOptions {
        let mut arguments: Vec<OsString> = vec![
            "--claude".into(),
            self.executable_path.clone().into(),
            "--cwd".into(),
            working_directory.clone().into(),
        ];
        if let Some(id) = native_session_id {
            arguments.push("--resume".into());
            arguments.push(id.into());
        }
        StartClaudeBridgeOptions {
            executable_path: self.bridge_path.clone(),
            working_directory,
            arguments,
            environment: vec![("PATH".into(), self.path.clone())],
            shutdown_timeouts: ClaudeBridgeShutdownTimeouts::default(),
        }
    }
}

/// A machine-readable reason why Claude discovery failed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaudeDiscoveryErrorCode {
    /// No Claude Code executable was found.
    NotFound,
    /// The Claude Code path was not an executable file.
    NotExecutable,
    /// `claude --version` failed or did not finish in time.
    VersionCommandFailed,
    /// Claude Code reported a version Pau could not read.
    InvalidVersion,
    /// The installed Claude Code is older than the bridge supports.
    UnsupportedVersion,
    /// No bridge host executable was found.
    BridgeNotFound,
    /// The bridge host path was not an executable file.
    BridgeNotExecutable,
}

/// A failure to find a usable Claude Code and bridge host, with the step that
/// fixes it.
#[derive(Debug)]
pub struct ClaudeDiscoveryError {
    code: ClaudeDiscoveryErrorCode,
    message: String,
    executable_path: Option<PathBuf>,
    version: Option<Version>,
}

impl ClaudeDiscoveryError {
    /// Returns the stable category for this failure.
    pub fn code(&self) -> ClaudeDiscoveryErrorCode {
        self.code
    }

    /// Returns the Claude Code executable involved, when one was located.
    pub fn executable_path(&self) -> Option<&Path> {
        self.executable_path.as_deref()
    }

    /// Returns the Claude Code version, when it was read.
    pub fn version(&self) -> Option<&Version> {
        self.version.as_ref()
    }
}

impl fmt::Display for ClaudeDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for ClaudeDiscoveryError {}

/// Locates Claude Code and the bridge host and checks the Claude Code
/// version, without starting a session.
///
/// Blocks while `claude --version` runs, for at most five seconds.
pub fn discover_claude(
    options: &DiscoverClaudeOptions,
) -> Result<ClaudeDiscovery, ClaudeDiscoveryError> {
    let failure = |code, message, executable_path, version| ClaudeDiscoveryError {
        code,
        message,
        executable_path,
        version,
    };
    let executable_path = match locate("claude", options.executable_path.as_deref(), &options.path)
    {
        Ok(path) => path,
        Err(Lookup::Missing(None)) => {
            return Err(failure(
                ClaudeDiscoveryErrorCode::NotFound,
                "Claude Code was not found. Install Claude Code, add `claude` to PATH, or configure its executable path.".to_owned(),
                None,
                None,
            ));
        }
        Err(Lookup::Missing(Some(path))) => {
            return Err(failure(
                ClaudeDiscoveryErrorCode::NotFound,
                format!(
                    "The configured Claude Code executable does not exist: {}. Correct the configured path or install Claude Code.",
                    path.display()
                ),
                Some(path),
                None,
            ));
        }
        Err(Lookup::NotExecutable(path)) => {
            return Err(failure(
                ClaudeDiscoveryErrorCode::NotExecutable,
                format!(
                    "Claude Code at {} is not an executable file. Fix its permissions or configure another Claude Code executable.",
                    path.display()
                ),
                Some(path),
                None,
            ));
        }
    };

    let output = read_version(&executable_path, &options.path).map_err(|reason| {
        failure(
            ClaudeDiscoveryErrorCode::VersionCommandFailed,
            format!(
                "`{} --version` failed: {reason}. Repair or reinstall Claude Code.",
                executable_path.display()
            ),
            Some(executable_path.clone()),
            None,
        )
    })?;
    let Some(version) = parse_version(&output) else {
        return Err(failure(
            ClaudeDiscoveryErrorCode::InvalidVersion,
            format!(
                "`{} --version` returned an unrecognized version: {:?}. Update or reinstall Claude Code.",
                executable_path.display(),
                output.trim()
            ),
            Some(executable_path),
            None,
        ));
    };
    let minimum =
        Version::parse(MIN_SUPPORTED_CLAUDE_VERSION).expect("valid Claude minimum version");
    if version < minimum {
        return Err(failure(
            ClaudeDiscoveryErrorCode::UnsupportedVersion,
            format!(
                "Claude Code {version} is unsupported. Update Claude Code to {MIN_SUPPORTED_CLAUDE_VERSION} or newer with `claude update`."
            ),
            Some(executable_path),
            Some(version),
        ));
    }

    let bridge_path = match locate(
        CLAUDE_BRIDGE_COMMAND,
        options.bridge_path.as_deref(),
        &options.path,
    ) {
        Ok(path) => path,
        Err(Lookup::Missing(_)) => {
            return Err(failure(
                ClaudeDiscoveryErrorCode::BridgeNotFound,
                format!(
                    "The Claude bridge was not found. Install `@stormlightlabs/pau-claude-bridge` and add its `{CLAUDE_BRIDGE_COMMAND}` command to PATH."
                ),
                Some(executable_path),
                Some(version),
            ));
        }
        Err(Lookup::NotExecutable(path)) => {
            return Err(failure(
                ClaudeDiscoveryErrorCode::BridgeNotExecutable,
                format!(
                    "The Claude bridge at {} is not an executable file. Fix its permissions or reinstall `@stormlightlabs/pau-claude-bridge`.",
                    path.display()
                ),
                Some(executable_path),
                Some(version),
            ));
        }
    };

    Ok(ClaudeDiscovery {
        executable_path,
        version,
        bridge_path,
        path: options.path.clone(),
    })
}

/// Yields the directories of a `PATH` value that are absolute.
///
/// Agents run with the workspace as their working directory. An empty or
/// relative entry would then name a directory inside the repository, where
/// anyone who can commit to it could plant the executable, so discovery skips
/// those entries.
pub fn absolute_path_entries(path: &OsStr) -> impl Iterator<Item = PathBuf> + '_ {
    env::split_paths(path).filter(|directory| directory.is_absolute())
}

/// Why an executable could not be located.
enum Lookup {
    /// Nothing exists at the configured path, or on `PATH` when it is `None`.
    Missing(Option<PathBuf>),
    /// The path exists but cannot be executed.
    NotExecutable(PathBuf),
}

/// Returns `configured` when it is an executable file, or else the first
/// executable `name` on `path`. A non-executable match on `path` is reported
/// only when no later directory holds an executable one.
fn locate(name: &str, configured: Option<&Path>, path: &OsStr) -> Result<PathBuf, Lookup> {
    if let Some(configured) = configured {
        // The bridge runs in the workspace, where a relative path would name
        // a different file.
        let configured = &std::path::absolute(configured)
            .map_err(|_| Lookup::Missing(Some(configured.to_path_buf())))?;
        return match fs::metadata(configured) {
            Ok(metadata) if is_executable_file(&metadata) => Ok(configured.to_path_buf()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Err(Lookup::Missing(Some(configured.to_path_buf())))
            }
            _ => Err(Lookup::NotExecutable(configured.to_path_buf())),
        };
    }
    let file_name = format!("{name}{}", env::consts::EXE_SUFFIX);
    let mut blocked = None;
    for directory in absolute_path_entries(path) {
        let candidate = directory.join(&file_name);
        match fs::metadata(&candidate) {
            Ok(metadata) if is_executable_file(&metadata) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => {
                blocked.get_or_insert(candidate);
            }
        }
    }
    Err(blocked.map_or(Lookup::Missing(None), Lookup::NotExecutable))
}

#[cfg(unix)]
fn is_executable_file(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_file(metadata: &fs::Metadata) -> bool {
    metadata.is_file()
}

/// Runs `claude --version` and returns its standard output, or a reason for
/// the failure.
///
/// Output is read on a separate thread while [`VERSION_TIMEOUT`] runs, and at
/// most [`VERSION_OUTPUT_LIMIT`] bytes of it are kept. A background process
/// that inherited standard output can hold it open after `claude` exits, so
/// the deadline bounds the wait, not the end of output. The process is killed
/// when it is still running at the deadline.
fn read_version(executable_path: &Path, path: &OsStr) -> Result<String, String> {
    let mut child = spawn_retrying_busy(|| {
        Command::new(executable_path)
            .arg("--version")
            .env("PATH", path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
    })
    .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + VERSION_TIMEOUT;
    let mut output = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let (sender, chunks) = mpsc::channel();
        std::thread::spawn(move || {
            let mut stdout = stdout.take(VERSION_OUTPUT_LIMIT);
            let mut buffer = [0; 4096];
            while let Ok(read @ 1..) = stdout.read(&mut buffer) {
                if sender.send(buffer[..read].to_vec()).is_err() {
                    break;
                }
            }
        });
        let remaining = || deadline.saturating_duration_since(Instant::now());
        while let Ok(chunk) = chunks.recv_timeout(remaining()) {
            output.extend(chunk);
        }
    }
    let status = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "it did not finish within {} seconds",
                    VERSION_TIMEOUT.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    if !status.success() {
        return Err(status.to_string());
    }
    Ok(String::from_utf8_lossy(&output).into_owned())
}

/// Retries a spawn that fails because the executable was just written and is
/// still open for writing. Linux reports this as `ETXTBSY`.
fn spawn_retrying_busy(
    mut spawn: impl FnMut() -> std::io::Result<std::process::Child>,
) -> std::io::Result<std::process::Child> {
    let mut attempts = 0;
    loop {
        match spawn() {
            #[cfg(unix)]
            Err(error) if error.raw_os_error() == Some(libc::ETXTBSY) && attempts < 10 => {
                attempts += 1;
                std::thread::sleep(Duration::from_millis(10));
            }
            result => return result,
        }
    }
}

/// Reads the first `major.minor.patch` word, as in `2.1.281 (Claude Code)`.
/// Any pre-release or build suffix is dropped, as the bridge does.
fn parse_version(output: &str) -> Option<Version> {
    output.split_whitespace().find_map(|word| {
        let core = word
            .strip_prefix('v')
            .unwrap_or(word)
            .split(['-', '+'])
            .next()?;
        let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
        match (parts.next()?, parts.next()?, parts.next()?, parts.next()) {
            (Some(major), Some(minor), Some(patch), None) => {
                Some(Version::new(major, minor, patch))
            }
            _ => None,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_version_output() {
        assert_eq!(
            parse_version("2.1.281 (Claude Code)\n"),
            Some(Version::new(2, 1, 281))
        );
        assert_eq!(
            parse_version("claude v2.2.0-beta.1"),
            Some(Version::new(2, 2, 0))
        );
        assert_eq!(parse_version("Claude Code"), None);
        assert_eq!(parse_version("2.1"), None);
    }
}
