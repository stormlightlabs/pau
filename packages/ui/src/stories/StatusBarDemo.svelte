<script lang="ts">
	import { setShellStatusBar } from '../lib/shell-status-bar';
	import StatusBar from '../lib/StatusBar.svelte';
	import type { ProcessUsage } from '../lib/types/resource-monitoring';
	import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';
	import SessionViewDemo from './SessionViewDemo.svelte';

	let {
		version,
		workspace,
		session,
		agentVersion,
		usage
	}: {
		version?: string;
		workspace?: SessionWorkspace;
		session?: SessionViewModel;
		agentVersion?: string;
		usage?: ProcessUsage;
	} = $props();

	setShellStatusBar(statusBar);
</script>

{#snippet statusBar()}
	<StatusBar {version} {workspace} {session} {agentVersion} {usage} />
{/snippet}

<!-- The status bar in the application shell, under the session view, as the desktop layout shares it. -->
<SessionViewDemo workspaces={workspace ? [workspace] : []} initialSessionId={session?.id} />
