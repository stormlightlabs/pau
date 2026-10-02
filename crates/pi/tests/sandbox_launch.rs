#![cfg(unix)]

use pau_agent::DiscoveredMcpServer;
use pau_core::sandbox::{SandboxExecutables, SandboxPolicyFile, SandboxSettings};
use pau_pi::{PiShutdownTimeouts, PreparePiSandbox, StartPiProcessOptions, prepare_pi_sandbox};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;

#[test]
fn prepares_the_extension_policy_and_exclusive_session_mcp() {
    let Ok(executables) =
        SandboxExecutables::resolve(&std::env::var_os("PATH").unwrap_or_default())
    else {
        eprintln!("skipped: no supported sandbox on this host");
        return;
    };
    // Keep the relay socket below the shortest supported Unix socket limit.
    let root = tempfile::Builder::new()
        .prefix("pau-pi-sandbox-")
        .tempdir_in("/tmp")
        .unwrap();
    let root_path = fs::canonicalize(root.path()).unwrap();
    let workspace = root_path.join("workspace");
    let home = root_path.join("home");
    fs::create_dir_all(workspace.join(".git")).unwrap();
    fs::create_dir_all(&home).unwrap();
    let session = root_path.join("s");
    let servers = [DiscoveredMcpServer {
        name: "files".into(),
        definition: json!({"command": "files-mcp"}),
        disabled: false,
        sources: Vec::new(),
    }];
    let launch = prepare_pi_sandbox(&PreparePiSandbox {
        settings: &SandboxSettings::workspace_write(),
        workspace: &workspace,
        home: &home,
        session_directory: &session,
        executables: &executables,
        extension: "/pau/packages/sandbox/src/pi-extension.ts".as_ref(),
        runtime_roots: &[],
        tool_path: "/usr/bin:/bin",
        credential_environment: &Default::default(),
        mcp_servers: Some(&servers),
    })
    .unwrap();

    let mut options = StartPiProcessOptions {
        executable_path: "pi".into(),
        working_directory: workspace.clone(),
        arguments: vec!["--no-session".into()],
        environment: Vec::new(),
        shutdown_timeouts: PiShutdownTimeouts::default(),
    };
    launch.apply(&mut options);
    let mcp_config = session.join("host/mcp.json");
    assert_eq!(
        options.arguments,
        [
            OsString::from("--no-session"),
            "--extension".into(),
            "/pau/packages/sandbox/src/pi-extension.ts".into(),
            "--mcp-config".into(),
            mcp_config.clone().into(),
        ]
    );
    assert!(
        options
            .environment
            .contains(&("PI_MCP_CONFIG_MODE".into(), "exclusive".into()))
    );
    assert!(options.environment.contains(&(
        "PAU_SANDBOX_POLICY_FILE".into(),
        launch.policy_file.clone().into()
    )));

    let policy: SandboxPolicyFile =
        serde_json::from_slice(&fs::read(&launch.policy_file).unwrap()).unwrap();
    assert_eq!(policy.mcp_servers.len(), 1);
    assert_eq!(policy.mcp_config.as_deref(), mcp_config.to_str());
    let configuration: Value = serde_json::from_slice(&fs::read(&mcp_config).unwrap()).unwrap();
    assert_eq!(
        configuration["mcpServers"]["files"]["socket"],
        policy.mcp_servers[0].socket
    );
    assert_eq!(
        fs::metadata(&mcp_config).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(launch.placeholders.contains(&workspace.join(".mcp.json")));
    assert!(
        launch
            .effective
            .sandboxed_tools
            .contains(&"MCP server files".to_owned())
    );
}
