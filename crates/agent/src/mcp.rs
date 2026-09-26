//! MCP configuration discovery shared by native agent adapters.
//!
//! Discovery retains each native document and its raw text. Callers can show
//! provenance or later apply format-preserving edits without converting Pi and
//! Claude configuration into one application-owned schema.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use jsonc_parser::parse_to_serde_value;
use serde_json::{Map, Value};

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
}
