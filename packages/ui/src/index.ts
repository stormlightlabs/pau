export { default as ApplicationShell } from './lib/ApplicationShell.svelte';
export type { ShellNavItem, ShellPaneWidths } from './lib/ApplicationShell.svelte';
export { default as CapabilityCard } from './lib/CapabilityCard.svelte';
export { default as ExtensionUi } from './lib/ExtensionUi.svelte';
export { default as DiagnosticsView } from './lib/DiagnosticsView.svelte';
export { default as DiffReview } from './lib/DiffReview.svelte';
export { default as FileEditor } from './lib/FileEditor.svelte';
export type { PromptImage } from './lib/composer-images';
export type { EditorFileContent, FileEditorSource } from './lib/types/file-editor';
export { default as Icon, type IconProps } from './lib/Icon.svelte';
export { default as KeyboardShortcuts } from './lib/KeyboardShortcuts.svelte';
export {
	APP_KEY_ACTIONS,
	KEY_GROUPS,
	Keymap,
	detectPlatform,
	eventChord,
	formatChord,
	getKeymap,
	keymapContext,
	normalizeChord,
	resolveKeyActions,
	useKeyActions
} from './lib/keymap.svelte';
export type {
	KeyAction,
	KeyChord,
	KeyConflict,
	KeyHandler,
	KeyPlatform,
	PiKeyBinding,
	ResolvedKeyAction
} from './lib/keymap.svelte';
export { default as McpConfigurationView } from './lib/McpConfigurationView.svelte';
export { default as ModelPicker } from './lib/ModelPicker.svelte';
export { default as ContextMeter } from './lib/ContextMeter.svelte';
export { default as ThinkingLevelPicker } from './lib/ThinkingLevelPicker.svelte';
export { default as MotionSettingControl } from './lib/MotionSettingControl.svelte';
export { default as ProcessesView } from './lib/ProcessesView.svelte';
export { default as SandboxSettingsView } from './lib/SandboxSettingsView.svelte';
export { default as SessionResourceSummary } from './lib/SessionResourceSummary.svelte';
export { default as TranscriptSearch } from './lib/TranscriptSearch.svelte';
export { default as SessionPicker } from './lib/SessionPicker.svelte';
export { default as SessionTree } from './lib/SessionTree.svelte';
export { default as SessionView } from './lib/SessionView.svelte';
export { default as TerminalSurface } from './lib/TerminalSurface.svelte';
export { default as TerminalView } from './lib/TerminalView.svelte';
export type {
	TerminalConnection,
	TerminalConnectionEvents,
	TerminalExit,
	TerminalSource,
	TerminalTab
} from './lib/types/terminal';
export { default as WorkspaceFiles } from './lib/WorkspaceFiles.svelte';
export type {
	AdapterDiagnostic,
	DiagnosticBundleView,
	DiagnosticLevel,
	DiagnosticRecord,
	DiagnosticSettings,
	TransportDiagnostic
} from './lib/types/diagnostics';
export type {
	WorkspaceFileEntry,
	WorkspaceFileKind,
	WorkspaceFileSource,
	WorkspaceGitDiff,
	WorkspaceGitFileState,
	WorkspaceGitFileStatus,
	WorkspaceGitStatus,
	WorkspaceSearchMatch,
	WorkspaceTraversalOptions
} from './lib/types/workspace-files';
export type {
	McpAgent,
	McpClientAvailability,
	McpConfigurationViewModel,
	McpServer,
	McpServerStatus,
	McpSource,
	McpSourceScope
} from './lib/types/mcp';
export type {
	EffectiveSandboxView,
	SandboxAdapterName,
	SandboxCredentialReferenceModel,
	SandboxGrantsModel,
	SandboxProfile,
	SandboxSelectionModel,
	SandboxSettingsModel
} from './lib/types/sandbox';
export type {
	ProcessResourceActions,
	ProcessResourceNode,
	ProcessResourceSnapshot
} from './lib/types/resource-monitoring';
export type {
	AutoRetry,
	CompactionReason,
	CompactionState,
	ExtensionDialog,
	ExtensionNotification,
	ExtensionStatus,
	ExtensionUiResponse,
	CommandOption,
	FileMention,
	MessageQueue,
	ModelOption,
	ExtensionUiState,
	ExtensionWidget,
	PromptQueue,
	SandboxDenial,
	ContextUsage,
	SessionCapabilities,
	SessionUsage,
	SessionStatus,
	SessionViewModel,
	SavedSession,
	SavedSessionList,
	SessionBranchOutcome,
	SessionTreeItem,
	SessionSearchHit,
	SessionSearchOutcome,
	SessionTreeSnapshot,
	SessionWorkspace,
	TranscriptCompaction,
	TranscriptEntry,
	ThinkingLevel,
	TranscriptTool,
	ToolCallDetails,
	ToolTruncation,
	ToolEdit,
	BashToolCall,
	ReadToolCall,
	EditToolCall,
	WriteToolCall
} from './lib/types/session';
export { ICONS, type IconKind } from './icons';
export {
	THEMES,
	UI_FONTS,
	terminalTheme,
	themeCssProperties,
	type PauTheme,
	type ThemeName,
	type UiFontName
} from './theme';
export { shellNavigationFixtures } from './fixtures/application-shell';
export { capabilityFixtures, type CapabilityFixture } from './fixtures/capabilities';
export { diagnosticFixtures } from './fixtures/diagnostics';
export { mcpConfigurationFixtures } from './fixtures/mcp';
export { resourceMonitoringFixtures } from './fixtures/resource-monitoring';
export { sandboxFixtures } from './fixtures/sandbox';
export { sessionFixtures } from './fixtures/sessions';
export { workspaceFileFixtures } from './fixtures/workspace-files';
export { isReducedMotion, motion, motionOffset } from './motion';
export type { MotionSetting } from './motion';
export { default as SessionStatusMark } from './lib/SessionStatusMark.svelte';
