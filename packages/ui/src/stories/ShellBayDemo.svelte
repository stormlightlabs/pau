<script lang="ts">
	import { bayFixtures } from '../fixtures/bay';
	import SessionBay from '../lib/SessionBay.svelte';
	import { SessionBayState, setSessionBayState } from '../lib/session-bay-state.svelte';
	import { setShellBay } from '../lib/shell-bay';
	import type { SessionWorkspace } from '../lib/types/session';
	import SettingsViewDemo from './SettingsViewDemo.svelte';
	import WorkspaceFilesDemo from './WorkspaceFilesDemo.svelte';

	/**
	 * Files and Settings with the bay the app shares with every view. Each
	 * view mounts its own shell and bay, as a route does, while the bay state
	 * lives here, as it lives in the app layout.
	 */
	let {
		view = 'files',
		workspaces = bayFixtures.busy
	}: { view?: 'files' | 'settings'; workspaces?: SessionWorkspace[] } = $props();

	setSessionBayState(new SessionBayState());
	setShellBay(bay);
</script>

{#snippet bay()}
	<SessionBay {workspaces} newSessionWorkspace={workspaces[0]} onSelectSession={() => {}} onStartSession={() => {}} />
{/snippet}

{#if view === 'files'}
	<WorkspaceFilesDemo />
{:else}
	<SettingsViewDemo />
{/if}
