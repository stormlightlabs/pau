//! Discovery of MCP configuration used by `pi-mcp-adapter`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use jsonc_parser::parse_to_serde_value;
use pau_agent::{
    DiscoveredMcpServer, McpAdapterCapabilities, McpAgent, McpConfigurationDiscovery,
    McpConfigurationDocument, McpConfigurationKind, McpConfigurationScope, McpDiagnostic,
    McpDiagnosticLevel, McpDiscoveryError, McpOperationResult, McpServerSource,
};
use serde_json::json;

use crate::{PiProcess, PiProcessError};
use semver::Version;
use serde_json::Value;

/// Adapter release exercised by Pau.
pub const PINNED_PI_MCP_ADAPTER_VERSION: &str = "2.37.0";
/// Newer compatible release exercised by Pau.
pub const LATEST_VERIFIED_PI_MCP_ADAPTER_VERSION: &str = "2.38.0";

/// Finite MCP operation delegated to the installed adapter through Pi RPC.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiMcpOperation {
    /// Persist the highest-precedence enabled override and reload Pi resources.
    Enable { name: String },
    /// Persist the highest-precedence disabled override and reload Pi resources.
    Disable { name: String },
    /// Start the adapter-owned OAuth flow.
    Authenticate { name: String },
    /// Connect or reconnect one server and refresh its negotiated catalog.
    Test { name: String },
}

/// Capabilities of the pinned adapter as used through Pi RPC.
pub fn pi_mcp_capabilities(permission_passthrough: bool) -> McpAdapterCapabilities {
    McpAdapterCapabilities {
        create: true,
        edit: true,
        remove: true,
        enable: true,
        disable: true,
        authenticate: true,
        test: true,
        lazy_connect: true,
        permission_passthrough,
    }
}

/// Runs a supported adapter command through Pi's extension-command path.
///
/// The adapter owns connections, OAuth storage, approval and elicitation. Pau
/// consumes the resulting extension UI notifications and status updates; it
/// does not parse the adapter's terminal-only panel.
pub async fn run_pi_mcp_operation(
    process: &PiProcess,
    operation: PiMcpOperation,
) -> Result<McpOperationResult, PiProcessError> {
    let (command, success_message, failure_message, reload) = match operation {
        PiMcpOperation::Enable { name } => (
            format!("/mcp enable {name}"),
            format!("Pi enabled MCP server {name:?}."),
            format!("Pi could not enable MCP server {name:?}."),
            true,
        ),
        PiMcpOperation::Disable { name } => (
            format!("/mcp disable {name}"),
            format!("Pi disabled MCP server {name:?}."),
            format!("Pi could not disable MCP server {name:?}."),
            true,
        ),
        PiMcpOperation::Authenticate { name } => (
            format!("/mcp-auth {name}"),
            format!("Pi completed the MCP authentication command for {name:?}."),
            format!("Pi could not run MCP authentication for {name:?}."),
            false,
        ),
        PiMcpOperation::Test { name } => (
            format!("/mcp reconnect {name}"),
            format!("Pi completed the MCP connection test for {name:?}."),
            format!("Pi could not test MCP server {name:?}."),
            false,
        ),
    };
    let response = process
        .command(json!({"type": "prompt", "message": command}))
        .await?;
    let mut success = response
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if success && reload {
        let reload_response = process
            .command(json!({"type": "prompt", "message": "/reload"}))
            .await?;
        success = reload_response
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    }
    Ok(McpOperationResult {
        success,
        diagnostic: McpDiagnostic {
            level: if success {
                McpDiagnosticLevel::Info
            } else {
                McpDiagnosticLevel::Error
            },
            message: if success {
                success_message
            } else {
                failure_message
            },
        },
    })
}

/// Paths needed to inspect Pi and adapter configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoverPiMcpOptions {
    /// User home used by shared MCP paths.
    pub home_directory: PathBuf,
    /// Pi agent directory, normally `~/.pi/agent`.
    pub agent_directory: PathBuf,
    /// Workspace root.
    pub workspace: PathBuf,
}

/// Whether the explicitly configured adapter package can serve Pi MCP.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiMcpAdapterState {
    /// Pi settings do not declare the package, or its installed files are absent.
    Absent,
    /// Pi settings declare the package but filter out its extension.
    Disabled,
    /// The declared package is installed and its extension is enabled.
    Ready,
}

/// Compatibility of the installed adapter release.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiMcpAdapterCompatibility {
    /// The pinned release was found.
    Pinned,
    /// A newer compatible and verified release was found.
    CompatibleUpdate,
    /// A release outside the verified compatible range was found.
    Unverified,
}

/// Actionable state of Pi's selected MCP package.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiMcpAdapterAvailability {
    /// Package availability.
    pub state: PiMcpAdapterState,
    /// Installed package version, when readable.
    pub version: Option<Version>,
    /// Relationship to the releases verified by Pau.
    pub compatibility: Option<PiMcpAdapterCompatibility>,
    /// Operator action when configured Pi MCP cannot be used.
    pub action: Option<String>,
}

/// Pi MCP discovery without package installation, activation, or connection.
#[derive(Clone, Debug, PartialEq)]
pub struct PiMcpDiscovery {
    /// Native source documents and effective servers.
    pub configuration: McpConfigurationDiscovery,
    /// State of the explicitly configured adapter package.
    pub adapter: PiMcpAdapterAvailability,
    /// Whether Pi's already configured adapter remains active independently of
    /// Pau-managed enablement.
    pub native_configuration_active: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct PackageDeclaration {
    pub(crate) source: String,
    pub(crate) settings_path: PathBuf,
    pub(crate) extensions: Option<Vec<String>>,
}

/// Discovers documented adapter sources in native precedence order.
pub fn discover_pi_mcp(
    options: &DiscoverPiMcpOptions,
) -> Result<PiMcpDiscovery, McpDiscoveryError> {
    let user_settings = options.agent_directory.join("settings.json");
    let project_settings = options.workspace.join(".pi/settings.json");
    let packages = effective_packages(&user_settings, &project_settings)?;
    let adapter_declaration = packages.values().find(|package| {
        package_identity(&package.source).as_deref() == Some("pi-mcp-adapter")
            || package_root(package)
                .and_then(|root| {
                    read_jsonc_optional(&root.join("package.json"))
                        .ok()
                        .flatten()
                })
                .and_then(|manifest| {
                    manifest
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .as_deref()
                == Some("pi-mcp-adapter")
    });
    let adapter = inspect_adapter(adapter_declaration);

    let mut documents = Vec::new();
    let mut layers = Vec::new();
    for (path, scope, kind) in pi_config_paths(options)? {
        if !path.is_file() {
            continue;
        }
        let document = McpConfigurationDocument::read(path, McpAgent::Pi, scope, kind)?;
        layers.push((document.server_entries(), source_for(&document)));
        documents.push(document);
    }

    // Package MCP declarations are lower precedence than normal adapter files.
    // Insert them before every file layer while retaining their original names
    // in the source document and their prefixed effective Pi names in the layer.
    let mut package_documents = Vec::new();
    let mut package_layers = Vec::new();
    for declaration in packages.values() {
        let Some(root) = package_root(declaration).and_then(|root| fs::canonicalize(root).ok())
        else {
            continue;
        };
        let manifest_path = root.join("package.json");
        let Some(manifest) = read_jsonc_optional(&manifest_path)? else {
            continue;
        };
        let Some(package_name) = manifest.get("name").and_then(Value::as_str) else {
            continue;
        };
        for relative_path in manifest_mcp_paths(manifest.pointer("/pi/mcp")) {
            let Ok(path) = fs::canonicalize(root.join(relative_path)) else {
                continue;
            };
            if !path.is_file() || !path.starts_with(&root) {
                continue;
            }
            let document = McpConfigurationDocument::read(
                path,
                McpAgent::Pi,
                McpConfigurationScope::Package,
                McpConfigurationKind::Package,
            )?;
            let prefix = sanitize_name(package_name);
            let entries = document
                .server_entries()
                .into_iter()
                .map(|(name, value)| (format!("{prefix}__{}", sanitize_name(&name)), value))
                .collect();
            package_layers.push((entries, source_for(&document)));
            package_documents.push(document);
        }
    }
    package_documents.append(&mut documents);
    package_layers.append(&mut layers);
    let configuration = merge_pi_layers(package_documents, package_layers);
    let native_configuration_active = adapter.state == PiMcpAdapterState::Ready
        && configuration.servers.iter().any(|server| !server.disabled);

    Ok(PiMcpDiscovery {
        configuration,
        adapter,
        native_configuration_active,
    })
}

fn pi_config_paths(
    options: &DiscoverPiMcpOptions,
) -> Result<Vec<(PathBuf, McpConfigurationScope, McpConfigurationKind)>, McpDiscoveryError> {
    let mut paths = vec![
        (
            options.home_directory.join(".config/mcp/mcp.json"),
            McpConfigurationScope::User,
            McpConfigurationKind::Shared,
        ),
        (
            options.home_directory.join(".agents/mcp.json"),
            McpConfigurationScope::User,
            McpConfigurationKind::Shared,
        ),
        (
            options.home_directory.join(".agents/mcp/mcp.json"),
            McpConfigurationScope::User,
            McpConfigurationKind::Shared,
        ),
        (
            options.agent_directory.join("mcp.json"),
            McpConfigurationScope::User,
            McpConfigurationKind::Agent,
        ),
    ];

    if let Some(root) = configured_ancestor_root(options, &paths)? {
        let workspace =
            fs::canonicalize(&options.workspace).unwrap_or_else(|_| options.workspace.clone());
        let mut directory = workspace.parent();
        let mut ancestors = Vec::new();
        while let Some(current) = directory {
            if !current.starts_with(&root) {
                break;
            }
            ancestors.push(current.to_path_buf());
            if current == root {
                break;
            }
            directory = current.parent();
        }
        ancestors.reverse();
        for ancestor in ancestors {
            paths.push((
                ancestor.join(".mcp.json"),
                McpConfigurationScope::Project,
                McpConfigurationKind::Shared,
            ));
            paths.push((
                ancestor.join(".pi/mcp.json"),
                McpConfigurationScope::Project,
                McpConfigurationKind::Agent,
            ));
        }
    }

    paths.push((
        options.workspace.join(".mcp.json"),
        McpConfigurationScope::Project,
        McpConfigurationKind::Shared,
    ));
    paths.push((
        options.workspace.join(".pi/mcp.json"),
        McpConfigurationScope::Project,
        McpConfigurationKind::Agent,
    ));
    Ok(paths)
}

fn configured_ancestor_root(
    options: &DiscoverPiMcpOptions,
    global_paths: &[(PathBuf, McpConfigurationScope, McpConfigurationKind)],
) -> Result<Option<PathBuf>, McpDiscoveryError> {
    let mut configured = None;
    for (path, _, _) in global_paths {
        if let Some(value) = read_jsonc_optional(path)?
            && let Some(roots) = value.pointer("/settings/ancestorConfigRoots")
        {
            configured = roots.as_array().cloned();
        }
    }
    let Some(configured) = configured else {
        return Ok(None);
    };
    let home = fs::canonicalize(&options.home_directory)
        .unwrap_or_else(|_| options.home_directory.clone());
    let workspace =
        fs::canonicalize(&options.workspace).unwrap_or_else(|_| options.workspace.clone());
    let mut roots = configured
        .iter()
        .filter_map(Value::as_str)
        .map(|path| {
            path.strip_prefix("~/")
                .map(|path| home.join(path))
                .unwrap_or_else(|| PathBuf::from(path))
        })
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.starts_with(&home) && workspace.starts_with(path))
        .collect::<Vec<_>>();
    roots.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    Ok(roots.into_iter().next())
}

fn merge_pi_layers(
    documents: Vec<McpConfigurationDocument>,
    layers: Vec<(BTreeMap<String, Value>, McpServerSource)>,
) -> McpConfigurationDiscovery {
    let mut effective: BTreeMap<String, DiscoveredMcpServer> = BTreeMap::new();
    for (entries, source) in layers {
        for (name, definition) in entries {
            let entry = effective
                .entry(name.clone())
                .or_insert_with(|| DiscoveredMcpServer {
                    name,
                    definition: Value::Object(Default::default()),
                    disabled: false,
                    sources: Vec::new(),
                });
            merge_pi_server_definition(&mut entry.definition, definition);
            entry.disabled = entry
                .definition
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            entry.sources.push(source.clone());
        }
    }
    McpConfigurationDiscovery {
        documents,
        servers: effective.into_values().collect(),
    }
}

fn merge_pi_server_definition(base: &mut Value, next: Value) {
    let Some(mut merged) = base.as_object().cloned() else {
        *base = next;
        return;
    };
    let Value::Object(next) = next else {
        return;
    };
    let old_url = merged.get("url").and_then(Value::as_str).map(str::to_owned);
    if next.get("command").and_then(Value::as_str).is_some() {
        remove_fields(
            &mut merged,
            &[
                "url",
                "headers",
                "requestHeadersCommand",
                "caFile",
                "auth",
                "bearerToken",
                "bearerTokenEnv",
                "bearerTokenStore",
                "oauth",
                "httpTransport",
                "socket",
            ],
        );
    } else if next.get("url").and_then(Value::as_str).is_some() {
        remove_fields(
            &mut merged,
            &[
                "command",
                "args",
                "env",
                "cwd",
                "pluginDataDir",
                "literalEnv",
                "inheritEnv",
                "socket",
            ],
        );
    } else if next.get("socket").and_then(Value::as_str).is_some() {
        remove_fields(
            &mut merged,
            &[
                "command",
                "args",
                "env",
                "cwd",
                "pluginDataDir",
                "literalEnv",
                "inheritEnv",
                "url",
                "headers",
                "requestHeadersCommand",
                "caFile",
                "auth",
                "bearerToken",
                "bearerTokenEnv",
                "bearerTokenStore",
                "oauth",
                "httpTransport",
            ],
        );
    }
    if let Some(new_url) = next.get("url").and_then(Value::as_str)
        && old_url.as_deref().is_some_and(|old_url| old_url != new_url)
    {
        remove_fields(
            &mut merged,
            &[
                "headers",
                "bearerToken",
                "bearerTokenEnv",
                "bearerTokenStore",
                "requestHeadersCommand",
                "caFile",
            ],
        );
        if merged.get("oauth") != Some(&Value::Bool(false)) {
            merged.remove("oauth");
        }
    }
    merged.extend(next);
    *base = Value::Object(merged);
}

fn remove_fields(object: &mut serde_json::Map<String, Value>, fields: &[&str]) {
    for field in fields {
        object.remove(*field);
    }
}

fn effective_packages(
    user_settings: &Path,
    project_settings: &Path,
) -> Result<BTreeMap<String, PackageDeclaration>, McpDiscoveryError> {
    let mut packages = BTreeMap::new();
    for path in [user_settings, project_settings] {
        let Some(settings) = read_jsonc_optional(path)? else {
            continue;
        };
        let Some(entries) = settings.get("packages").and_then(Value::as_array) else {
            continue;
        };
        for entry in entries {
            let (source, extensions) = match entry {
                Value::String(source) => (source.clone(), None),
                Value::Object(object) => {
                    let Some(source) = object.get("source").and_then(Value::as_str) else {
                        continue;
                    };
                    let extensions =
                        object
                            .get("extensions")
                            .and_then(Value::as_array)
                            .map(|items| {
                                items
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect()
                            });
                    (source.to_owned(), extensions)
                }
                _ => continue,
            };
            let identity = package_key(&source, path.parent().unwrap_or_else(|| Path::new(".")));
            packages.insert(
                identity,
                PackageDeclaration {
                    source,
                    settings_path: path.to_path_buf(),
                    extensions,
                },
            );
        }
    }
    Ok(packages)
}

fn inspect_adapter(declaration: Option<&PackageDeclaration>) -> PiMcpAdapterAvailability {
    let Some(declaration) = declaration else {
        return PiMcpAdapterAvailability {
            state: PiMcpAdapterState::Absent,
            version: None,
            compatibility: None,
            action: Some(format!(
                "Install and review the selected package with `pi install npm:pi-mcp-adapter@{PINNED_PI_MCP_ADAPTER_VERSION}`."
            )),
        };
    };
    if !extension_enabled(declaration.extensions.as_deref()) {
        return PiMcpAdapterAvailability {
            state: PiMcpAdapterState::Disabled,
            version: None,
            compatibility: None,
            action: Some(
                "Enable pi-mcp-adapter's index.ts extension with `pi config`, then restart Pi."
                    .to_owned(),
            ),
        };
    }
    let Some(root) = package_root(declaration) else {
        return missing_installation();
    };
    let Ok(Some(manifest)) = read_jsonc_optional(&root.join("package.json")) else {
        return missing_installation();
    };
    if manifest.get("name").and_then(Value::as_str) != Some("pi-mcp-adapter") {
        return missing_installation();
    }
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .and_then(|version| Version::parse(version).ok());
    let compatibility = version.as_ref().map(adapter_compatibility);
    PiMcpAdapterAvailability {
        state: PiMcpAdapterState::Ready,
        version,
        compatibility,
        action: None,
    }
}

fn missing_installation() -> PiMcpAdapterAvailability {
    PiMcpAdapterAvailability {
        state: PiMcpAdapterState::Absent,
        version: None,
        compatibility: None,
        action: Some(
            "Run `pi update --extensions` to install the package already declared in Pi settings."
                .to_owned(),
        ),
    }
}

fn adapter_compatibility(version: &Version) -> PiMcpAdapterCompatibility {
    let pinned = Version::parse(PINNED_PI_MCP_ADAPTER_VERSION).unwrap();
    let latest = Version::parse(LATEST_VERIFIED_PI_MCP_ADAPTER_VERSION).unwrap();
    if version == &pinned {
        PiMcpAdapterCompatibility::Pinned
    } else if version.major == pinned.major && version >= &pinned && version <= &latest {
        PiMcpAdapterCompatibility::CompatibleUpdate
    } else {
        PiMcpAdapterCompatibility::Unverified
    }
}

fn extension_enabled(filters: Option<&[String]>) -> bool {
    let Some(filters) = filters else {
        return true;
    };
    let mut enabled = false;
    for filter in filters {
        let normalized = filter
            .trim_start_matches(['+', '-', '!'])
            .trim_start_matches("./");
        let matches = normalized == "index.ts" || normalized == "*.ts" || normalized == "*";
        if matches {
            enabled = !filter.starts_with(['-', '!']);
        }
    }
    enabled
}

fn package_identity(source: &str) -> Option<String> {
    let source = source.strip_prefix("npm:")?;
    if source.starts_with('@') {
        let slash = source.find('/')?;
        let end = source[slash..]
            .find('@')
            .map(|index| slash + index)
            .unwrap_or(source.len());
        Some(source[..end].to_owned())
    } else {
        Some(source.split('@').next()?.to_owned())
    }
}

pub(crate) fn package_key(source: &str, settings_directory: &Path) -> String {
    if let Some(identity) = package_identity(source) {
        return format!("npm:{identity}");
    }
    if let Some(path) = git_package_path(source) {
        return format!("git:{}", path.display());
    }
    let path = Path::new(source);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        settings_directory.join(path)
    };
    format!("local:{}", path.display())
}

pub(crate) fn package_root(declaration: &PackageDeclaration) -> Option<PathBuf> {
    let settings_directory = declaration.settings_path.parent()?;
    if let Some(identity) = package_identity(&declaration.source) {
        return Some(settings_directory.join("npm/node_modules").join(identity));
    }
    if let Some(path) = git_package_path(&declaration.source) {
        return Some(settings_directory.join("git").join(path));
    }
    let path = Path::new(&declaration.source);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        settings_directory.join(path)
    })
}

fn git_package_path(source: &str) -> Option<PathBuf> {
    let source = source.strip_prefix("git:").unwrap_or(source);
    let source = if let Some(path) = source.strip_prefix("git@") {
        path.replacen(':', "/", 1)
    } else if let Some(path) = source.strip_prefix("ssh://git@") {
        path.to_owned()
    } else if let Some((_, path)) = source.split_once("://") {
        path.to_owned()
    } else {
        return None;
    };
    let source = source
        .rsplit_once('@')
        .map(|(path, _)| path)
        .unwrap_or(&source)
        .trim_end_matches(".git");
    (!source.starts_with('/') && !source.is_empty()).then(|| PathBuf::from(source))
}

fn manifest_mcp_paths(value: Option<&Value>) -> Vec<PathBuf> {
    match value {
        Some(Value::String(path)) => vec![PathBuf::from(path)],
        Some(Value::Array(paths)) => paths
            .iter()
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect(),
        _ => Vec::new(),
    }
}

fn read_jsonc_optional(path: &Path) -> Result<Option<Value>, McpDiscoveryError> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|source| McpDiscoveryError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let value = parse_to_serde_value(&raw, &Default::default()).map_err(|error| {
        McpDiscoveryError::Parse {
            path: path.to_path_buf(),
            message: error.to_string(),
        }
    })?;
    Ok(Some(value))
}

fn sanitize_name(name: &str) -> String {
    let name = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let name = name.trim_matches(['_', '-']);
    if name.is_empty() {
        "package".to_owned()
    } else {
        name.to_owned()
    }
}

fn source_for(document: &McpConfigurationDocument) -> McpServerSource {
    McpServerSource {
        path: document.path.clone(),
        scope: document.scope,
        kind: document.kind,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn fixture(version: &str, filters: Option<&str>) -> (tempfile::TempDir, DiscoverPiMcpOptions) {
        let directory = tempdir().unwrap();
        let home = directory.path().join("home");
        let agent = home.join(".pi/agent");
        let workspace = directory.path().join("work");
        let package = agent.join("npm/node_modules/pi-mcp-adapter");
        fs::create_dir_all(&package).unwrap();
        fs::create_dir_all(workspace.join(".pi")).unwrap();
        fs::create_dir_all(home.join(".config/mcp")).unwrap();
        fs::write(
            package.join("package.json"),
            format!("{{\"name\":\"pi-mcp-adapter\",\"version\":\"{version}\"}}"),
        )
        .unwrap();
        let package_entry = filters.unwrap_or("\"npm:pi-mcp-adapter@2.37.0\"");
        fs::write(
            agent.join("settings.json"),
            format!("{{\"packages\":[{package_entry}],\"unknown\":true}}"),
        )
        .unwrap();
        (
            directory,
            DiscoverPiMcpOptions {
                home_directory: home,
                agent_directory: agent,
                workspace,
            },
        )
    }

    #[test]
    fn follows_adapter_precedence_and_preserves_unknown_fields() {
        for (version, compatibility) in [
            ("2.37.0", PiMcpAdapterCompatibility::Pinned),
            ("2.38.0", PiMcpAdapterCompatibility::CompatibleUpdate),
        ] {
            let (_directory, options) = fixture(version, None);
            let global = "{\n  // retained\n  \"mcpServers\": {\n    \"docs\": { \"command\": \"global\", \"unknown\": { \"a\": 1 } },\n    \"disabled\": { \"command\": \"no\", \"disabled\": true },\n    \"remote\": { \"url\": \"https://old.example/mcp\", \"headers\": { \"Authorization\": \"secret\" }, \"future\": true }\n  },\n  \"future\": true\n}\n";
            fs::write(options.home_directory.join(".config/mcp/mcp.json"), global).unwrap();
            fs::write(
                options.workspace.join(".mcp.json"),
                "{\"mcpServers\":{\"docs\":{\"args\":[\"project\"]},\"remote\":{\"url\":\"https://new.example/mcp\"}}}",
            )
            .unwrap();
            fs::write(
                options.workspace.join(".pi/mcp.json"),
                "{\"mcpServers\":{\"docs\":{\"command\":\"pi\",\"disabled\":false}}}",
            )
            .unwrap();

            let discovery = discover_pi_mcp(&options).unwrap();
            assert_eq!(discovery.adapter.state, PiMcpAdapterState::Ready);
            assert_eq!(discovery.adapter.compatibility, Some(compatibility));
            assert!(discovery.native_configuration_active);
            assert_eq!(
                discovery.configuration.documents[0].round_trip_text(),
                global
            );
            let docs = discovery
                .configuration
                .servers
                .iter()
                .find(|server| server.name == "docs")
                .unwrap();
            assert_eq!(docs.definition["command"], "pi");
            assert_eq!(docs.definition["args"][0], "project");
            assert_eq!(docs.definition["unknown"]["a"], 1);
            assert!(!docs.disabled);
            assert!(
                discovery
                    .configuration
                    .servers
                    .iter()
                    .find(|server| server.name == "disabled")
                    .unwrap()
                    .disabled
            );
            let remote = discovery
                .configuration
                .servers
                .iter()
                .find(|server| server.name == "remote")
                .unwrap();
            assert_eq!(remote.definition["url"], "https://new.example/mcp");
            assert_eq!(remote.definition["future"], true);
            assert!(remote.definition.get("headers").is_none());
        }
    }

    #[test]
    fn discovers_opted_in_ancestor_sources_with_nearest_precedence() {
        let (_directory, mut options) = fixture("2.37.0", None);
        let root = options.home_directory.join("work/team");
        options.workspace = root.join("nested/work");
        fs::create_dir_all(options.workspace.join(".pi")).unwrap();
        fs::write(
            options.home_directory.join(".config/mcp/mcp.json"),
            format!(
                "{{\"settings\":{{\"ancestorConfigRoots\":[{}]}},\"mcpServers\":{{\"docs\":{{\"command\":\"global\"}}}}}}",
                serde_json::to_string(root.to_str().unwrap()).unwrap()
            ),
        )
        .unwrap();
        fs::write(
            root.join(".mcp.json"),
            "{\"mcpServers\":{\"docs\":{\"args\":[\"root\"]}}}",
        )
        .unwrap();
        fs::create_dir_all(root.join("nested/.pi")).unwrap();
        fs::write(
            root.join("nested/.pi/mcp.json"),
            "{\"mcpServers\":{\"docs\":{\"disabled\":true}}}",
        )
        .unwrap();
        fs::write(
            options.workspace.join(".pi/mcp.json"),
            "{\"mcpServers\":{\"docs\":{\"disabled\":false}}}",
        )
        .unwrap();

        let discovery = discover_pi_mcp(&options).unwrap();
        let docs = discovery
            .configuration
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap();
        assert_eq!(docs.definition["args"][0], "root");
        assert!(!docs.disabled);
        assert_eq!(docs.sources.len(), 4);
    }

    #[test]
    fn reports_absent_and_disabled_adapter_without_activating_pau() {
        let (_directory, options) = fixture(
            "2.37.0",
            Some("{\"source\":\"npm:pi-mcp-adapter@2.37.0\",\"extensions\":[]}"),
        );
        fs::write(
            options.workspace.join(".mcp.json"),
            "{\"mcpServers\":{\"docs\":{\"command\":\"server\"}}}",
        )
        .unwrap();
        let disabled = discover_pi_mcp(&options).unwrap();
        assert_eq!(disabled.adapter.state, PiMcpAdapterState::Disabled);
        assert!(!disabled.native_configuration_active);
        assert!(disabled.adapter.action.unwrap().contains("pi config"));

        fs::write(
            options.agent_directory.join("settings.json"),
            "{\"packages\":[]}",
        )
        .unwrap();
        let absent = discover_pi_mcp(&options).unwrap();
        assert_eq!(absent.adapter.state, PiMcpAdapterState::Absent);
        assert!(absent.adapter.action.unwrap().contains("pi install"));
    }

    #[test]
    fn discovers_package_manifest_servers_with_provenance() {
        let directory = tempdir().unwrap();
        let home = directory.path().join("home");
        let agent = home.join(".pi/agent");
        let workspace = directory.path().join("work");
        let package = directory.path().join("fixture-package");
        fs::create_dir_all(&agent).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&package).unwrap();
        fs::write(
            agent.join("settings.json"),
            format!(
                "{{\"packages\":[{}]}}",
                serde_json::to_string(package.to_str().unwrap()).unwrap()
            ),
        )
        .unwrap();
        fs::write(
            package.join("package.json"),
            "{\"name\":\"@acme/tools\",\"pi\":{\"mcp\":\"mcp.json\"}}",
        )
        .unwrap();
        let raw = "{\n  \"mcpServers\": { \"docs.api\": { \"command\": \"docs\", \"newField\": 7 } },\n  \"ignoredSettings\": true\n}\n";
        fs::write(package.join("mcp.json"), raw).unwrap();

        let discovery = discover_pi_mcp(&DiscoverPiMcpOptions {
            home_directory: home,
            agent_directory: agent,
            workspace,
        })
        .unwrap();
        let server = discovery
            .configuration
            .servers
            .iter()
            .find(|server| server.name == "acme_tools__docs_api")
            .unwrap();
        assert_eq!(server.definition["newField"], 7);
        assert_eq!(server.sources[0].scope, McpConfigurationScope::Package);
        assert_eq!(discovery.configuration.documents[0].round_trip_text(), raw);
    }

    #[test]
    fn reports_adapter_operations_and_permission_passthrough() {
        let capabilities = pi_mcp_capabilities(true);
        assert!(capabilities.create);
        assert!(capabilities.authenticate);
        assert!(capabilities.test);
        assert!(capabilities.lazy_connect);
        assert!(capabilities.permission_passthrough);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delegates_runtime_operations_through_pi_rpc_and_supported_ui() {
        use std::os::unix::fs::PermissionsExt;
        use std::time::Duration;

        use crate::{PiProcessOutput, PiReplyTimeouts, PiShutdownTimeouts, StartPiProcessOptions};

        let directory = tempdir().unwrap();
        let executable = directory.path().join("pi-fixture");
        let commands = directory.path().join("commands");
        fs::write(
            &executable,
            format!(
                r#"#!/usr/bin/env python3
import json, sys
for line in sys.stdin:
    command = json.loads(line)
    message = command.get("message", "")
    with open({commands:?}, "a") as log:
        log.write(message + "\n")
    if message.startswith("/mcp reconnect"):
        print(json.dumps({{"type":"extension_ui_request","id":"status","method":"setStatus","statusKey":"mcp","statusText":"1 connected · 2 tools"}}), flush=True)
        print(json.dumps({{"type":"extension_ui_request","id":"notice","method":"notify","message":"MCP: connected","notifyType":"info"}}), flush=True)
    print(json.dumps({{"type":"response","id":command["id"],"command":command["type"],"success":True}}), flush=True)
"#,
                commands = commands.to_string_lossy()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();
        let process = PiProcess::start(StartPiProcessOptions {
            executable_path: executable,
            working_directory: directory.path().to_path_buf(),
            arguments: Vec::new(),
            environment: Vec::new(),
            reply_timeouts: PiReplyTimeouts::default(),
            shutdown_timeouts: PiShutdownTimeouts {
                protocol: Duration::from_millis(100),
                interrupt: Duration::from_millis(100),
                terminate: Duration::from_millis(100),
                kill: Duration::from_millis(100),
            },
        })
        .unwrap();
        let mut output = process.subscribe();

        let result = run_pi_mcp_operation(
            &process,
            PiMcpOperation::Test {
                name: "fixture".to_owned(),
            },
        )
        .await
        .unwrap();
        assert!(result.success);

        let first = output.recv().await.unwrap();
        let second = output.recv().await.unwrap();
        assert!(
            matches!(first, PiProcessOutput::Event(ref value) if value["method"] == "setStatus")
        );
        assert!(matches!(second, PiProcessOutput::Event(ref value) if value["method"] == "notify"));

        for operation in [
            PiMcpOperation::Enable {
                name: "fixture".to_owned(),
            },
            PiMcpOperation::Disable {
                name: "fixture".to_owned(),
            },
            PiMcpOperation::Authenticate {
                name: "fixture".to_owned(),
            },
        ] {
            assert!(
                run_pi_mcp_operation(&process, operation)
                    .await
                    .unwrap()
                    .success
            );
        }
        assert_eq!(
            fs::read_to_string(commands).unwrap(),
            "/mcp reconnect fixture\n/mcp enable fixture\n/reload\n/mcp disable fixture\n/reload\n/mcp-auth fixture\n"
        );
        process.shutdown().await.unwrap();
    }
}
