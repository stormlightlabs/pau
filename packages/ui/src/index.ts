export { default as ApplicationShell } from './lib/ApplicationShell.svelte';
export type { ShellNavItem } from './lib/ApplicationShell.svelte';
export { default as CapabilityCard } from './lib/CapabilityCard.svelte';
export { default as Icon, type IconProps } from './lib/Icon.svelte';
export { default as SessionView } from './lib/SessionView.svelte';
export type {
	PromptQueue,
	SessionCapabilities,
	SessionStatus,
	SessionViewModel,
	SessionWorkspace,
	TranscriptEntry
} from './lib/types/session';
export { ICONS, type IconKind } from './icons';
export { THEMES, UI_FONTS, themeCssProperties, type PauTheme, type ThemeName, type UiFontName } from './theme';
export { shellNavigationFixtures } from './fixtures/applicationShell';
export { capabilityFixtures, type CapabilityFixture } from './fixtures/capabilities';
export { sessionFixtures } from './fixtures/sessions';
