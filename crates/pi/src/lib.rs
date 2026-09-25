//! Pi discovery and compatibility diagnostics.

use semver::Version;
use std::env;
use std::error::Error;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Identifies the Pi adapter in diagnostics.
pub const CRATE_NAME: &str = "pau-pi";

/// The oldest Pi release supported by this adapter.
pub const MIN_SUPPORTED_PI_VERSION: &str = "0.87.1";

/// The newest Pi release verified with this adapter.
pub const LATEST_VERIFIED_PI_VERSION: &str = "0.87.1";

const REQUIRED_HELP_MARKERS: [&str; 2] = ["--mode", "rpc"];

/// Overrides used while locating and inspecting Pi.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoverPiOptions {
    /// An exact executable path. When set, `PATH` is not searched.
    pub executable_path: Option<PathBuf>,
    /// The path list searched when no exact executable path is set.
    pub path: OsString,
    /// The home directory used for Pi's default agent directory.
    pub home_directory: Option<PathBuf>,
    /// The `PI_CODING_AGENT_DIR` override, if set.
    pub agent_directory: Option<PathBuf>,
    /// The `PI_CODING_AGENT_SESSION_DIR` override, if set.
    pub session_directory: Option<PathBuf>,
    /// The workspace used to resolve project configuration.
    pub working_directory: PathBuf,
}

impl Default for DiscoverPiOptions {
    fn default() -> Self {
        Self {
            executable_path: None,
            path: env::var_os("PATH").unwrap_or_default(),
            home_directory: env::var_os("HOME").map(PathBuf::from),
            agent_directory: nonempty_env_path("PI_CODING_AGENT_DIR"),
            session_directory: nonempty_env_path("PI_CODING_AGENT_SESSION_DIR"),
            working_directory: env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

/// Pi configuration locations resolved without loading credentials or starting a session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiConfigurationPaths {
    /// Pi's user-level agent directory.
    pub agent_directory: PathBuf,
    /// Pi's user-level settings file.
    pub user_settings: PathBuf,
    /// Pi's user-level authentication file.
    pub authentication: PathBuf,
    /// Pi's session storage directory before any `sessionDir` setting is loaded.
    pub sessions_directory: PathBuf,
    /// The workspace-local `.pi` directory.
    pub project_directory: PathBuf,
    /// The workspace-local settings file.
    pub project_settings: PathBuf,
}

/// How the installed Pi version relates to releases verified by Pau.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiCompatibility {
    /// The release is inside Pau's verified range.
    Verified,
    /// The release is newer than Pau's verified range but advertises RPC mode.
    NewerUnverified,
}

/// The result of finding and inspecting a supported Pi executable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiDiscovery {
    /// The configured or `PATH`-resolved executable.
    pub executable_path: PathBuf,
    /// The semantic version reported by `pi --version`.
    pub version: Version,
    /// Pi's resolved user and project configuration locations.
    pub configuration: PiConfigurationPaths,
    /// Whether Pau has verified this release.
    pub compatibility: PiCompatibility,
    /// A diagnostic for a newer release that passed the capability check.
    pub warning: Option<String>,
}

/// A machine-readable reason why Pi discovery failed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiDiscoveryErrorCode {
    /// No Pi executable was found.
    NotFound,
    /// A discovered path was not an executable file.
    NotExecutable,
    /// Pi's version command could not run successfully.
    VersionCommandFailed,
    /// Pi returned an unrecognized version.
    InvalidVersion,
    /// The installed Pi release does not support Pau's required RPC interface.
    UnsupportedVersion,
    /// Pi's default configuration directory could not be resolved.
    ConfigurationUnavailable,
}

/// An actionable failure returned before Pau starts a Pi session.
#[derive(Debug)]
pub struct PiDiscoveryError {
    code: PiDiscoveryErrorCode,
    message: String,
    executable_path: Option<PathBuf>,
    version: Option<Version>,
    source: Option<std::io::Error>,
}

impl PiDiscoveryError {
    /// Returns the stable category for this discovery failure.
    pub fn code(&self) -> PiDiscoveryErrorCode {
        self.code
    }

    /// Returns the executable involved in the failure, when known.
    pub fn executable_path(&self) -> Option<&Path> {
        self.executable_path.as_deref()
    }

    /// Returns the parsed unsupported version, when available.
    pub fn version(&self) -> Option<&Version> {
        self.version.as_ref()
    }
}

impl fmt::Display for PiDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for PiDiscoveryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn Error + 'static))
    }
}

/// Locates Pi and validates its RPC compatibility without starting a session.
pub fn discover_pi(options: &DiscoverPiOptions) -> Result<PiDiscovery, PiDiscoveryError> {
    let executable_path = match &options.executable_path {
        Some(path) => validate_configured_path(path)?,
        None => find_on_path(&options.path)?,
    };
    let version = read_version(&executable_path)?;
    let minimum = Version::parse(MIN_SUPPORTED_PI_VERSION).expect("valid Pi minimum version");
    let latest = Version::parse(LATEST_VERIFIED_PI_VERSION).expect("valid latest Pi version");

    if version < minimum {
        return Err(discovery_error(
            PiDiscoveryErrorCode::UnsupportedVersion,
            format!(
                "Pi {version} is unsupported. Update Pi to {MIN_SUPPORTED_PI_VERSION} or newer with `pi update` or the package manager that installed it."
            ),
            Some(executable_path),
            Some(version),
            None,
        ));
    }

    let (compatibility, warning) = if version <= latest {
        (PiCompatibility::Verified, None)
    } else {
        verify_rpc_capability(&executable_path, &version)?;
        (
            PiCompatibility::NewerUnverified,
            Some(format!(
                "Pi {version} is newer than verified release {LATEST_VERIFIED_PI_VERSION}; RPC mode is available."
            )),
        )
    };
    let configuration = configuration_paths(options)?;

    Ok(PiDiscovery {
        executable_path,
        version,
        configuration,
        compatibility,
        warning,
    })
}

fn validate_configured_path(path: &Path) -> Result<PathBuf, PiDiscoveryError> {
    match fs::metadata(path) {
        Ok(metadata) if is_executable_file(&metadata) => Ok(path.to_path_buf()),
        Ok(_) => Err(discovery_error(
            PiDiscoveryErrorCode::NotExecutable,
            format!(
                "The configured Pi path is not an executable file: {}. Choose the Pi executable or make the file executable.",
                path.display()
            ),
            Some(path.to_path_buf()),
            None,
            None,
        )),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Err(discovery_error(
            PiDiscoveryErrorCode::NotFound,
            format!(
                "The configured Pi executable does not exist: {}. Correct the configured path or install Pi.",
                path.display()
            ),
            Some(path.to_path_buf()),
            None,
            Some(source),
        )),
        Err(source) => Err(discovery_error(
            PiDiscoveryErrorCode::NotExecutable,
            format!(
                "The configured Pi path cannot be executed: {}. Check its permissions.",
                path.display()
            ),
            Some(path.to_path_buf()),
            None,
            Some(source),
        )),
    }
}

fn find_on_path(path: &OsStr) -> Result<PathBuf, PiDiscoveryError> {
    let mut blocked_path = None;
    let executable_name = format!("pi{}", env::consts::EXE_SUFFIX);

    for directory in env::split_paths(path) {
        if directory.as_os_str().is_empty() {
            continue;
        }
        let candidate = directory.join(&executable_name);
        match fs::metadata(&candidate) {
            Ok(metadata) if is_executable_file(&metadata) => return Ok(candidate),
            Ok(_) => blocked_path.get_or_insert(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => blocked_path.get_or_insert(candidate),
        };
    }

    if let Some(path) = blocked_path {
        return Err(discovery_error(
            PiDiscoveryErrorCode::NotExecutable,
            format!(
                "Pi was found on PATH but is not executable: {}. Fix its permissions or configure another Pi executable.",
                path.display()
            ),
            Some(path),
            None,
            None,
        ));
    }

    Err(discovery_error(
        PiDiscoveryErrorCode::NotFound,
        "Pi was not found. Install `@earendil-works/pi-coding-agent`, add `pi` to PATH, or configure its executable path.".to_owned(),
        None,
        None,
        None,
    ))
}

fn read_version(executable_path: &Path) -> Result<Version, PiDiscoveryError> {
    let output = Command::new(executable_path)
        .arg("--version")
        .output()
        .map_err(|source| {
            discovery_error(
                PiDiscoveryErrorCode::VersionCommandFailed,
                format!(
                    "Could not run `{} --version`. Check the Pi installation.",
                    executable_path.display()
                ),
                Some(executable_path.to_path_buf()),
                None,
                Some(source),
            )
        })?;

    if !output.status.success() {
        let diagnostic = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let reason = if diagnostic.is_empty() {
            format!("exit status {}", output.status)
        } else {
            diagnostic
        };
        return Err(discovery_error(
            PiDiscoveryErrorCode::VersionCommandFailed,
            format!(
                "`{} --version` failed: {reason}. Repair or reinstall Pi.",
                executable_path.display()
            ),
            Some(executable_path.to_path_buf()),
            None,
            None,
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = stdout.trim().strip_prefix('v').unwrap_or(stdout.trim());
    Version::parse(raw).map_err(|_| {
        discovery_error(
            PiDiscoveryErrorCode::InvalidVersion,
            format!(
                "`{} --version` returned an unrecognized version: {:?}. Update or reinstall Pi.",
                executable_path.display(),
                stdout.trim()
            ),
            Some(executable_path.to_path_buf()),
            None,
            None,
        )
    })
}

fn verify_rpc_capability(
    executable_path: &Path,
    version: &Version,
) -> Result<(), PiDiscoveryError> {
    let output = Command::new(executable_path)
        .arg("--help")
        .output()
        .map_err(|source| {
            discovery_error(
                PiDiscoveryErrorCode::VersionCommandFailed,
                format!(
                    "Could not inspect Pi {version} capabilities at {}.",
                    executable_path.display()
                ),
                Some(executable_path.to_path_buf()),
                Some(version.clone()),
                Some(source),
            )
        })?;
    let help = String::from_utf8_lossy(&output.stdout);
    let missing = REQUIRED_HELP_MARKERS
        .into_iter()
        .filter(|marker| !help.contains(marker))
        .collect::<Vec<_>>();

    if !output.status.success() || !missing.is_empty() {
        return Err(discovery_error(
            PiDiscoveryErrorCode::UnsupportedVersion,
            format!(
                "Pi {version} is newer than the latest verified release and does not advertise the required `--mode rpc` interface. Install Pi {LATEST_VERIFIED_PI_VERSION} or configure a compatible executable."
            ),
            Some(executable_path.to_path_buf()),
            Some(version.clone()),
            None,
        ));
    }
    Ok(())
}

fn configuration_paths(
    options: &DiscoverPiOptions,
) -> Result<PiConfigurationPaths, PiDiscoveryError> {
    let agent_directory = match &options.agent_directory {
        Some(path) => expand_home(path, options.home_directory.as_deref()),
        None => options
            .home_directory
            .as_ref()
            .map(|home| home.join(".pi").join("agent"))
            .ok_or_else(|| {
                discovery_error(
                    PiDiscoveryErrorCode::ConfigurationUnavailable,
                    "Pi's configuration directory cannot be resolved because HOME is not set. Set HOME or PI_CODING_AGENT_DIR.".to_owned(),
                    None,
                    None,
                    None,
                )
            })?,
    };
    let sessions_directory = options
        .session_directory
        .as_ref()
        .map(|path| expand_home(path, options.home_directory.as_deref()))
        .unwrap_or_else(|| agent_directory.join("sessions"));
    let project_directory = options.working_directory.join(".pi");

    Ok(PiConfigurationPaths {
        user_settings: agent_directory.join("settings.json"),
        authentication: agent_directory.join("auth.json"),
        sessions_directory,
        project_settings: project_directory.join("settings.json"),
        project_directory,
        agent_directory,
    })
}

fn expand_home(path: &Path, home: Option<&Path>) -> PathBuf {
    if path == Path::new("~") {
        return home
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf());
    }
    if let Ok(rest) = path.strip_prefix("~/")
        && let Some(home) = home
    {
        return home.join(rest);
    }
    path.to_path_buf()
}

fn nonempty_env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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

fn discovery_error(
    code: PiDiscoveryErrorCode,
    message: String,
    executable_path: Option<PathBuf>,
    version: Option<Version>,
    source: Option<std::io::Error>,
) -> PiDiscoveryError {
    PiDiscoveryError {
        code,
        message,
        executable_path,
        version,
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    #[test]
    fn uses_a_configured_path_and_reports_configuration() {
        let fixture = PiFixture::new("0.87.1", true);
        let workspace = fixture.root.path().join("workspace");
        let home = fixture.root.path().join("home");
        let agent = PathBuf::from("~/custom-pi");
        let sessions = PathBuf::from("~/pi-sessions");
        let result = discover_pi(&DiscoverPiOptions {
            executable_path: Some(fixture.executable.clone()),
            path: OsString::new(),
            home_directory: Some(home.clone()),
            agent_directory: Some(agent),
            session_directory: Some(sessions),
            working_directory: workspace.clone(),
        })
        .unwrap();

        assert_eq!(result.executable_path, fixture.executable);
        assert_eq!(result.version, Version::new(0, 87, 1));
        assert_eq!(result.compatibility, PiCompatibility::Verified);
        assert_eq!(result.configuration.agent_directory, home.join("custom-pi"));
        assert_eq!(
            result.configuration.user_settings,
            home.join("custom-pi/settings.json")
        );
        assert_eq!(
            result.configuration.authentication,
            home.join("custom-pi/auth.json")
        );
        assert_eq!(
            result.configuration.sessions_directory,
            home.join("pi-sessions")
        );
        assert_eq!(
            result.configuration.project_directory,
            workspace.join(".pi")
        );
        assert_eq!(
            result.configuration.project_settings,
            workspace.join(".pi/settings.json")
        );
    }

    #[test]
    fn finds_pi_on_path() {
        let fixture = PiFixture::new("0.87.1", true);
        let result = discover_pi(&fixture.options(None)).unwrap();

        assert_eq!(result.executable_path, fixture.executable);
        assert_eq!(
            result.configuration.sessions_directory,
            fixture.root.path().join("home/.pi/agent/sessions")
        );
    }

    #[test]
    fn reports_a_missing_configured_executable() {
        let fixture = PiFixture::new("0.87.1", true);
        let missing = fixture.root.path().join("missing-pi");
        let error = discover_pi(&fixture.options(Some(missing.clone()))).unwrap_err();

        assert_eq!(error.code(), PiDiscoveryErrorCode::NotFound);
        assert_eq!(error.executable_path(), Some(missing.as_path()));
        assert!(error.to_string().contains("install Pi"));
    }

    #[test]
    fn reports_a_missing_path_executable() {
        let fixture = PiFixture::new("0.87.1", true);
        let mut options = fixture.options(None);
        options.path = OsString::new();
        let error = discover_pi(&options).unwrap_err();

        assert_eq!(error.code(), PiDiscoveryErrorCode::NotFound);
        assert!(error.to_string().contains("add `pi` to PATH"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_non_executable_file() {
        let fixture = PiFixture::new("0.87.1", true);
        fs::set_permissions(&fixture.executable, fs::Permissions::from_mode(0o644)).unwrap();
        let error = discover_pi(&fixture.options(None)).unwrap_err();

        assert_eq!(error.code(), PiDiscoveryErrorCode::NotExecutable);
        assert_eq!(error.executable_path(), Some(fixture.executable.as_path()));
        assert!(error.to_string().contains("permissions"));
    }

    #[test]
    fn rejects_an_unsupported_version() {
        let fixture = PiFixture::new("0.87.0", true);
        let error = discover_pi(&fixture.options(None)).unwrap_err();

        assert_eq!(error.code(), PiDiscoveryErrorCode::UnsupportedVersion);
        assert_eq!(error.version(), Some(&Version::new(0, 87, 0)));
        assert!(error.to_string().contains("pi update"));
    }

    #[test]
    fn accepts_a_newer_version_after_an_rpc_capability_check() {
        let fixture = PiFixture::new("0.88.0", true);
        let result = discover_pi(&fixture.options(None)).unwrap();

        assert_eq!(result.compatibility, PiCompatibility::NewerUnverified);
        assert!(result.warning.unwrap().contains(LATEST_VERIFIED_PI_VERSION));
    }

    #[test]
    fn rejects_a_newer_version_without_rpc_capability() {
        let fixture = PiFixture::new("0.88.0", false);
        let error = discover_pi(&fixture.options(None)).unwrap_err();

        assert_eq!(error.code(), PiDiscoveryErrorCode::UnsupportedVersion);
        assert!(error.to_string().contains("--mode rpc"));
    }

    #[test]
    #[ignore = "requires Pi installed on PATH"]
    fn discovers_installed_pi() {
        let result = discover_pi(&DiscoverPiOptions::default()).unwrap();

        eprintln!("{result:#?}");
        assert!(result.executable_path.is_file());
    }

    struct PiFixture {
        root: TempDir,
        executable: PathBuf,
    }

    impl PiFixture {
        fn new(version: &str, supports_rpc: bool) -> Self {
            let root = tempfile::tempdir().unwrap();
            let executable = root.path().join(format!("pi{}", env::consts::EXE_SUFFIX));
            write_fake_pi(&executable, version, supports_rpc);
            Self { root, executable }
        }

        fn options(&self, executable_path: Option<PathBuf>) -> DiscoverPiOptions {
            DiscoverPiOptions {
                executable_path,
                path: env::join_paths([self.root.path()]).unwrap(),
                home_directory: Some(self.root.path().join("home")),
                agent_directory: None,
                session_directory: None,
                working_directory: self.root.path().join("workspace"),
            }
        }
    }

    #[cfg(unix)]
    fn write_fake_pi(path: &Path, version: &str, supports_rpc: bool) {
        let help = if supports_rpc {
            "--mode <mode> text, json, or rpc"
        } else {
            "interactive only"
        };
        fs::write(
            path,
            format!(
                "#!/bin/sh\ncase \"$1\" in\n  --version) printf '%s\\n' '{version}' ;;\n  --help) printf '%s\\n' '{help}' ;;\n  *) exit 64 ;;\nesac\n"
            ),
        )
        .unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(not(unix))]
    fn write_fake_pi(_path: &Path, _version: &str, _supports_rpc: bool) {
        unimplemented!("Pi discovery fixtures currently require a Unix shell")
    }
}
