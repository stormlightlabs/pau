/** Iconify classes selected for Pau product concepts. */
export const ICONS = {
	agents: 'i-tabler-stack-2',
	close: 'i-tabler-x',
	chevronDown: 'i-tabler-chevron-down',
	chevronRight: 'i-tabler-chevron-right',
	file: 'i-tabler-file',
	files: 'i-tabler-folder',
	folderOpen: 'i-catppuccin-folder-open',
	fileCss: 'i-catppuccin-css',
	fileHtml: 'i-catppuccin-html',
	fileImage: 'i-catppuccin-image',
	fileJavaScript: 'i-catppuccin-javascript',
	fileJson: 'i-catppuccin-json',
	fileMarkdown: 'i-catppuccin-markdown',
	fileRust: 'i-catppuccin-rust',
	fileSvelte: 'i-catppuccin-svelte',
	fileToml: 'i-catppuccin-toml',
	fileTypeScript: 'i-catppuccin-typescript',
	fileYaml: 'i-catppuccin-yaml',
	search: 'i-tabler-search',
	symlink: 'i-tabler-link',
	gitBranch: 'i-octicon-git-branch-16',
	github: 'i-simple-icons-github',
	panel: 'i-tabler-layout-sidebar-right',
	resources: 'i-tabler-plug-connected',
	settings: 'i-tabler-adjustments-horizontal',
	sidebar: 'i-tabler-layout-sidebar'
} as const;

/** A semantic icon kind supported by Pau's shared icon component. */
export type IconKind = keyof typeof ICONS;
