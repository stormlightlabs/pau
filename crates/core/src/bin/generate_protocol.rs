use std::{fs, path::PathBuf};

use pau_core::{
    HealthResponse, ServerEvent, ServerEventKind, ServerSnapshot, ServerStreamMessage,
    VersionResponse,
    agent_resources::{
        AgentResource, AgentResourceIndex, AgentResourceKind, AgentResourceScope,
        AgentResourceSourceKind, AgentResourceStatus, AgentResourceTrust, AgentResourceWarning,
    },
    audit::{AuditActor, AuditEntry, AuditOperation, AuditRecord, AuditResult},
    diagnostics::{
        AdapterDiagnostic, DiagnosticBundle, DiagnosticLevel, DiagnosticRecord, DiagnosticSettings,
        TransportDiagnostic,
    },
    keybindings::{
        AgentKeybinding, AgentKeybindingSource, AgentKeybindingWarning, AgentKeybindings,
    },
    persistence::{McpEnablement, Workspace},
    preferences::{
        LastRoute, LastView, MotionPreference, NotificationPolicy, PaneWidths, ThemePreference,
        UiFontPreference, UiPreferences,
    },
    readiness::{AgentReadiness, AgentReadinessReport},
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
        SessionAutoCompactionRequest, SessionAutoRetryRequest, SessionBranchRequest,
        SessionBranchResult, SessionCapabilities, SessionCloneResult, SessionCommand,
        SessionCommandSource, SessionCompactRequest, SessionCompactionResult, SessionContextUsage,
        SessionExportRequest, SessionExtensionUi, SessionImage, SessionMessageQueue,
        SessionMessageRequest, SessionMessages, SessionModel, SessionModelSelection,
        SessionPromptRequest, SessionQueue, SessionRenameRequest, SessionSearchMatch,
        SessionSearchResult, SessionShellRequest, SessionShellResult, SessionStatus,
        SessionThinkingLevel, SessionThinkingLevelRequest, SessionTokenUsage, SessionTree,
        SessionTreeEntry, SessionUsage, StartSessionRequest,
    },
    startup::{
        DesktopConnection, StartupAction, StartupPhase, StartupProgress, StartupStep,
        StartupStepId, StartupStepState,
    },
    terminal::{
        CreateTerminalRequest, TerminalClientMessage, TerminalInfo, TerminalServerMessage,
        TerminalSignal, TerminalSignalRequest, TerminalSize, TerminalStatus,
    },
    workspace::{
        FileContent, FileEntry, FileEntryKind, FileSearchMatch, GitDiff, GitFileState,
        GitFileStatus, GitStatus, NameSearchResult,
    },
    workspace_watch::WorkspaceFileChanges,
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
        AuditActor::decl(&config),
        AuditOperation::decl(&config),
        AuditResult::decl(&config),
        AuditEntry::decl(&config),
        AuditRecord::decl(&config),
        Workspace::decl(&config),
        McpEnablement::decl(&config),
        ThemePreference::decl(&config),
        UiFontPreference::decl(&config),
        NotificationPolicy::decl(&config),
        MotionPreference::decl(&config),
        PaneWidths::decl(&config),
        LastView::decl(&config),
        LastRoute::decl(&config),
        UiPreferences::decl(&config),
        FileEntryKind::decl(&config),
        FileEntry::decl(&config),
        FileContent::decl(&config),
        FileSearchMatch::decl(&config),
        NameSearchResult::decl(&config),
        GitFileState::decl(&config),
        GitFileStatus::decl(&config),
        GitStatus::decl(&config),
        GitDiff::decl(&config),
        WorkspaceFileChanges::decl(&config),
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
        AgentReadiness::decl(&config),
        AgentReadinessReport::decl(&config),
        StartupStepId::decl(&config),
        StartupStepState::decl(&config),
        StartupAction::decl(&config),
        StartupStep::decl(&config),
        StartupPhase::decl(&config),
        DesktopConnection::decl(&config),
        StartupProgress::decl(&config),
        SessionModel::decl(&config),
        SessionTreeEntry::decl(&config),
        SessionSearchMatch::decl(&config),
        SessionSearchResult::decl(&config),
        SessionTree::decl(&config),
        SessionMessages::decl(&config),
        SessionBranchRequest::decl(&config),
        SessionBranchResult::decl(&config),
        SessionModelSelection::decl(&config),
        StartSessionRequest::decl(&config),
        NativeSessionList::decl(&config),
        NativeSessionSummary::decl(&config),
        NativeSessionWarning::decl(&config),
        AgentKeybindingSource::decl(&config),
        AgentKeybinding::decl(&config),
        AgentKeybindingWarning::decl(&config),
        AgentKeybindings::decl(&config),
        AgentResourceKind::decl(&config),
        AgentResourceScope::decl(&config),
        AgentResourceSourceKind::decl(&config),
        AgentResourceTrust::decl(&config),
        AgentResourceStatus::decl(&config),
        AgentResource::decl(&config),
        AgentResourceWarning::decl(&config),
        AgentResourceIndex::decl(&config),
        SessionQueue::decl(&config),
        SessionImage::decl(&config),
        SessionPromptRequest::decl(&config),
        SessionMessageRequest::decl(&config),
        SessionThinkingLevel::decl(&config),
        SessionThinkingLevelRequest::decl(&config),
        SessionMessageQueue::decl(&config),
        SessionCommandSource::decl(&config),
        SessionCommand::decl(&config),
        SessionCloneResult::decl(&config),
        SessionShellRequest::decl(&config),
        SessionShellResult::decl(&config),
        SessionRenameRequest::decl(&config),
        SessionExportRequest::decl(&config),
        SessionCompactRequest::decl(&config),
        SessionCompactionResult::decl(&config),
        SessionContextUsage::decl(&config),
        SessionTokenUsage::decl(&config),
        SessionUsage::decl(&config),
        SessionAutoCompactionRequest::decl(&config),
        SessionAutoRetryRequest::decl(&config),
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
