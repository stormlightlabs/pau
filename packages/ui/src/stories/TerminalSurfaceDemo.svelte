<script lang="ts">
	import { createTerminalFixture } from '../fixtures/terminals';
	import TerminalSurface from '../lib/TerminalSurface.svelte';
	import type { TerminalExit } from '../lib/types/terminal';
	import type { ThemeName } from '../theme';

	type Props = { theme?: ThemeName; disconnected?: boolean; exitOnConnect?: TerminalExit; createError?: string };

	let { theme = 'eldritch', disconnected = false, exitOnConnect, createError }: Props = $props();

	const { source } = $derived(createTerminalFixture({ exitOnConnect, createError }));
</script>

<TerminalSurface workspaceName="pau" {source} {theme} {disconnected} />
