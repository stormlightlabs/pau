<script lang="ts">
	import { sessionFixtures } from '../fixtures/sessions';
	import { createTerminalFixture } from '../fixtures/terminals';
	import SessionView from '../lib/SessionView.svelte';
	import TerminalPanel from '../lib/TerminalPanel.svelte';
	import type { ThemeName } from '../theme';

	type Props = {
		theme?: ThemeName;
		/** Whether the dock starts open. */
		open?: boolean;
		/** Terminals already running when the view mounts. */
		running?: number;
		/** Earlier output each terminal prints first. */
		history?: string[];
		/** Called when the operator moves the terminals to the main area. */
		onMove?: () => void;
	};

	let { theme = 'eldritch', open = false, running = 1, history, onMove }: Props = $props();

	// The fixture and the starting state belong to the mount, as they would to a route.
	// svelte-ignore state_referenced_locally
	const fixture = createTerminalFixture({ running, history });
	// svelte-ignore state_referenced_locally
	let dockOpen = $state(open);
	let dockHeight = $state<number | null>(null);
</script>

{#snippet dock()}
	<TerminalPanel layout="dock" {theme} source={fixture.source} {onMove} onHide={() => (dockOpen = false)} />
{/snippet}

<SessionView
	workspaces={sessionFixtures.running}
	activeSessionId="session-running"
	{theme}
	{dock}
	{dockOpen}
	onDockToggle={(next) => (dockOpen = next)}
	{dockHeight}
	onDockResize={(height) => (dockHeight = height)} />
