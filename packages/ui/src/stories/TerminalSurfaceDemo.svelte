<script lang="ts">
	import { createTerminalFixture } from '../fixtures/terminals';
	import TerminalSurface from '../lib/TerminalSurface.svelte';
	import type { TerminalExit } from '../lib/types/terminal';
	import type { ThemeName, UiFontName } from '../theme';

	type Props = {
		theme?: ThemeName;
		uiFont?: UiFontName;
		disconnected?: boolean;
		exitOnConnect?: TerminalExit;
		createError?: string;
		history?: string[];
	};

	let { theme = 'eldritch', uiFont, disconnected = false, exitOnConnect, createError, history }: Props = $props();

	const { source } = $derived(createTerminalFixture({ exitOnConnect, createError, history }));
</script>

<TerminalSurface workspaceName="pau" {source} {theme} {uiFont} {disconnected} />
