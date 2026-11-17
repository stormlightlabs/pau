<script lang="ts">
	import type { StartupProgress } from '@stormlightlabs/pau-protocol';
	import {
		externalLinkContext,
		LaunchSplash,
		SessionBayState,
		setSessionBayState,
		setShellBay,
		setShellStatusBar,
		StatusBar
	} from '@stormlightlabs/pau-ui';
	import { onMount, setContext, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import AppBay from '$lib/AppBay.svelte';
	import AppKeymap from '$lib/AppKeymap.svelte';
	import { claimLaunchRoute, workspaceViewRoute } from '$lib/app-navigation';
	import { createDesktopNativeCapabilities, desktopNativeCapabilitiesContext } from '$lib/native-capabilities';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import { LiveSessions, liveSessionsContext } from '$lib/live-sessions.svelte';
	import { SessionAttention, sessionAttentionContext } from '$lib/session-attention';
	import { terminalDock } from '$lib/terminal-dock.svelte';
	import {
		agentReadinessContext,
		agentReadinessProblem,
		followStartup,
		isDesktopHost,
		launchSteps,
		type AgentReadinessSource
	} from '$lib/startup';

	let { children } = $props();

	// Only a window that opens on Sessions returns to the saved view. A window
	// opened on another view stays there.
	if (page.route.id !== '/') claimLaunchRoute();

	const native = setContext(desktopNativeCapabilitiesContext, createDesktopNativeCapabilities());
	setContext(externalLinkContext, native.openLink);
	const { notify, setBadgeCount } = native;
	const attention = setContext(
		sessionAttentionContext,
		notify && setBadgeCount
			? new SessionAttention({
					browserOrigin: location.origin,
					notifier: { notify, setBadgeCount },
					policy: () => interfacePreferences.choices.notifications
				})
			: undefined
	);

	// One store and one bay state for the whole window, so the bay in every
	// view shows the same sessions and keeps its filter between views.
	const sessions = setContext(liveSessionsContext, new LiveSessions({ browserOrigin: location.origin }));
	setSessionBayState(new SessionBayState());
	setShellBay(appBay);
	setShellStatusBar(statusBar);

	/**
	 * What the status bar describes: the session in view, or the one last
	 * shown when another view is open, and its workspace. A workspace view
	 * names its own workspace and drops a session from another one.
	 */
	const status = $derived.by(() => {
		const workspaces = sessions.workspaces;
		const sessionId = sessions.viewedSessionId ?? terminalDock.session?.sessionId;
		const owner = workspaces.find((workspace) => workspace.sessions.some((session) => session.id === sessionId));
		const workspaceId = page.params.workspaceId ?? owner?.id ?? terminalDock.session?.workspaceId;
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId) ?? workspaces[0];
		const session = workspace?.sessions.find((candidate) => candidate.id === sessionId);
		return { workspace, session };
	});

	// The browser development server has no startup to follow: its backend is
	// already running behind the Vite proxy.
	let progress = $state<StartupProgress>();
	let startupError = $state<string>();
	const desktop = isDesktopHost();
	const phase = $derived(startupError ? 'failed' : (progress?.phase ?? 'running'));
	const ready = $derived(!desktop || phase === 'ready');
	setContext<AgentReadinessSource>(agentReadinessContext, () => agentReadinessProblem(progress));

	onMount(() => {
		if (!desktop) return;
		let stop: (() => void) | undefined;
		let unmounted = false;
		void (async () => {
			try {
				const unlisten = await followStartup((next) => (progress = next));
				if (unmounted) unlisten();
				else stop = unlisten;
			} catch (error) {
				startupError = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => {
			unmounted = true;
			stop?.();
		};
	});

	function stopPreferences() {
		interfacePreferences.stop();
	}

	function closeSessions() {
		sessions.close();
	}

	$effect(() => {
		if (!ready) return;
		untrack(() => interfacePreferences.connect());
		return stopPreferences;
	});

	$effect(() => {
		if (!ready) return;
		untrack(() => sessions.connect());
		return closeSessions;
	});

	$effect(() => {
		if (!ready || !attention) return;
		attention.connect();
		const stopFocus = native.onWindowFocusChange?.((focused) => attention.focus(focused));
		return () => {
			stopFocus?.();
			attention.close();
		};
	});

	// Sessions save their own route, since the URL does not name the saved Pi session.
	$effect(() => {
		const route = workspaceViewRoute(page.route.id, page.params.workspaceId);
		if (ready && route) untrack(() => interfacePreferences.rememberRoute(route));
	});
</script>

{#snippet appBay()}
	<AppBay {sessions} />
{/snippet}

{#snippet statusBar()}
	<StatusBar
		version={sessions.version}
		workspace={status.workspace}
		session={status.session}
		agentVersion={status.session && sessions.agentVersion(status.session.id)}
		usage={sessions.processUsage} />
{/snippet}

{#snippet app()}
	<AppKeymap
		{native}
		onOpenSessionView={() => void goto(resolve('/'))}
		onOpenSettings={() => void goto(resolve('/settings'))}>
		{@render children()}
	</AppKeymap>
{/snippet}

{#if desktop}
	<LaunchSplash
		{phase}
		steps={launchSteps(progress)}
		error={startupError}
		theme={interfacePreferences.choices.theme}
		uiFont={interfacePreferences.choices.ui_font}>
		{@render app()}
	</LaunchSplash>
{:else}
	{@render app()}
{/if}

<style>
	:global(html) {
		color-scheme: dark;
		background: #171827;
	}

	:global(body) {
		margin: 0;
	}
</style>
