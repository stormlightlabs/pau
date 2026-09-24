/** Iconify classes selected for Pau product concepts. */
export const ICONS = {
	agents: 'i-tabler-stack-2',
	close: 'i-tabler-x',
	files: 'i-tabler-folder',
	fileTypeScript: 'i-catppuccin-typescript',
	gitBranch: 'i-octicon-git-branch-16',
	github: 'i-simple-icons-github',
	panel: 'i-tabler-layout-sidebar-right',
	resources: 'i-tabler-plug-connected',
	settings: 'i-tabler-adjustments-horizontal',
	sidebar: 'i-tabler-layout-sidebar'
} as const;

/** A semantic icon kind supported by Pau's shared icon component. */
export type IconKind = keyof typeof ICONS;
