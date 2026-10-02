//! Resolves one sandbox launch for the `packages/sandbox` fixtures.
//!
//! Reads a JSON request on standard input, writes the policy file into the
//! session directory, and prints the resolved launch. The fixtures use it so
//! they exercise the same policy that Pau launches.

use std::{
    collections::BTreeMap,
    io::{self, Read},
    path::PathBuf,
    process::ExitCode,
};

use pau_core::sandbox::{
    SandboxAdapter, SandboxExecutables, SandboxLaunchInput, SandboxSettings, SandboxedMcpServer,
    claude_settings, prepare_sandbox, resolve_sandbox,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    adapter: SandboxAdapter,
    settings: SandboxSettings,
    workspace: PathBuf,
    home: PathBuf,
    session_directory: PathBuf,
    #[serde(default)]
    runtime_roots: Vec<PathBuf>,
    tool_path: String,
    /// Contained stdio MCP servers, as an adapter would add them.
    #[serde(default)]
    mcp_servers: Vec<SandboxedMcpServer>,
}

fn main() -> ExitCode {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("could not read the request: {error}");
        return ExitCode::FAILURE;
    }
    match run(&input) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run(input: &str) -> Result<String, String> {
    let request: Request = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let search_path = std::env::var_os("PATH").unwrap_or_default();
    let executables =
        SandboxExecutables::resolve(&search_path).map_err(|error| error.to_string())?;
    let credential_environment = request
        .settings
        .credential_references
        .iter()
        .filter_map(|reference| {
            std::env::var(&reference.source)
                .ok()
                .map(|value| (reference.source.clone(), value))
        })
        .collect::<BTreeMap<_, _>>();
    let mut resolved = resolve_sandbox(&SandboxLaunchInput {
        adapter: request.adapter,
        settings: &request.settings,
        workspace: &request.workspace,
        home: &request.home,
        session_directory: &request.session_directory,
        executables: &executables,
        runtime_roots: &request.runtime_roots,
        tool_path: &request.tool_path,
        credential_environment: &credential_environment,
    })
    .map_err(|error| error.to_string())?;
    resolved.policy.mcp_servers = request.mcp_servers;
    let policy_file = prepare_sandbox(&resolved).map_err(|error| error.to_string())?;
    Ok(json!({
        "policyFile": policy_file,
        "policy": resolved.policy,
        "effective": resolved.effective,
        "placeholders": resolved.placeholders,
        "claudeSettings": claude_settings(&resolved),
    })
    .to_string())
}
