//! Sandboxed Pi launches.
//!
//! Pi's RPC host stays outside the sandbox with its model credentials. Pau
//! loads the `packages/sandbox` extension, which runs every built-in tool in a
//! sandboxed tool host. When pi-mcp-adapter is active, Pau also starts Pi
//! with a session MCP configuration in exclusive mode, so the adapter loads
//! only servers with a contained path: stdio servers, which start inside the
//! sandbox and connect through a relay socket, and remote servers whose host
//! the profile grants.

use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Path, PathBuf},
};

use pau_agent::{DiscoveredMcpServer, McpConfigurationScope};
use pau_core::sandbox::{
    EffectiveSandbox, SandboxAdapter, SandboxError, SandboxExecutables, SandboxLaunchInput,
    SandboxSettings, SandboxedMcpServer, prepare_sandbox, resolve_sandbox, write_private_file,
};
use serde_json::{Map, Value, json};

use crate::StartPiProcessOptions;

/// Unix socket paths longer than this do not fit in `sockaddr_un` on every
/// supported platform.
const MAX_SOCKET_PATH: usize = 100;

/// Fields that select a stdio transport and its process. A relay socket
/// replaces all of them.
const STDIO_FIELDS: &[&str] = &[
    "command",
    "args",
    "env",
    "cwd",
    "pluginDataDir",
    "literalEnv",
    "inheritEnv",
];

/// Inputs for one sandboxed Pi launch.
pub struct PreparePiSandbox<'a> {
    /// Selected profile.
    pub settings: &'a SandboxSettings,
    /// Workspace root.
    pub workspace: &'a Path,
    /// Home directory whose credential stores are hidden.
    pub home: &'a Path,
    /// Pau-owned directory for this session.
    pub session_directory: &'a Path,
    /// Containment executables pinned at startup.
    pub executables: &'a SandboxExecutables,
    /// `packages/sandbox/src/pi-extension.ts`.
    pub extension: &'a Path,
    /// Directories the tool host reads to start: the Node runtime and the
    /// sandbox package with its dependencies.
    pub runtime_roots: &'a [PathBuf],
    /// `PATH` inside the sandbox.
    pub tool_path: &'a str,
    /// Host variables selected for configured credential references. Values
    /// are checked but never copied into Pi's arguments, the variables Pau
    /// adds for Pi, or the sandbox policy. Pi inherits them from Pau, and the
    /// extension's credential proxy reads them there.
    pub credential_environment: &'a BTreeMap<String, String>,
    /// Effective Pi MCP servers, when pi-mcp-adapter is active for Pi.
    pub mcp_servers: Option<&'a [DiscoveredMcpServer]>,
}

/// A prepared launch. Apply it to the process options before starting Pi.
#[derive(Debug, Clone, PartialEq)]
pub struct PiSandboxLaunch {
    /// Profile to show before sandboxed work starts.
    pub effective: EffectiveSandbox,
    /// Policy file the extension watches. Rewrite it to change grants.
    pub policy_file: PathBuf,
    /// Placeholders to record with the process metadata.
    pub placeholders: Vec<PathBuf>,
    arguments: Vec<OsString>,
    environment: Vec<(OsString, OsString)>,
}

impl PiSandboxLaunch {
    /// Adds the extension, MCP configuration, and policy to Pi's options.
    pub fn apply(&self, options: &mut StartPiProcessOptions) {
        options.arguments.extend(self.arguments.iter().cloned());
        options.environment.extend(self.environment.iter().cloned());
    }
}

/// Resolves the policy, writes the policy file and session MCP
/// configuration, and returns the launch. Nothing runs outside the sandbox
/// if the sandbox cannot start: the extension fails every tool call instead.
pub fn prepare_pi_sandbox(input: &PreparePiSandbox<'_>) -> Result<PiSandboxLaunch, SandboxError> {
    let mut resolved = resolve_sandbox(&SandboxLaunchInput {
        adapter: SandboxAdapter::Pi,
        settings: input.settings,
        workspace: input.workspace,
        home: input.home,
        session_directory: input.session_directory,
        executables: input.executables,
        runtime_roots: input.runtime_roots,
        tool_path: input.tool_path,
        credential_environment: input.credential_environment,
    })?;
    let mut arguments = vec![OsString::from("--extension"), input.extension.into()];
    let mut environment = Vec::new();
    let mut mcp_config = None;
    if let Some(servers) = input.mcp_servers {
        let session_mcp = session_mcp(
            servers,
            input.settings,
            &resolved.host_directory,
            Path::new(&resolved.policy.workspace),
        )?;
        let path = resolved.host_directory.join("mcp.json");
        mcp_config = Some((path, session_mcp.configuration));
        resolved.policy.mcp_servers = session_mcp.contained;
        resolved
            .effective
            .sandboxed_tools
            .extend(session_mcp.sandboxed);
        resolved
            .effective
            .disabled_tools
            .extend(session_mcp.disabled);
    }
    if let Some((path, _)) = &mcp_config {
        resolved.policy.mcp_config = Some(path.to_string_lossy().into_owned());
        arguments.extend([OsString::from("--mcp-config"), path.into()]);
        // Exclusive mode loads only the session configuration, so no other
        // source can add a server that runs in the Pi process.
        environment.push(("PI_MCP_CONFIG_MODE".into(), "exclusive".into()));
    }
    let policy_file = prepare_sandbox(&resolved)?;
    if let Some((path, configuration)) = mcp_config {
        write_private_file(
            &path,
            &serde_json::to_vec_pretty(&configuration).expect("configuration is serializable"),
        )?;
    }
    environment.push(("PAU_SANDBOX_POLICY_FILE".into(), policy_file.clone().into()));
    Ok(PiSandboxLaunch {
        effective: resolved.effective,
        policy_file,
        placeholders: resolved.placeholders,
        arguments,
        environment,
    })
}

struct SessionMcp {
    configuration: Value,
    contained: Vec<SandboxedMcpServer>,
    sandboxed: Vec<String>,
    disabled: Vec<String>,
}

fn session_mcp(
    servers: &[DiscoveredMcpServer],
    settings: &SandboxSettings,
    host_directory: &Path,
    workspace: &Path,
) -> Result<SessionMcp, SandboxError> {
    let domains = &settings.grants.domains;
    let credential_sources: Vec<String> = settings
        .credential_references
        .iter()
        .map(|reference| reference.source.clone())
        .collect();
    let mut entries = Map::new();
    let mut contained = Vec::new();
    let mut sandboxed = Vec::new();
    let mut disabled = Vec::new();
    for server in servers.iter().filter(|server| !server.disabled) {
        let Some(definition) = server.definition.as_object() else {
            continue;
        };
        if let Some(command) = definition.get("command").and_then(Value::as_str) {
            let socket = host_directory.join(format!("mcp-{}.sock", contained.len()));
            let socket_text = socket.to_string_lossy().into_owned();
            if socket_text.len() > MAX_SOCKET_PATH {
                return Err(SandboxError::Invalid(format!(
                    "the session directory is too long for an MCP relay socket: {socket_text}"
                )));
            }
            let mut entry = definition.clone();
            for field in STDIO_FIELDS {
                entry.remove(*field);
            }
            entry.insert("socket".into(), json!(socket_text));
            entries.insert(server.name.clone(), Value::Object(entry));
            // Commands, arguments, the working directory and variables keep
            // their `${NAME}` references. The extension expands them when it
            // starts the server, so their values never reach the policy file.
            contained.push(SandboxedMcpServer {
                name: server.name.clone(),
                socket: socket_text,
                command: command.to_owned(),
                args: strings(definition.get("args")),
                cwd: definition
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map_or_else(|| workspace.to_string_lossy().into_owned(), str::to_owned),
                env: definition
                    .get("env")
                    .and_then(Value::as_object)
                    .map(|env| {
                        env.iter()
                            .filter_map(|(name, value)| {
                                value.as_str().map(|value| (name.clone(), value.to_owned()))
                            })
                            .collect()
                    })
                    .unwrap_or_else(BTreeMap::new),
                variables: if user_scope_only(server) {
                    None
                } else {
                    Some(credential_sources.clone())
                },
            });
            sandboxed.push(format!("MCP server {}", server.name));
        } else if let Some(url) = definition.get("url").and_then(Value::as_str) {
            if url_host(url).is_some_and(|host| domain_granted(host, domains)) {
                entries.insert(server.name.clone(), server.definition.clone());
                sandboxed.push(format!(
                    "MCP server {} through its granted domain",
                    server.name
                ));
            } else {
                disabled.push(format!(
                    "MCP server {}: its host is not a granted domain",
                    server.name
                ));
            }
        } else {
            disabled.push(format!(
                "MCP server {}: its transport has no contained launch path",
                server.name
            ));
        }
    }
    Ok(SessionMcp {
        configuration: json!({ "mcpServers": entries }),
        contained,
        sandboxed,
        disabled,
    })
}

/// Whether only user-scope files, which the operator wrote, define the
/// server. A server without recorded sources does not count.
fn user_scope_only(server: &DiscoveredMcpServer) -> bool {
    !server.sources.is_empty()
        && server
            .sources
            .iter()
            .all(|source| source.scope == McpConfigurationScope::User)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect()
}

fn url_host(url: &str) -> Option<&str> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host_port = authority.rsplit('@').next()?;
    if let Some(bracketed) = host_port.strip_prefix('[') {
        return bracketed.split_once(']').map(|(host, _)| host);
    }
    host_port.split(':').next().filter(|host| !host.is_empty())
}

/// Whether a granted domain admits `host` on some port. Port-specific grants
/// still match, because the proxy enforces the port for commands.
fn domain_granted(host: &str, domains: &[String]) -> bool {
    domains.iter().any(|domain| {
        let granted = domain
            .strip_prefix('[')
            .and_then(|rest| rest.split_once(']').map(|(host, _)| host))
            .unwrap_or_else(|| domain.split(':').next().unwrap_or(domain));
        match granted.strip_prefix("*.") {
            Some(suffix) => host
                .strip_suffix(suffix)
                .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1),
            None => granted.eq_ignore_ascii_case(host),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pau_agent::{McpConfigurationKind, McpServerSource};
    use pau_core::sandbox::SandboxCredentialReference;

    fn server(name: &str, definition: Value) -> DiscoveredMcpServer {
        DiscoveredMcpServer {
            name: name.to_owned(),
            definition,
            disabled: false,
            sources: Vec::new(),
        }
    }

    /// `server` defined by files of the given scopes, in precedence order.
    fn scoped(
        name: &str,
        definition: Value,
        scopes: &[McpConfigurationScope],
    ) -> DiscoveredMcpServer {
        DiscoveredMcpServer {
            sources: scopes
                .iter()
                .map(|scope| McpServerSource {
                    path: PathBuf::from("/config/mcp.json"),
                    scope: *scope,
                    kind: McpConfigurationKind::Shared,
                })
                .collect(),
            ..server(name, definition)
        }
    }

    /// Workspace-write settings with `domains` granted and one credential
    /// reference to `PAU_TEST_CREDENTIAL`.
    fn settings(domains: &[&str]) -> SandboxSettings {
        let mut settings = SandboxSettings::workspace_write();
        settings.grants.domains = domains.iter().map(|domain| (*domain).to_owned()).collect();
        settings.credential_references = vec![SandboxCredentialReference {
            source: "PAU_TEST_CREDENTIAL".into(),
            shape: Default::default(),
            destinations: vec!["api.example.com".into()],
        }];
        settings
    }

    #[test]
    fn contains_stdio_servers_and_granted_remote_servers() {
        // A set variable shows that its value stays out of the policy.
        // SAFETY: no other test reads this variable.
        unsafe { std::env::set_var("PAU_TEST_MCP_TOKEN", "mcp-secret-value") };
        let host = Path::new("/state/session/host");
        let workspace = Path::new("/work");
        let servers = [
            scoped(
                "files",
                json!({"command": "files-mcp", "args": ["--root", "."], "cwd": "tools", "env": {"MODE": "ro", "TOKEN": "${PAU_TEST_MCP_TOKEN}"}, "lifecycle": "lazy"}),
                &[McpConfigurationScope::User],
            ),
            // A project file that only adds a variable still restricts the
            // user's server.
            scoped(
                "repo",
                json!({"command": "repo-mcp", "env": {"T": "${GITHUB_TOKEN}"}}),
                &[McpConfigurationScope::User, McpConfigurationScope::Project],
            ),
            server(
                "docs",
                json!({"url": "https://docs.example.com/mcp", "auth": "oauth"}),
            ),
            server("tracker", json!({"url": "https://tracker.example.org/mcp"})),
            server("shared", json!({"socket": "/tmp/mux.sock"})),
            DiscoveredMcpServer {
                disabled: true,
                ..server("off", json!({"command": "off-mcp"}))
            },
        ];
        let session =
            session_mcp(&servers, &settings(&["*.example.com"]), host, workspace).unwrap();

        assert_eq!(
            session.configuration,
            json!({"mcpServers": {
                "files": {"socket": "/state/session/host/mcp-0.sock", "lifecycle": "lazy"},
                "repo": {"socket": "/state/session/host/mcp-1.sock"},
                "docs": {"url": "https://docs.example.com/mcp", "auth": "oauth"},
            }})
        );
        assert_eq!(
            session.contained,
            [
                SandboxedMcpServer {
                    name: "files".into(),
                    socket: "/state/session/host/mcp-0.sock".into(),
                    command: "files-mcp".into(),
                    args: vec!["--root".into(), ".".into()],
                    cwd: "tools".into(),
                    env: BTreeMap::from([
                        ("MODE".into(), "ro".into()),
                        ("TOKEN".into(), "${PAU_TEST_MCP_TOKEN}".into()),
                    ]),
                    variables: None,
                },
                SandboxedMcpServer {
                    name: "repo".into(),
                    socket: "/state/session/host/mcp-1.sock".into(),
                    command: "repo-mcp".into(),
                    args: Vec::new(),
                    cwd: "/work".into(),
                    env: BTreeMap::from([("T".into(), "${GITHUB_TOKEN}".into())]),
                    variables: Some(vec!["PAU_TEST_CREDENTIAL".into()]),
                }
            ]
        );
        assert_eq!(session.disabled.len(), 2);
        assert!(
            session
                .disabled
                .iter()
                .any(|entry| entry.contains("tracker"))
        );
        assert!(
            session
                .disabled
                .iter()
                .any(|entry| entry.contains("shared"))
        );
    }

    #[test]
    fn rejects_relay_sockets_that_do_not_fit() {
        let host = PathBuf::from(format!("/{}", "long/".repeat(30)));
        let servers = [server("files", json!({"command": "files-mcp"}))];
        assert!(session_mcp(&servers, &settings(&[]), &host, Path::new("/work")).is_err());
    }

    #[test]
    fn matches_granted_hosts() {
        let domains = ["*.example.com".to_owned(), "api.test.org:443".to_owned()];
        assert!(domain_granted("docs.example.com", &domains));
        assert!(!domain_granted("example.com", &domains));
        assert!(!domain_granted("evilexample.com", &domains));
        assert!(domain_granted("api.test.org", &domains));
        assert_eq!(
            url_host("https://user@docs.example.com:8443/mcp"),
            Some("docs.example.com")
        );
        assert_eq!(url_host("http://[::1]:9000/mcp"), Some("::1"));
        assert_eq!(url_host("not a url"), None);
    }
}
