//! MCP configuration discovery shared by native agent adapters.
//!
//! Discovery retains each native document and its raw text. Callers can show
//! provenance or later apply format-preserving edits without converting Pi and
//! Claude configuration into one application-owned schema.

use std::collections::BTreeMap;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use jsonc_parser::cst::{CstInputValue, CstRootNode};
use jsonc_parser::{ParseOptions, parse_to_serde_value};
use serde_json::{Map, Value};
use tokio::process::Command;
use tokio::time::timeout;

use crate::process_group::{ProcessGroup, lead_process_group};

/// Agent whose native MCP configuration owns a document.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpAgent {
    /// Pi through the explicitly installed `pi-mcp-adapter` package.
    Pi,
    /// Claude Code's native MCP client.
    Claude,
}

/// Native scope assigned by the owning agent.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpConfigurationScope {
    /// Applies for the current user across workspaces.
    User,
    /// Shared project configuration stored in the workspace.
    Project,
    /// Private configuration for one workspace.
    Local,
    /// Configuration contributed by an explicitly configured package.
    Package,
}

/// Kind of native configuration source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpConfigurationKind {
    /// Tool-agnostic shared MCP configuration.
    Shared,
    /// Agent-owned configuration or override.
    Agent,
    /// Configuration declared by a package manifest.
    Package,
}

/// One native configuration file, including its unmodified source text.
#[derive(Clone, Debug, PartialEq)]
pub struct McpConfigurationDocument {
    /// Agent that interprets this document.
    pub agent: McpAgent,
    /// Native configuration scope.
    pub scope: McpConfigurationScope,
    /// Native source kind.
    pub kind: McpConfigurationKind,
    /// Absolute or caller-resolved source path.
    pub path: PathBuf,
    /// Original text used for no-change round trips.
    pub raw: String,
    /// Parsed JSONC value. Unknown fields remain in this value.
    pub value: Value,
}

impl McpConfigurationDocument {
    /// Reads one JSON or JSONC object without rewriting it.
    pub fn read(
        path: impl AsRef<Path>,
        agent: McpAgent,
        scope: McpConfigurationScope,
        kind: McpConfigurationKind,
    ) -> Result<Self, McpDiscoveryError> {
        let path = path.as_ref();
        let raw = fs::read_to_string(path).map_err(|source| McpDiscoveryError::Read {
            path: path.to_path_buf(),
            source,
        })?;
        let value = parse_jsonc_object(path, &raw)?;
        Ok(Self {
            agent,
            scope,
            kind,
            path: path.to_path_buf(),
            raw,
            value,
        })
    }

    /// Returns the exact source text when no edit was requested.
    pub fn round_trip_text(&self) -> &str {
        &self.raw
    }

    /// Returns native server entries while retaining every entry field.
    pub fn server_entries(&self) -> BTreeMap<String, Value> {
        object_at(&self.value, "mcpServers")
            .map(|servers| {
                servers
                    .iter()
                    .filter_map(|(name, value)| {
                        value.as_object().map(|_| (name.clone(), value.clone()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// One source that contributed to an effective server definition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpServerSource {
    /// Source file.
    pub path: PathBuf,
    /// Native scope.
    pub scope: McpConfigurationScope,
    /// Native source kind.
    pub kind: McpConfigurationKind,
}

/// Effective native server with complete source provenance.
///
/// Definitions can contain credentials. Adapters must project a redacted view
/// before sending discovery results to a client or diagnostic stream.
#[derive(Clone, Debug, PartialEq)]
pub struct DiscoveredMcpServer {
    /// Native server name.
    pub name: String,
    /// Effective native definition. Unknown fields remain present.
    pub definition: Value,
    /// Whether the native client has disabled this server.
    pub disabled: bool,
    /// Sources in increasing precedence order.
    pub sources: Vec<McpServerSource>,
}

/// Native configuration and effective servers discovered for one agent.
///
/// This backend-only value can contain credentials and raw configuration text.
#[derive(Clone, Debug, PartialEq)]
pub struct McpConfigurationDiscovery {
    /// Native source documents in increasing precedence order.
    pub documents: Vec<McpConfigurationDocument>,
    /// Effective native servers by name.
    pub servers: Vec<DiscoveredMcpServer>,
}

/// Paths needed to discover Claude Code's user, project, and local scopes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoverClaudeMcpOptions {
    /// Claude's user configuration file, normally `~/.claude.json`.
    pub user_configuration: PathBuf,
    /// Workspace root containing `.mcp.json`.
    pub workspace: PathBuf,
}

/// Reads Claude Code MCP configuration without connecting any server.
///
/// Claude precedence is user, project, then local. Local servers and disabled
/// overrides are read from the canonical workspace entry in `~/.claude.json`.
pub fn discover_claude_mcp(
    options: &DiscoverClaudeMcpOptions,
) -> Result<McpConfigurationDiscovery, McpDiscoveryError> {
    let mut documents = Vec::new();
    let mut layers = Vec::new();
    let canonical_workspace =
        fs::canonicalize(&options.workspace).unwrap_or_else(|_| options.workspace.clone());

    if options.user_configuration.is_file() {
        let document = McpConfigurationDocument::read(
            &options.user_configuration,
            McpAgent::Claude,
            McpConfigurationScope::User,
            McpConfigurationKind::Agent,
        )?;
        layers.push((document.server_entries(), source_for(&document)));

        if let Some(project) = object_at(&document.value, "projects")
            .and_then(|projects| projects.get(canonical_workspace.to_string_lossy().as_ref()))
            .and_then(Value::as_object)
        {
            let local_entries = object_at_map(project, "mcpServers")
                .map(entries_from_map)
                .unwrap_or_default();
            let source = McpServerSource {
                path: options.user_configuration.clone(),
                scope: McpConfigurationScope::Local,
                kind: McpConfigurationKind::Agent,
            };
            // Local scope has highest native precedence and is merged after the
            // project document below.
            layers.push((BTreeMap::new(), source.clone()));
            layers.push((local_entries, source));
        }
        documents.push(document);
    }

    let project_path = options.workspace.join(".mcp.json");
    if project_path.is_file() {
        let document = McpConfigurationDocument::read(
            project_path,
            McpAgent::Claude,
            McpConfigurationScope::Project,
            McpConfigurationKind::Shared,
        )?;
        let project_layer = (document.server_entries(), source_for(&document));
        // Insert project before any local layer retained above.
        let local_start = layers
            .iter()
            .position(|(_, source)| source.scope == McpConfigurationScope::Local)
            .unwrap_or(layers.len());
        layers.insert(local_start, project_layer);
        documents.push(document);
    }

    let mut discovery = merge_mcp_source_entries(documents, layers);
    if let Some(user) = discovery
        .documents
        .iter()
        .find(|document| document.path == options.user_configuration)
        && let Some(project) = object_at(&user.value, "projects")
            .and_then(|projects| projects.get(canonical_workspace.to_string_lossy().as_ref()))
            .and_then(Value::as_object)
    {
        let disabled = string_array(project.get("disabledMcpServers"));
        for server in &mut discovery.servers {
            if disabled.iter().any(|name| name == &server.name) {
                server.disabled = true;
            }
        }
    }
    Ok(discovery)
}

/// A configuration discovery failure that names the affected file.
#[derive(Debug)]
pub enum McpDiscoveryError {
    /// A source file could not be read.
    Read {
        /// Source path.
        path: PathBuf,
        /// Filesystem error.
        source: std::io::Error,
    },
    /// A source file is not a JSONC object.
    Parse {
        /// Source path.
        path: PathBuf,
        /// Parser diagnostic.
        message: String,
    },
}

impl fmt::Display for McpDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(
                    formatter,
                    "could not read MCP configuration {}: {source}",
                    path.display()
                )
            }
            Self::Parse { path, message } => {
                write!(
                    formatter,
                    "invalid MCP configuration {}: {message}",
                    path.display()
                )
            }
        }
    }
}

impl Error for McpDiscoveryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Read { source, .. } => Some(source),
            Self::Parse { .. } => None,
        }
    }
}

/// Merges native layers without dropping unknown server fields.
pub fn merge_mcp_layers(documents: Vec<McpConfigurationDocument>) -> McpConfigurationDiscovery {
    let layers = documents
        .iter()
        .map(|document| (document.server_entries(), source_for(document)))
        .collect();
    merge_mcp_source_entries(documents, layers)
}

fn merge_mcp_source_entries(
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
                    definition: Value::Object(Map::new()),
                    disabled: false,
                    sources: Vec::new(),
                });
            // Native clients own merge semantics. Claude scope precedence picks
            // one complete server entry rather than applying Pi's field-level
            // adapter merge.
            entry.definition = definition;
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

fn parse_jsonc_object(path: &Path, raw: &str) -> Result<Value, McpDiscoveryError> {
    let value: Value = parse_to_serde_value(raw, &Default::default()).map_err(|error| {
        McpDiscoveryError::Parse {
            path: path.to_path_buf(),
            message: error.to_string(),
        }
    })?;
    if !value.is_object() {
        return Err(McpDiscoveryError::Parse {
            path: path.to_path_buf(),
            message: "top-level value must be an object".to_owned(),
        });
    }
    Ok(value)
}

fn source_for(document: &McpConfigurationDocument) -> McpServerSource {
    McpServerSource {
        path: document.path.clone(),
        scope: document.scope,
        kind: document.kind,
    }
}

fn object_at<'a>(value: &'a Value, key: &str) -> Option<&'a Map<String, Value>> {
    value.as_object()?.get(key)?.as_object()
}

fn object_at_map<'a>(value: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    value.get(key)?.as_object()
}

fn entries_from_map(map: &Map<String, Value>) -> BTreeMap<String, Value> {
    map.iter()
        .filter_map(|(name, value)| value.as_object().map(|_| (name.clone(), value.clone())))
        .collect()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// A format-preserving change to one native MCP server entry.
#[derive(Clone, Debug, PartialEq)]
pub enum McpServerEdit {
    /// Add a server that is not already present.
    Create { definition: Value },
    /// Replace one server definition while leaving the rest of the file alone.
    Replace { definition: Value },
    /// Remove one server definition.
    Remove,
    /// Set the native `disabled` override for one server.
    SetEnabled { enabled: bool },
}

/// Failure while changing a native MCP configuration file.
#[derive(Debug)]
pub enum McpEditError {
    /// The configuration file could not be read or written.
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    /// The configuration file could not be parsed as a JSONC object.
    Parse { path: PathBuf, message: String },
    /// The requested server already exists.
    AlreadyExists { name: String },
    /// The requested server does not exist.
    NotFound { name: String },
    /// A server definition was not an object.
    InvalidDefinition,
}

impl fmt::Display for McpEditError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => {
                write!(formatter, "could not update {}: {source}", path.display())
            }
            Self::Parse { path, message } => {
                write!(
                    formatter,
                    "invalid MCP configuration {}: {message}",
                    path.display()
                )
            }
            Self::AlreadyExists { name } => write!(formatter, "MCP server {name:?} already exists"),
            Self::NotFound { name } => write!(formatter, "MCP server {name:?} was not found"),
            Self::InvalidDefinition => {
                formatter.write_str("an MCP server definition must be an object")
            }
        }
    }
}

impl Error for McpEditError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Applies one server edit without reformatting comments or unrelated entries.
///
/// This edits the native `mcpServers` object used by both selected clients. Pi
/// callers should use the highest-precedence Pi override for enablement so a
/// lower shared source is not rewritten.
pub fn edit_mcp_server(
    path: impl AsRef<Path>,
    name: &str,
    edit: McpServerEdit,
) -> Result<(), McpEditError> {
    let path = path.as_ref();
    let raw = read_editable_document(path)?;
    let root = CstRootNode::parse(&raw, &ParseOptions::default()).map_err(|error| {
        McpEditError::Parse {
            path: path.to_path_buf(),
            message: error.to_string(),
        }
    })?;
    let object = root.object_value().ok_or_else(|| McpEditError::Parse {
        path: path.to_path_buf(),
        message: "top-level value must be an object".to_owned(),
    })?;
    let servers = object.object_value_or_set("mcpServers");
    let existing = servers.get(name);

    match edit {
        McpServerEdit::Create { definition } => {
            if !definition.is_object() {
                return Err(McpEditError::InvalidDefinition);
            }
            if existing.is_some() {
                return Err(McpEditError::AlreadyExists {
                    name: name.to_owned(),
                });
            }
            servers.append(name, cst_value(definition)?);
        }
        McpServerEdit::Replace { definition } => {
            if !definition.is_object() {
                return Err(McpEditError::InvalidDefinition);
            }
            let property = existing.ok_or_else(|| McpEditError::NotFound {
                name: name.to_owned(),
            })?;
            property.set_value(cst_value(definition)?);
        }
        McpServerEdit::Remove => {
            existing
                .ok_or_else(|| McpEditError::NotFound {
                    name: name.to_owned(),
                })?
                .remove();
        }
        McpServerEdit::SetEnabled { enabled } => {
            let server = match existing {
                Some(property) => property.object_value_or_set(),
                None => {
                    servers.append(name, CstInputValue::Object(Vec::new()));
                    servers.object_value(name).expect("appended object")
                }
            };
            if let Some(disabled) = server.get("disabled") {
                if enabled {
                    disabled.remove();
                } else {
                    disabled.set_value(true.into());
                }
            } else if !enabled {
                server.append("disabled", true.into());
            }
        }
    }

    write_editable_document(path, &root.to_string())
}

/// Applies Claude's workspace-local disabled-server choice without changing a
/// shared or user server definition.
pub fn set_claude_server_enabled(
    user_configuration: impl AsRef<Path>,
    workspace: impl AsRef<Path>,
    name: &str,
    enabled: bool,
) -> Result<(), McpEditError> {
    let path = user_configuration.as_ref();
    let raw = read_editable_document(path)?;
    let value: Value =
        parse_to_serde_value(&raw, &Default::default()).map_err(|error| McpEditError::Parse {
            path: path.to_path_buf(),
            message: error.to_string(),
        })?;
    let workspace = fs::canonicalize(workspace.as_ref())
        .unwrap_or_else(|_| workspace.as_ref().to_path_buf())
        .to_string_lossy()
        .into_owned();
    let mut disabled = value
        .get("projects")
        .and_then(|projects| projects.get(&workspace))
        .and_then(|project| project.get("disabledMcpServers"))
        .map(|value| string_array(Some(value)))
        .unwrap_or_default();
    disabled.retain(|server| server != name);
    if !enabled {
        disabled.push(name.to_owned());
    }

    let root = CstRootNode::parse(&raw, &ParseOptions::default()).map_err(|error| {
        McpEditError::Parse {
            path: path.to_path_buf(),
            message: error.to_string(),
        }
    })?;
    let object = root.object_value().ok_or_else(|| McpEditError::Parse {
        path: path.to_path_buf(),
        message: "top-level value must be an object".to_owned(),
    })?;
    let projects = object.object_value_or_set("projects");
    let project = projects.object_value_or_set(&workspace);
    let replacement = CstInputValue::Array(disabled.into_iter().map(Into::into).collect());
    if let Some(property) = project.get("disabledMcpServers") {
        property.set_value(replacement);
    } else {
        project.append("disabledMcpServers", replacement);
    }
    write_editable_document(path, &root.to_string())
}

/// Capabilities exposed by one native MCP integration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct McpAdapterCapabilities {
    /// Whether the adapter can create native server entries.
    pub create: bool,
    /// Whether the adapter can edit native server entries.
    pub edit: bool,
    /// Whether the adapter can remove native server entries.
    pub remove: bool,
    /// Whether the adapter can enable individual servers.
    pub enable: bool,
    /// Whether the adapter can disable individual servers.
    pub disable: bool,
    /// Whether the adapter can start native authentication.
    pub authenticate: bool,
    /// Whether the adapter can test one connection without model work.
    pub test: bool,
    /// Whether enabled servers remain disconnected until first use or a test.
    pub lazy_connect: bool,
    /// Whether MCP tool calls pass through the active agent approval hook.
    pub permission_passthrough: bool,
}

/// Capabilities of Claude Code's native MCP integration.
pub fn claude_mcp_capabilities(permission_passthrough: bool) -> McpAdapterCapabilities {
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

/// Capabilities negotiated with one connected MCP server.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct McpNegotiatedCapabilities {
    /// Negotiated MCP protocol revision.
    pub protocol_version: Option<String>,
    /// Name reported by the server handshake.
    pub server_name: Option<String>,
    /// Version reported by the server handshake.
    pub server_version: Option<String>,
    /// Whether the server advertises tools.
    pub tools: bool,
    /// Whether the server advertises prompts.
    pub prompts: bool,
    /// Whether the server advertises resources.
    pub resources: bool,
    /// Whether the server accepts MCP logging controls.
    pub logging: bool,
    /// Whether the client and server negotiated elicitation.
    pub elicitation: bool,
    /// Whether the client and server negotiated sampling.
    pub sampling: bool,
}

/// Sanitized startup or runtime diagnostic from a native MCP client.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpDiagnostic {
    /// Diagnostic severity.
    pub level: McpDiagnosticLevel,
    /// Redacted operator-facing message.
    pub message: String,
}

/// Severity of an MCP diagnostic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpDiagnosticLevel {
    Info,
    Warning,
    Error,
}

/// Result of a finite native MCP operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpOperationResult {
    /// Whether the native client completed the operation.
    pub success: bool,
    /// Redacted result suitable for events and logs.
    pub diagnostic: McpDiagnostic,
}

/// Options for invoking Claude Code's native MCP client.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeMcpOptions {
    /// Claude executable selected by discovery.
    pub executable_path: PathBuf,
    /// Workspace in which Claude resolves project and local configuration.
    pub working_directory: PathBuf,
    /// The `PATH` Claude and the MCP servers it starts run with.
    pub path: OsString,
    /// Maximum duration of one finite native command.
    pub timeout: Duration,
}

/// Finite operation delegated to Claude Code's native MCP client.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaudeMcpOperation {
    Remove {
        name: String,
        scope: McpConfigurationScope,
    },
    Authenticate {
        name: String,
    },
    Test {
        name: String,
    },
    Status,
}

/// Invokes a native Claude MCP operation without reading or storing OAuth data.
pub async fn run_claude_mcp_operation(
    options: &ClaudeMcpOptions,
    operation: ClaudeMcpOperation,
) -> Result<McpOperationResult, std::io::Error> {
    let (arguments, success_message, failure_message) = claude_arguments(operation)?;
    let mut command = Command::new(&options.executable_path);
    command
        .args(arguments)
        .env("PATH", &options.path)
        .current_dir(&options.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut group = ProcessGroup::new(lead_process_group(&mut command).spawn()?);
    let status = match timeout(options.timeout, group.wait()).await {
        Ok(status) => status?,
        Err(_) => {
            return Ok(McpOperationResult {
                success: false,
                diagnostic: McpDiagnostic {
                    level: McpDiagnosticLevel::Error,
                    message: "Claude MCP operation timed out; the native client was stopped."
                        .to_owned(),
                },
            });
        }
    };
    let success = status.success();
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

/// Replaces credential-bearing fields before a definition leaves an adapter.
pub fn redact_mcp_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let redacted = if is_secret_key(key) {
                        Value::String("[REDACTED]".to_owned())
                    } else {
                        redact_mcp_value(value)
                    };
                    (key.clone(), redacted)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_mcp_value).collect()),
        _ => value.clone(),
    }
}

fn read_editable_document(path: &Path) -> Result<String, McpEditError> {
    if !path.exists() {
        return Ok("{}\n".to_owned());
    }
    fs::read_to_string(path).map_err(|source| McpEditError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn write_editable_document(path: &Path, text: &str) -> Result<(), McpEditError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| McpEditError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    }
    fs::write(path, text).map_err(|source| McpEditError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn cst_value(value: Value) -> Result<CstInputValue, McpEditError> {
    match value {
        Value::Null => Ok(CstInputValue::Null),
        Value::Bool(value) => Ok(value.into()),
        Value::Number(value) => Ok(CstInputValue::Number(value.to_string())),
        Value::String(value) => Ok(value.into()),
        Value::Array(values) => values
            .into_iter()
            .map(cst_value)
            .collect::<Result<Vec<_>, _>>()
            .map(CstInputValue::Array),
        Value::Object(values) => values
            .into_iter()
            .map(|(key, value)| cst_value(value).map(|value| (key, value)))
            .collect::<Result<Vec<_>, _>>()
            .map(CstInputValue::Object),
    }
}

fn claude_arguments(
    operation: ClaudeMcpOperation,
) -> Result<(Vec<OsString>, String, String), std::io::Error> {
    let mut arguments = vec![OsString::from("mcp")];
    let (success, failure) = match operation {
        ClaudeMcpOperation::Remove { name, scope } => {
            arguments.extend([
                "remove".into(),
                "--scope".into(),
                claude_scope(scope)?.into(),
                name.clone().into(),
            ]);
            (
                format!("Claude removed MCP server {name:?}."),
                format!("Claude could not remove MCP server {name:?}."),
            )
        }
        ClaudeMcpOperation::Authenticate { name } => {
            arguments.extend(["login".into(), name.clone().into()]);
            (
                format!("Claude authenticated MCP server {name:?}."),
                format!("Claude could not authenticate MCP server {name:?}."),
            )
        }
        ClaudeMcpOperation::Test { name } => {
            arguments.extend(["get".into(), name.clone().into()]);
            (
                format!("Claude connected to MCP server {name:?}."),
                format!("Claude could not connect to MCP server {name:?}."),
            )
        }
        ClaudeMcpOperation::Status => {
            arguments.push("list".into());
            (
                "Claude MCP status is available.".to_owned(),
                "Claude could not read MCP status.".to_owned(),
            )
        }
    };
    Ok((arguments, success, failure))
}

fn claude_scope(scope: McpConfigurationScope) -> Result<&'static str, std::io::Error> {
    match scope {
        McpConfigurationScope::User => Ok("user"),
        McpConfigurationScope::Project => Ok("project"),
        McpConfigurationScope::Local => Ok("local"),
        McpConfigurationScope::Package => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Claude cannot create package-scoped MCP configuration",
        )),
    }
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("credential")
        || normalized.ends_with("key")
        || normalized == "authorization"
        || normalized == "cookie"
        || normalized == "env"
        || normalized == "headers"
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn claude_discovery_preserves_documents_and_native_scopes() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("work");
        fs::create_dir(&workspace).unwrap();
        let user_path = directory.path().join("claude.json");
        let workspace_key = fs::canonicalize(&workspace).unwrap();
        let user = format!(
            "{{\n  // keep this comment\n  \"mcpServers\": {{\n    \"docs\": {{ \"type\": \"http\", \"url\": \"https://user\", \"unknown\": 1 }}\n  }},\n  \"projects\": {{\n    {}: {{\n      \"mcpServers\": {{ \"docs\": {{ \"type\": \"http\", \"url\": \"https://local\", \"localField\": true, \"unknown\": 9 }} }},\n      \"disabledMcpServers\": [\"docs\"],\n      \"unrelated\": \"unchanged\"\n    }}\n  }},\n  \"futureField\": true\n}}\n",
            serde_json::to_string(workspace_key.to_string_lossy().as_ref()).unwrap()
        );
        fs::write(&user_path, &user).unwrap();
        let project = "{\n  \"mcpServers\": {\n    \"docs\": { \"timeout\": 1200 },\n    \"project-only\": { \"command\": \"server\", \"future\": [1, 2] }\n  },\n  \"other\": { \"spacing\": true }\n}\n";
        fs::write(workspace.join(".mcp.json"), project).unwrap();

        let discovery = discover_claude_mcp(&DiscoverClaudeMcpOptions {
            user_configuration: user_path,
            workspace,
        })
        .unwrap();

        assert_eq!(discovery.documents[0].round_trip_text(), user);
        assert_eq!(discovery.documents[1].round_trip_text(), project);
        let docs = discovery
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap();
        assert_eq!(docs.definition["url"], "https://local");
        assert_eq!(docs.definition["type"], "http");
        assert_eq!(docs.definition["unknown"], 9);
        assert_eq!(docs.definition["localField"], true);
        assert!(docs.definition.get("timeout").is_none());
        assert_eq!(
            discovery.documents[0].value["mcpServers"]["docs"]["unknown"],
            1
        );
        assert!(docs.disabled);
        assert_eq!(
            docs.sources
                .iter()
                .map(|source| source.scope)
                .collect::<Vec<_>>(),
            vec![
                McpConfigurationScope::User,
                McpConfigurationScope::Project,
                McpConfigurationScope::Local,
            ]
        );
        assert_eq!(discovery.servers[1].definition["future"], json!([1, 2]));
    }

    #[test]
    fn edits_only_the_selected_server_entry() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("mcp.json");
        let original = "{\n  // keep this comment\n  \"mcpServers\": {\n    \"keep\": { \"command\": \"unchanged\", \"future\": true },\n    \"docs\": { \"url\": \"https://old.example\", \"unknown\": 1 }\n  },\n  \"other\": { \"spacing\": true }\n}\n";
        fs::write(&path, original).unwrap();

        edit_mcp_server(
            &path,
            "docs",
            McpServerEdit::Replace {
                definition: json!({"url": "https://new.example", "future": [1, 2]}),
            },
        )
        .unwrap();
        edit_mcp_server(
            &path,
            "extra",
            McpServerEdit::Create {
                definition: json!({"command": "fixture", "env": {"TOKEN": "secret"}}),
            },
        )
        .unwrap();
        edit_mcp_server(&path, "docs", McpServerEdit::SetEnabled { enabled: false }).unwrap();

        let edited = fs::read_to_string(&path).unwrap();
        assert!(edited.contains("// keep this comment"));
        assert!(edited.contains("\"keep\": { \"command\": \"unchanged\", \"future\": true }"));
        assert!(edited.contains("\"other\": { \"spacing\": true }"));
        let value: Value = parse_to_serde_value(&edited, &Default::default()).unwrap();
        assert_eq!(value["mcpServers"]["docs"]["url"], "https://new.example");
        assert_eq!(value["mcpServers"]["docs"]["disabled"], true);
        assert_eq!(value["mcpServers"]["extra"]["command"], "fixture");

        edit_mcp_server(&path, "docs", McpServerEdit::SetEnabled { enabled: true }).unwrap();
        edit_mcp_server(&path, "extra", McpServerEdit::Remove).unwrap();
        let value: Value =
            parse_to_serde_value(&fs::read_to_string(&path).unwrap(), &Default::default()).unwrap();
        assert!(value["mcpServers"]["docs"].get("disabled").is_none());
        assert!(value["mcpServers"].get("extra").is_none());
    }

    #[test]
    fn updates_claude_local_enablement_without_rewriting_other_fields() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("work");
        fs::create_dir(&workspace).unwrap();
        let workspace_key = fs::canonicalize(&workspace).unwrap();
        let path = directory.path().join("claude.json");
        let raw = format!(
            "{{\n  // retained\n  \"projects\": {{\n    {}: {{ \"disabledMcpServers\": [\"old\"], \"future\": true }}\n  }},\n  \"other\": 1\n}}\n",
            serde_json::to_string(workspace_key.to_string_lossy().as_ref()).unwrap()
        );
        fs::write(&path, raw).unwrap();

        set_claude_server_enabled(&path, &workspace, "docs", false).unwrap();
        let disabled = fs::read_to_string(&path).unwrap();
        assert!(disabled.contains("// retained"));
        assert!(disabled.contains("\"future\": true"));
        let value: Value = parse_to_serde_value(&disabled, &Default::default()).unwrap();
        let names =
            value["projects"][workspace_key.to_string_lossy().as_ref()]["disabledMcpServers"]
                .as_array()
                .unwrap();
        assert_eq!(names, &vec![json!("old"), json!("docs")]);

        set_claude_server_enabled(&path, &workspace, "docs", true).unwrap();
        let value: Value =
            parse_to_serde_value(&fs::read_to_string(&path).unwrap(), &Default::default()).unwrap();
        assert_eq!(
            value["projects"][workspace_key.to_string_lossy().as_ref()]["disabledMcpServers"],
            json!(["old"])
        );
    }

    #[test]
    fn reports_claude_operations_and_permission_passthrough() {
        let capabilities = claude_mcp_capabilities(true);
        assert!(capabilities.create);
        assert!(capabilities.authenticate);
        assert!(capabilities.test);
        assert!(capabilities.lazy_connect);
        assert!(capabilities.permission_passthrough);
    }

    #[test]
    fn redacts_nested_credentials_but_retains_diagnostics_fields() {
        let redacted = redact_mcp_value(&json!({
            "url": "https://example.test/mcp",
            "headers": {"Authorization": "Bearer secret"},
            "env": {"API_KEY": "secret"},
            "oauth": {"clientSecret": "secret", "scope": "read"},
            "unknown": [1, {"password": "secret"}]
        }));
        assert_eq!(redacted["url"], "https://example.test/mcp");
        assert_eq!(redacted["headers"], "[REDACTED]");
        assert_eq!(redacted["env"], "[REDACTED]");
        assert_eq!(redacted["oauth"]["clientSecret"], "[REDACTED]");
        assert_eq!(redacted["oauth"]["scope"], "read");
        assert_eq!(redacted["unknown"][1]["password"], "[REDACTED]");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delegates_finite_operations_to_claude_without_returning_process_output() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let executable = directory.path().join("claude-fixture");
        let arguments = directory.path().join("arguments");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\nprintf '%s ' \"$@\" >> {0}\nprintf '\\n' >> {0}\nprintf 'TOKEN=should-not-escape' >&2\ncase \"$*\" in *failed*) exit 7;; *hang*) exec sleep 1;; esac\n",
                arguments.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        let options = ClaudeMcpOptions {
            executable_path: executable,
            working_directory: directory.path().to_path_buf(),
            path: std::env::var_os("PATH").unwrap_or_default(),
            timeout: Duration::from_secs(2),
        };
        let test = run_claude_mcp_operation(
            &options,
            ClaudeMcpOperation::Test {
                name: "docs".to_owned(),
            },
        )
        .await
        .unwrap();
        let authenticate = run_claude_mcp_operation(
            &options,
            ClaudeMcpOperation::Authenticate {
                name: "oauth".to_owned(),
            },
        )
        .await
        .unwrap();
        let status = run_claude_mcp_operation(&options, ClaudeMcpOperation::Status)
            .await
            .unwrap();
        let remove = run_claude_mcp_operation(
            &options,
            ClaudeMcpOperation::Remove {
                name: "old".to_owned(),
                scope: McpConfigurationScope::Project,
            },
        )
        .await
        .unwrap();
        let failed = run_claude_mcp_operation(
            &options,
            ClaudeMcpOperation::Test {
                name: "failed".to_owned(),
            },
        )
        .await
        .unwrap();
        let timed_out = run_claude_mcp_operation(
            &ClaudeMcpOptions {
                timeout: Duration::from_millis(20),
                ..options
            },
            ClaudeMcpOperation::Test {
                name: "hang".to_owned(),
            },
        )
        .await
        .unwrap();

        for result in [&test, &authenticate, &status, &remove] {
            assert!(result.success);
            assert!(!result.diagnostic.message.contains("should-not-escape"));
        }
        assert_eq!(
            test.diagnostic.message,
            "Claude connected to MCP server \"docs\"."
        );
        assert!(!failed.success);
        assert!(!timed_out.success);
        assert!(timed_out.diagnostic.message.contains("timed out"));
        assert_eq!(
            fs::read_to_string(arguments).unwrap(),
            "mcp get docs \nmcp login oauth \nmcp list \nmcp remove --scope project old \nmcp get failed \nmcp get hang \n"
        );
    }
}
