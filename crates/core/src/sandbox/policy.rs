//! Launch resolution, the policy file, and the effective profile.

use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use super::{
    SANDBOX_POLICY_VERSION, SANDBOXED_PI_TOOLS, SandboxAdapter, SandboxError, SandboxExecutable,
    SandboxExecutables, SandboxProfileName, SandboxSelection, SandboxSettings,
    executables::SandboxPlatform,
    network::{is_local_destination, proxy_exclusions},
    placeholders::{RUNTIME_DANGEROUS_DIRECTORIES, RUNTIME_DANGEROUS_FILES, predict_placeholders},
    validate_selection,
};

/// Credential and authentication stores relative to the home directory.
///
/// Reads are denied because a readable credential file defeats the network
/// policy as soon as any destination is granted.
const HOME_CREDENTIAL_PATHS: &[&str] = &[
    ".ssh",
    ".aws",
    ".azure",
    ".gnupg",
    ".kube",
    ".config/gcloud",
    ".config/gh",
    ".docker/config.json",
    ".git-credentials",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".pi/agent/auth.json",
    ".claude/.credentials.json",
    ".codex/auth.json",
];

/// Workspace files that commonly hold local secrets. `.env.example` and other
/// samples stay readable.
const WORKSPACE_SECRET_PATTERNS: &[&str] = &[".env", ".env.local", ".env.*.local"];

/// Repository and agent configuration that a sandboxed tool must not rewrite.
/// sandbox-runtime adds its own list, which does not cover Pi or all Claude
/// settings.
const PROTECTED_WORKSPACE_PATHS: &[&str] = &[
    ".pi",
    ".claude",
    ".codex",
    ".mcp.json",
    ".vscode",
    ".idea",
    ".zed",
];

/// Git paths protected only when `.git` is a directory. Denying them in a
/// workspace without `.git` would create a `.git` placeholder and break
/// `git init`; in a worktree `.git` is a file and they cannot exist.
const PROTECTED_GIT_PATHS: &[&str] = &[".git/hooks", ".git/config"];

/// Home paths that sandbox-runtime makes writable by default. Pau denies them
/// so the only writable roots are the ones the profile names.
const RUNTIME_CONVENIENCE_WRITES: &[&str] = &[".npm/_logs", ".claude/debug"];

/// Shared directory that sandbox-runtime binds writable whenever it exists.
pub(super) const SHARED_CLAUDE_TEMP: &str = "/tmp/claude";

/// Inputs for resolving one sandboxed launch.
#[derive(Debug, Clone)]
pub struct SandboxLaunchInput<'a> {
    /// Adapter that owns the execution boundary.
    pub adapter: SandboxAdapter,
    /// Selected profile.
    pub settings: &'a SandboxSettings,
    /// Workspace root.
    pub workspace: &'a Path,
    /// Home directory whose credential stores are hidden.
    pub home: &'a Path,
    /// Pau-owned directory for this session. Its `tmp` child becomes the
    /// sandbox temporary directory and its `host` child holds the policy
    /// file, which the sandbox cannot read.
    pub session_directory: &'a Path,
    /// Pinned containment executables.
    pub executables: &'a SandboxExecutables,
    /// Directories the tool host reads to start, such as the Node runtime and
    /// the sandbox package. They stay readable under the home read-deny
    /// setting.
    pub runtime_roots: &'a [PathBuf],
    /// `PATH` inside the sandbox.
    pub tool_path: &'a str,
}

/// A resolved launch and everything needed to start and describe it.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSandbox {
    /// Profile shown to the operator.
    pub effective: EffectiveSandbox,
    /// Policy file contents for `packages/sandbox`.
    pub policy: SandboxPolicyFile,
    /// Host-private directory that holds the policy file.
    pub host_directory: PathBuf,
    /// Absolute placeholder paths sandbox-runtime will create.
    pub placeholders: Vec<PathBuf>,
}

/// Policy file read by the Pi extension and tool host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SandboxPolicyFile {
    /// Policy file format version.
    pub version: u32,
    /// Canonical workspace root.
    pub workspace: String,
    /// Dedicated per-session temporary directory.
    pub temp_dir: String,
    /// Complete sandbox-runtime configuration.
    #[ts(type = "unknown")]
    pub runtime_config: Value,
    /// Complete tool environment. Nothing else is forwarded.
    pub environment: BTreeMap<String, String>,
    /// `NO_PROXY` value inside the sandbox. Granted local addresses are
    /// removed so they use the proxy.
    pub no_proxy: String,
    /// Tools that may run outside the sandbox after a per-call approval.
    pub unsandboxed_tools: Vec<String>,
    /// Stdio MCP servers that start as descendants of the tool host.
    pub mcp_servers: Vec<SandboxedMcpServer>,
    /// Session MCP configuration that lists only contained servers. When it
    /// is present, the MCP client's tools may run under the profile.
    pub mcp_config: Option<String>,
    /// Placeholders omitted from grep's skipped-file report because they are
    /// not real files.
    pub placeholders: Vec<String>,
}

/// One stdio MCP server started inside the sandbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SandboxedMcpServer {
    /// Native server name.
    pub name: String,
    /// Host-side Unix socket the MCP client connects to.
    pub socket: String,
    /// Executable started by the tool host.
    pub command: String,
    /// Arguments after interpolation.
    pub args: Vec<String>,
    /// Working directory.
    pub cwd: String,
    /// Variables the server configuration sets. They are added to the tool
    /// environment for this server only.
    pub env: BTreeMap<String, String>,
}

/// Readable filesystem scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxReadAccess {
    /// Whether the home directory is unreadable apart from `allowed`.
    pub home_denied: bool,
    /// Paths re-allowed inside a denied region.
    pub allowed: Vec<String>,
    /// Paths and patterns that cannot be read.
    pub denied: Vec<String>,
}

/// Network scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxNetworkAccess {
    /// Granted destinations. Empty means network access is off.
    pub domains: Vec<String>,
    /// Granted destinations that name this host or a private network.
    pub local_addresses: Vec<String>,
    /// Whether every Unix socket is reachable.
    pub unix_sockets: bool,
}

/// Credential handling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxCredentialAccess {
    /// Credential paths that cannot be read.
    pub denied: Vec<String>,
    /// Credentials substituted by a broker. Brokerage is not available yet.
    pub brokered: Vec<String>,
}

/// The effective profile shown before sandboxed work starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct EffectiveSandbox {
    /// Adapter whose boundary the profile applies to.
    pub adapter: SandboxAdapter,
    /// Operating system that enforces the profile.
    pub platform: String,
    /// Containment mechanism.
    pub mechanism: String,
    /// Whether Pau's fixtures have verified this platform.
    pub verified: bool,
    /// Pinned executables.
    pub executables: Vec<SandboxExecutable>,
    /// Base profile.
    pub profile: SandboxProfileName,
    /// Readable scope.
    pub readable: SandboxReadAccess,
    /// Writable roots.
    pub writable: Vec<String>,
    /// Paths inside writable roots that stay read-only.
    pub protected: Vec<String>,
    /// Network scope.
    pub network: SandboxNetworkAccess,
    /// Credential handling.
    pub credentials: SandboxCredentialAccess,
    /// Names of the variables in the tool environment.
    pub environment: Vec<String>,
    /// Process limits and lifetime rules.
    pub limits: Vec<String>,
    /// Tools that run inside the sandbox.
    pub sandboxed_tools: Vec<String>,
    /// Tools that run outside it after a per-call approval.
    pub unsandboxed_tools: Vec<String>,
    /// Tools and servers that are unavailable while the profile is active.
    pub disabled_tools: Vec<String>,
    /// Empty placeholder files and directories created for absent protected
    /// paths. File and Git views hide them while the sandbox runs.
    pub placeholders: Vec<String>,
    /// Limits of the guarantee on this platform and adapter.
    pub known_gaps: Vec<String>,
}

/// Resolves one launch. The session directory need not exist yet; use
/// [`prepare_sandbox`] to create it and write the policy file.
pub fn resolve_sandbox(input: &SandboxLaunchInput<'_>) -> Result<ResolvedSandbox, SandboxError> {
    let settings = input.settings;
    validate_selection(&SandboxSelection::Sandboxed {
        settings: settings.clone(),
    })?;
    if !input.session_directory.is_absolute() {
        return Err(SandboxError::Invalid(
            "the session directory must be absolute".into(),
        ));
    }
    let workspace = canonical_directory(input.workspace, "workspace")?;
    let home = canonical_directory(input.home, "home directory")?;
    let temp_dir = input.session_directory.join("tmp");
    let host_directory = input.session_directory.join("host");
    let writable_grants = settings
        .grants
        .writable_roots
        .iter()
        .map(|root| canonical_writable_root(Path::new(root), &home))
        .collect::<Result<Vec<_>, _>>()?;
    let runtime_roots = input
        .runtime_roots
        .iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .collect::<Vec<_>>();

    let git_directory = workspace.join(".git").is_dir();
    let protected = PROTECTED_WORKSPACE_PATHS
        .iter()
        .chain(
            git_directory
                .then_some(PROTECTED_GIT_PATHS)
                .into_iter()
                .flatten(),
        )
        .map(|entry| workspace.join(entry))
        .collect::<Vec<_>>();
    let credentials = HOME_CREDENTIAL_PATHS
        .iter()
        .map(|entry| home.join(entry))
        .collect::<Vec<_>>();
    let secrets = WORKSPACE_SECRET_PATTERNS
        .iter()
        .map(|entry| workspace.join(entry))
        .collect::<Vec<_>>();

    let mut writable = Vec::new();
    if settings.profile == SandboxProfileName::WorkspaceWrite {
        writable.push(workspace.clone());
    }
    writable.push(temp_dir.clone());
    writable.extend(writable_grants.iter().cloned());

    let mut deny_read = credentials.clone();
    deny_read.extend(secrets.iter().cloned());
    deny_read.push(host_directory.clone());
    let mut allow_read = Vec::new();
    if settings.home_read_deny {
        deny_read.push(home.clone());
        allow_read.push(workspace.clone());
        allow_read.push(temp_dir.clone());
        allow_read.extend(writable_grants.iter().cloned());
        allow_read.extend(runtime_roots.iter().cloned());
    }

    let mut deny_write = protected.clone();
    deny_write.extend(
        RUNTIME_CONVENIENCE_WRITES
            .iter()
            .map(|entry| home.join(entry)),
    );
    deny_write.push(host_directory.clone());
    if !settings.share_claude_temp {
        deny_write.push(PathBuf::from(SHARED_CLAUDE_TEMP));
    }
    if input.adapter == SandboxAdapter::Claude && settings.profile == SandboxProfileName::ReadOnly {
        // Claude's sandbox always permits writes to its working directory.
        deny_write.push(workspace.clone());
    }

    let domains = settings.grants.domains.clone();
    let local_addresses = domains
        .iter()
        .filter(|domain| is_local_destination(domain))
        .cloned()
        .collect::<Vec<_>>();
    let mut runtime_config = json!({
        "network": {
            "allowedDomains": domains,
            "deniedDomains": [],
            "allowAllUnixSockets": settings.grants.unix_sockets,
            "allowLocalBinding": false,
        },
        "filesystem": {
            "denyRead": strings(&deny_read),
            "allowRead": strings(&allow_read),
            "allowWrite": strings(&writable),
            "denyWrite": strings(&deny_write),
        },
        "ripgrep": { "command": input.executables.ripgrep.path },
    });
    if let (Some(bubblewrap), Some(socat)) =
        (&input.executables.bubblewrap, &input.executables.socat)
    {
        runtime_config["bwrapPath"] = json!(bubblewrap.path);
        runtime_config["socatPath"] = json!(socat.path);
    }

    let environment = BTreeMap::from([
        ("HOME".to_owned(), path_string(&home)),
        ("LANG".to_owned(), "C.UTF-8".to_owned()),
        ("PATH".to_owned(), input.tool_path.to_owned()),
        ("PAU_SANDBOX".to_owned(), "1".to_owned()),
        ("TERM".to_owned(), "dumb".to_owned()),
        ("TMPDIR".to_owned(), path_string(&temp_dir)),
    ]);
    let placeholders = if settings.profile == SandboxProfileName::WorkspaceWrite {
        predict_placeholders(&workspace, &protected)
    } else {
        Vec::new()
    };

    let mut protected_display = strings(&protected);
    for entry in RUNTIME_DANGEROUS_FILES
        .iter()
        .chain(RUNTIME_DANGEROUS_DIRECTORIES)
    {
        let path = path_string(&workspace.join(entry));
        if !protected_display.contains(&path) {
            protected_display.push(path);
        }
    }
    let (sandboxed_tools, disabled_tools) = adapter_tools(input.adapter);
    let effective = EffectiveSandbox {
        adapter: input.adapter,
        platform: std::env::consts::OS.to_owned(),
        mechanism: mechanism(input.executables),
        verified: input.executables.platform == SandboxPlatform::Linux,
        executables: input.executables.listed(),
        profile: settings.profile,
        readable: SandboxReadAccess {
            home_denied: settings.home_read_deny,
            allowed: strings(&allow_read),
            denied: strings(&deny_read),
        },
        writable: strings(&writable),
        protected: protected_display,
        network: SandboxNetworkAccess {
            domains: settings.grants.domains.clone(),
            local_addresses,
            unix_sockets: settings.grants.unix_sockets,
        },
        credentials: SandboxCredentialAccess {
            denied: strings(&credentials),
            brokered: Vec::new(),
        },
        environment: environment.keys().cloned().collect(),
        limits: vec![
            "Descendants stop when the tool host exits".to_owned(),
            "Core dumps are disabled".to_owned(),
            "No CPU, memory, or process-count cap".to_owned(),
        ],
        sandboxed_tools,
        unsandboxed_tools: settings.unsandboxed_tools.clone(),
        disabled_tools,
        placeholders: strings(&placeholders),
        known_gaps: known_gaps(input.adapter, input.executables.platform),
    };
    let policy = SandboxPolicyFile {
        version: SANDBOX_POLICY_VERSION,
        workspace: path_string(&workspace),
        temp_dir: path_string(&temp_dir),
        runtime_config,
        environment,
        no_proxy: proxy_exclusions(&settings.grants.domains),
        unsandboxed_tools: settings.unsandboxed_tools.clone(),
        mcp_servers: Vec::new(),
        mcp_config: None,
        placeholders: strings(&placeholders),
    };
    Ok(ResolvedSandbox {
        effective,
        policy,
        host_directory,
        placeholders,
    })
}

/// Creates the session directories with owner-only permissions and writes
/// the policy file. Returns the policy file path.
pub fn prepare_sandbox(resolved: &ResolvedSandbox) -> Result<PathBuf, SandboxError> {
    create_private_directory(&resolved.host_directory)?;
    create_private_directory(Path::new(&resolved.policy.temp_dir))?;
    let path = resolved.host_directory.join("policy.json");
    write_private_file(
        &path,
        &serde_json::to_vec_pretty(&resolved.policy).expect("policy is serializable"),
    )?;
    Ok(path)
}

/// Writes a file readable only by the current user.
pub fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), SandboxError> {
    let temporary = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    io::Write::write_all(&mut options.open(&temporary)?, contents)?;
    // Rename keeps a watcher from reading a partly written policy.
    fs::rename(temporary, path)?;
    Ok(())
}

fn create_private_directory(path: &Path) -> Result<(), SandboxError> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(path)?;
    Ok(())
}

fn adapter_tools(adapter: SandboxAdapter) -> (Vec<String>, Vec<String>) {
    match adapter {
        SandboxAdapter::Pi => (
            SANDBOXED_PI_TOOLS
                .iter()
                .map(|tool| (*tool).to_owned())
                .collect(),
            vec![
                "Tools from other Pi extensions".to_owned(),
                "Remote MCP servers outside the granted domains".to_owned(),
            ],
        ),
        SandboxAdapter::Claude => (
            vec!["Bash".to_owned()],
            vec![
                "WebFetch".to_owned(),
                "WebSearch".to_owned(),
                "Claude MCP servers".to_owned(),
            ],
        ),
    }
}

fn mechanism(executables: &SandboxExecutables) -> String {
    match &executables.bubblewrap {
        Some(bubblewrap) => format!(
            "Bubblewrap {} with network and PID namespaces and a seccomp socket filter",
            bubblewrap.version.as_deref().unwrap_or("unknown")
        ),
        None => "Seatbelt".to_owned(),
    }
}

fn known_gaps(adapter: SandboxAdapter, platform: SandboxPlatform) -> Vec<String> {
    let mut gaps = Vec::new();
    match platform {
        SandboxPlatform::Linux => gaps.push(
            "Unix sockets cannot be filtered by path, so the socket grant allows all of them"
                .to_owned(),
        ),
        SandboxPlatform::MacOs => gaps.push(
            "Seatbelt enforcement has not been verified by Pau's fixtures on macOS".to_owned(),
        ),
    }
    gaps.push(
        "Reads outside the workspace are allowed apart from the denied paths unless home \
         read-deny is on"
            .to_owned(),
    );
    match adapter {
        SandboxAdapter::Pi => gaps.push(
            "Pi's MCP client connects to remote servers from the Pi process, not through the \
             sandbox proxy"
                .to_owned(),
        ),
        SandboxAdapter::Claude => gaps.push(
            "Claude's Read, Edit, and Write tools follow Claude's permission rules rather than \
             the operating-system sandbox"
                .to_owned(),
        ),
    }
    gaps
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, SandboxError> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| SandboxError::Invalid(format!("{label} {}: {error}", path.display())))?;
    if !canonical.is_dir() {
        return Err(SandboxError::Invalid(format!(
            "{label} {} is not a directory",
            path.display()
        )));
    }
    Ok(canonical)
}

fn canonical_writable_root(root: &Path, home: &Path) -> Result<PathBuf, SandboxError> {
    let canonical = canonical_directory(root, "writable root")?;
    if home.starts_with(&canonical) {
        return Err(SandboxError::Invalid(format!(
            "writable root {} contains the home directory",
            canonical.display()
        )));
    }
    if let Some(credential) = HOME_CREDENTIAL_PATHS
        .iter()
        .map(|entry| home.join(entry))
        .find(|credential| credential.starts_with(&canonical) || canonical.starts_with(credential))
    {
        return Err(SandboxError::Invalid(format!(
            "writable root {} overlaps the credential store {}",
            canonical.display(),
            credential.display()
        )));
    }
    Ok(canonical)
}

pub(super) fn strings(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().map(|path| path_string(path)).collect()
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::fixtures::{array, fixture, resolve};

    #[test]
    fn workspace_write_profile_limits_writes_and_hides_credentials() {
        let fixture = fixture();
        let resolved = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        let config = &resolved.policy.runtime_config;
        let workspace = path_string(&fixture.workspace);
        let temp = path_string(&fixture.session.join("tmp"));

        assert_eq!(
            array(&config["filesystem"]["allowWrite"]),
            [workspace.clone(), temp]
        );
        let deny_read = array(&config["filesystem"]["denyRead"]);
        assert!(deny_read.contains(&path_string(&fixture.home.join(".ssh"))));
        assert!(deny_read.contains(&format!("{workspace}/.env")));
        assert!(deny_read.contains(&path_string(&fixture.session.join("host"))));
        let deny_write = array(&config["filesystem"]["denyWrite"]);
        for protected in [".git/hooks", ".git/config", ".pi", ".claude", ".mcp.json"] {
            assert!(
                deny_write.contains(&format!("{workspace}/{protected}")),
                "{protected}"
            );
        }
        assert!(deny_write.contains(&SHARED_CLAUDE_TEMP.to_owned()));
        assert!(deny_write.contains(&path_string(&fixture.home.join(".npm/_logs"))));
        assert_eq!(config["network"]["allowedDomains"], json!([]));
        assert_eq!(config["bwrapPath"], "/pinned/bwrap");
        assert_eq!(config["socatPath"], "/pinned/socat");
        assert_eq!(config["ripgrep"]["command"], "/pinned/rg");
        assert_eq!(
            resolved.policy.no_proxy,
            "localhost,127.0.0.1,::1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
        );
    }

    #[test]
    fn read_only_profile_writes_only_the_session_temp_directory() {
        let fixture = fixture();
        let settings = SandboxSettings {
            profile: SandboxProfileName::ReadOnly,
            ..SandboxSettings::workspace_write()
        };
        let pi = resolve(&fixture, SandboxAdapter::Pi, &settings).unwrap();
        assert_eq!(
            array(&pi.policy.runtime_config["filesystem"]["allowWrite"]),
            [path_string(&fixture.session.join("tmp"))]
        );
        assert!(pi.placeholders.is_empty());

        let claude = resolve(&fixture, SandboxAdapter::Claude, &settings).unwrap();
        assert!(
            array(&claude.policy.runtime_config["filesystem"]["denyWrite"])
                .contains(&path_string(&fixture.workspace))
        );
    }

    #[test]
    fn environment_is_built_from_scratch() {
        let fixture = fixture();
        let resolved = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        assert_eq!(
            resolved.policy.environment.keys().collect::<Vec<_>>(),
            ["HOME", "LANG", "PATH", "PAU_SANDBOX", "TERM", "TMPDIR"]
        );
        assert_eq!(
            resolved.policy.environment["TMPDIR"],
            path_string(&fixture.session.join("tmp"))
        );
        assert_eq!(resolved.effective.environment.len(), 6);
    }

    #[test]
    fn grants_are_canonicalized_and_validated() {
        let fixture = fixture();
        fs::create_dir_all(fixture.outside.join("cache")).unwrap();
        let linked = fixture.outside.join("linked");
        #[cfg(unix)]
        std::os::unix::fs::symlink(fixture.outside.join("cache"), &linked).unwrap();
        let mut settings = SandboxSettings::workspace_write();
        settings.grants.writable_roots = vec![path_string(&linked)];
        let resolved = resolve(&fixture, SandboxAdapter::Pi, &settings).unwrap();
        assert!(
            resolved
                .effective
                .writable
                .contains(&path_string(&fixture.outside.join("cache")))
        );

        for root in [
            "relative/path".to_owned(),
            path_string(&fixture.outside.join("missing")),
            path_string(fixture.home.parent().unwrap()),
            path_string(&fixture.home),
        ] {
            settings.grants.writable_roots = vec![root.clone()];
            assert!(
                resolve(&fixture, SandboxAdapter::Pi, &settings).is_err(),
                "{root}"
            );
        }
        fs::create_dir_all(fixture.home.join(".ssh/keys")).unwrap();
        settings.grants.writable_roots = vec![path_string(&fixture.home.join(".ssh/keys"))];
        assert!(resolve(&fixture, SandboxAdapter::Pi, &settings).is_err());
    }

    #[test]
    fn granted_local_addresses_leave_no_proxy() {
        let domains = |values: &[&str]| {
            values
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            proxy_exclusions(&domains(&["example.com"])),
            "localhost,127.0.0.1,::1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
        );
        assert_eq!(
            proxy_exclusions(&domains(&["127.0.0.1:8080"])),
            "localhost,::1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
        );
        assert_eq!(
            proxy_exclusions(&domains(&["10.1.2.3", "localhost"])),
            "127.0.0.1,::1,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16"
        );
        assert_eq!(
            proxy_exclusions(&domains(&["[::1]:443"])),
            "localhost,127.0.0.1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
        );
        let fixture = fixture();
        let mut settings = SandboxSettings::workspace_write();
        settings.grants.domains = domains(&["example.com", "192.168.1.5:9000"]);
        let resolved = resolve(&fixture, SandboxAdapter::Pi, &settings).unwrap();
        assert_eq!(
            resolved.effective.network.local_addresses,
            ["192.168.1.5:9000"]
        );
    }

    #[test]
    fn home_read_deny_reallows_the_workspace_and_runtime() {
        let fixture = fixture();
        fs::create_dir_all(fixture.home.join("runtime")).unwrap();
        let mut settings = SandboxSettings::workspace_write();
        settings.home_read_deny = true;
        let resolved = resolve(&fixture, SandboxAdapter::Pi, &settings).unwrap();
        let filesystem = &resolved.policy.runtime_config["filesystem"];
        assert!(array(&filesystem["denyRead"]).contains(&path_string(&fixture.home)));
        let allow_read = array(&filesystem["allowRead"]);
        assert!(allow_read.contains(&path_string(&fixture.workspace)));
        assert!(allow_read.contains(&path_string(&fixture.home.join("runtime"))));
        assert!(resolved.effective.readable.home_denied);
    }

    #[test]
    fn shared_claude_temp_is_an_explicit_choice() {
        let fixture = fixture();
        let mut settings = SandboxSettings::workspace_write();
        settings.share_claude_temp = true;
        let resolved = resolve(&fixture, SandboxAdapter::Pi, &settings).unwrap();
        assert!(
            !array(&resolved.policy.runtime_config["filesystem"]["denyWrite"])
                .contains(&SHARED_CLAUDE_TEMP.to_owned())
        );
    }

    #[test]
    fn predicts_placeholders_at_the_first_missing_component() {
        let fixture = fixture();
        fs::write(fixture.workspace.join(".bashrc"), "# existing\n").unwrap();
        fs::create_dir_all(fixture.workspace.join(".vscode")).unwrap();
        let resolved = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        let names = resolved
            .placeholders
            .iter()
            .map(|path| {
                path.strip_prefix(&fixture.workspace)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>();
        assert!(names.contains(&".claude".to_owned()));
        assert!(names.contains(&".mcp.json".to_owned()));
        assert!(names.contains(&".git/hooks".to_owned()));
        assert!(
            !names.contains(&".bashrc".to_owned()),
            "existing files need no placeholder"
        );
        assert!(names.contains(&".gitconfig".to_owned()));
        assert!(!names.contains(&".vscode".to_owned()));
        assert!(!names.iter().any(|name| name.starts_with(".claude/")));

        fs::remove_dir(fixture.workspace.join(".git")).unwrap();
        fs::write(fixture.workspace.join(".git"), "gitdir: elsewhere\n").unwrap();
        let worktree = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        assert!(
            !worktree
                .placeholders
                .iter()
                .any(|path| path.starts_with(fixture.workspace.join(".git")))
        );
    }

    #[test]
    fn prepared_policy_is_private() {
        let fixture = fixture();
        let resolved = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        let path = prepare_sandbox(&resolved).unwrap();
        let written: SandboxPolicyFile = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written, resolved.policy);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&resolved.host_directory)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert!(fixture.session.join("tmp").is_dir());
    }

    #[test]
    fn effective_profile_names_tools_gaps_and_executables() {
        let fixture = fixture();
        let resolved = resolve(
            &fixture,
            SandboxAdapter::Pi,
            &SandboxSettings::workspace_write(),
        )
        .unwrap();
        let effective = &resolved.effective;
        assert_eq!(effective.sandboxed_tools, SANDBOXED_PI_TOOLS);
        assert!(
            effective
                .disabled_tools
                .iter()
                .any(|tool| tool.contains("other Pi extensions"))
        );
        assert!(effective.mechanism.contains("Bubblewrap 0.12.0"));
        assert_eq!(effective.executables.len(), 3);
        assert!(effective.credentials.brokered.is_empty());
        assert!(!effective.known_gaps.is_empty());
    }
}
