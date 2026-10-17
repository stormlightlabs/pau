use std::{fs, path::PathBuf};

use pau_core::{
    HealthResponse, ServerEvent, ServerEventKind, ServerSnapshot, ServerStreamMessage,
    VersionResponse,
    diagnostics::{
        AdapterDiagnostic, DiagnosticBundle, DiagnosticLevel, DiagnosticRecord, DiagnosticSettings,
        TransportDiagnostic,
    },
    persistence::{McpEnablement, Workspace},
    resource_monitor::{
        ProcessIdentity, ProcessResourceNode, ProcessResourceSnapshot, ProcessResourceSummary,
        ResourcePressureKind, ResourcePressureWarning,
    },
    sandbox::{
        EffectiveSandbox, SandboxAdapter, SandboxCredentialAccess, SandboxCredentialReference,
        SandboxCredentialShape, SandboxExecutable, SandboxGrants, SandboxNetworkAccess,
        SandboxPolicyFile, SandboxPreviewRequest, SandboxProfileName, SandboxReadAccess,
        SandboxSelection, SandboxSelectionState, SandboxSettings, SandboxedMcpServer,
        WorkspaceSandbox,
    },
    session::{
        AgentSession, ExtensionDialog, ExtensionStatus, ExtensionUiResponse, ExtensionWidget,
        ExtensionWidgetPlacement, NativeSessionList, NativeSessionSummary, NativeSessionWarning,
        SessionAutoCompactionRequest, SessionCapabilities, SessionCommand, SessionCommandSource,
        SessionCompactRequest, SessionCompactionResult, SessionExtensionUi, SessionMessageQueue,
        SessionMessageRequest, SessionModel, SessionModelSelection, SessionPromptRequest,
        SessionQueue, SessionStatus, SessionThinkingLevel, SessionThinkingLevelRequest,
        StartSessionRequest,
    },
    terminal::{
        CreateTerminalRequest, TerminalClientMessage, TerminalInfo, TerminalServerMessage,
        TerminalSignal, TerminalSignalRequest, TerminalSize, TerminalStatus,
    },
    workspace::{
        FileContent, FileEntry, FileEntryKind, FileSearchMatch, GitDiff, GitFileState,
        GitFileStatus, GitStatus,
    },
};
use ts_rs::{Config, TS};

fn main() {
    let output =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/src/generated.ts");
    let config = Config::default().with_large_int("number");
    let declarations = [
        HealthResponse::decl(&config),
        VersionResponse::decl(&config),
        DiagnosticLevel::decl(&config),
        DiagnosticSettings::decl(&config),
        AdapterDiagnostic::decl(&config),
        TransportDiagnostic::decl(&config),
        DiagnosticRecord::decl(&config),
        DiagnosticBundle::decl(&config),
        Workspace::decl(&config),
        McpEnablement::decl(&config),
        FileEntryKind::decl(&config),
        FileEntry::decl(&config),
        FileContent::decl(&config),
        FileSearchMatch::decl(&config),
        GitFileState::decl(&config),
        GitFileStatus::decl(&config),
        GitStatus::decl(&config),
        GitDiff::decl(&config),
        ProcessIdentity::decl(&config),
        ProcessResourceNode::decl(&config),
        ProcessResourceSnapshot::decl(&config),
        ResourcePressureKind::decl(&config),
        ResourcePressureWarning::decl(&config),
        ProcessResourceSummary::decl(&config),
        ServerEventKind::decl(&config),
        ServerEvent::decl(&config),
        ServerSnapshot::decl(&config),
        ServerStreamMessage::decl(&config),
        SandboxProfileName::decl(&config),
        SandboxGrants::decl(&config),
        SandboxCredentialShape::decl(&config),
        SandboxCredentialReference::decl(&config),
        SandboxSettings::decl(&config),
        SandboxSelection::decl(&config),
        SandboxSelectionState::decl(&config),
        SandboxAdapter::decl(&config),
        SandboxExecutable::decl(&config),
        SandboxReadAccess::decl(&config),
        SandboxNetworkAccess::decl(&config),
        SandboxCredentialAccess::decl(&config),
        EffectiveSandbox::decl(&config),
        SandboxedMcpServer::decl(&config),
        SandboxPolicyFile::decl(&config),
        WorkspaceSandbox::decl(&config),
        SandboxPreviewRequest::decl(&config),
        SessionStatus::decl(&config),
        SessionCapabilities::decl(&config),
        AgentSession::decl(&config),
        ExtensionDialog::decl(&config),
        ExtensionWidgetPlacement::decl(&config),
        ExtensionStatus::decl(&config),
        ExtensionWidget::decl(&config),
        SessionExtensionUi::decl(&config),
        ExtensionUiResponse::decl(&config),
        SessionModel::decl(&config),
        SessionModelSelection::decl(&config),
        StartSessionRequest::decl(&config),
        NativeSessionList::decl(&config),
        NativeSessionSummary::decl(&config),
        NativeSessionWarning::decl(&config),
        SessionQueue::decl(&config),
        SessionPromptRequest::decl(&config),
        SessionMessageRequest::decl(&config),
        SessionThinkingLevel::decl(&config),
        SessionThinkingLevelRequest::decl(&config),
        SessionMessageQueue::decl(&config),
        SessionCommandSource::decl(&config),
        SessionCommand::decl(&config),
        SessionCompactRequest::decl(&config),
        SessionCompactionResult::decl(&config),
        SessionAutoCompactionRequest::decl(&config),
        TerminalSize::decl(&config),
        TerminalSignal::decl(&config),
        TerminalStatus::decl(&config),
        TerminalInfo::decl(&config),
        CreateTerminalRequest::decl(&config),
        TerminalSignalRequest::decl(&config),
        TerminalClientMessage::decl(&config),
        TerminalServerMessage::decl(&config),
    ];
    let generated = format!(
        "// Generated by `pnpm generate:protocol`. Do not edit.\n\n{}\n",
        declarations
            .iter()
            .map(|declaration| format!("export {declaration}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    let source = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    if std::env::args().any(|argument| argument == "--check") {
        let checked = fs::read_to_string(&output).expect("read generated TypeScript protocol");
        if checked != source {
            eprintln!("packages/protocol/src/generated.ts is stale");
            std::process::exit(1);
        }
        return;
    }

    fs::write(output, source).expect("write generated TypeScript protocol");
}
