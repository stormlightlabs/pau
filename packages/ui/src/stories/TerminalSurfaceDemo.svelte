<script lang="ts">
	import { createTerminalFixture } from '../fixtures/terminals';
	import TerminalSurface from '../lib/TerminalSurface.svelte';
	import type { TerminalExit, TerminalSandboxChoice } from '../lib/types/terminal';
	import type { ThemeName, UiFontName } from '../theme';

	type Props = {
		theme?: ThemeName;
		uiFont?: UiFontName;
		disconnected?: boolean;
		exitOnConnect?: TerminalExit;
		createError?: string;
		history?: string[];
		running?: number;
		listError?: string;
		sandbox?: TerminalSandboxChoice;
		sandboxError?: string;
		/** Workspace files that paths in the output link to. */
		linkedFiles?: string[];
	};

	let {
		theme = 'eldritch',
		uiFont,
		disconnected = false,
		exitOnConnect,
		createError,
		history,
		running,
		listError,
		sandbox,
		sandboxError,
		linkedFiles
	}: Props = $props();

	const { source } = $derived(
		createTerminalFixture({ exitOnConnect, createError, history, running, listError, sandbox, sandboxError })
	);
	const fileLinks = $derived(
		linkedFiles && {
			files: async (directory: string) =>
				linkedFiles.filter((path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0)) === directory),
			open: () => {}
		}
	);
</script>

<TerminalSurface {source} {theme} {uiFont} {disconnected} {fileLinks} onMoveToDock={() => {}} />
