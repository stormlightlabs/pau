export { default as ApplicationShell } from './lib/ApplicationShell.svelte';
export type { ShellNavItem } from './lib/ApplicationShell.svelte';
export { default as CapabilityCard } from './lib/CapabilityCard.svelte';
export { default as ExtensionUi } from './lib/ExtensionUi.svelte';
export { default as Icon, type IconProps } from './lib/Icon.svelte';
export { default as McpConfigurationView } from './lib/McpConfigurationView.svelte';
export { default as SessionView } from './lib/SessionView.svelte';
export { default as WorkspaceFiles } from './lib/WorkspaceFiles.svelte';
export type {
	WorkspaceFileEntry,
	WorkspaceFileKind,
	WorkspaceFileSource,
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
	ExtensionDialog,
	ExtensionNotification,
	ExtensionStatus,
	ExtensionUiResponse,
	ExtensionUiState,
	ExtensionWidget,
	PromptQueue,
	SessionCapabilities,
	SessionStatus,
	SessionViewModel,
	SessionWorkspace,
	TranscriptEntry
} from './lib/types/session';
export { ICONS, type IconKind } from './icons';
export { THEMES, UI_FONTS, themeCssProperties, type PauTheme, type ThemeName, type UiFontName } from './theme';
export { shellNavigationFixtures } from './fixtures/application-shell';
export { capabilityFixtures, type CapabilityFixture } from './fixtures/capabilities';
export { mcpConfigurationFixtures } from './fixtures/mcp';
export { sessionFixtures } from './fixtures/sessions';
export { workspaceFileFixtures } from './fixtures/workspace-files';
