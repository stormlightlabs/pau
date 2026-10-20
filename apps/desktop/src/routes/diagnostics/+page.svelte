<script lang="ts">
	import type { DiagnosticBundle } from '@stormlightlabs/pau-protocol';
	import {
		ApplicationShell,
		DiagnosticsView,
		MotionSettingControl,
		diagnosticFixtures,
		type DiagnosticBundleView
	} from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import {
		exportDiagnostics,
		getDiagnostics,
		listWorkspaces,
		startPayloadTracing,
		updateDiagnosticSettings
	} from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';

	let bundle = $state<DiagnosticBundleView>(diagnosticFixtures.disabled);
	let error = $state<string>();
	let notice = $state<string>();
	/** The workspace that the rail's workspace views open. Diagnostics has none of its own, so it uses the first. */
	let workspaceId = $state<string>();

	function viewModel(value: DiagnosticBundle): DiagnosticBundleView {
		return {
			frontendVersion: value.frontend_version,
			backendVersion: value.backend_version,
			dependencies: value.dependencies,
			adapters: value.adapters.map((adapter) => ({
				name: adapter.name,
				version: adapter.version ?? undefined,
				handshake: adapter.handshake,
				capabilities: adapter.capabilities
			})),
			transports: value.transports.map((transport) => ({
				name: transport.name,
				state: transport.state,
				reconnects: transport.reconnects,
				lastSequence: transport.last_sequence ?? undefined,
				replayGaps: transport.replay_gaps,
				queueDepth: transport.queue_depth,
				droppedUpdates: transport.dropped_updates
			})),
			settings: {
				enabled: value.settings.enabled,
				minLevel: value.settings.min_level,
				payloadTracing: value.settings.payload_tracing,
				payloadTracingExpiresAt: value.settings.payload_tracing_expires_at ?? undefined
			},
			records: value.records.map((record) => ({
				timestamp: record.timestamp,
				component: record.component,
				level: record.level,
				operation: record.operation,
				processId: record.process_id ?? undefined,
				sessionId: record.session_id ?? undefined,
				metadata: record.metadata,
				payloadTrace: record.payload_trace
			})),
			droppedRecords: value.dropped_records,
			revision: value.revision
		};
	}

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => (workspaceId = workspaces[0]?.id))
			.catch(() => {});
		void getDiagnostics()
			.then((value) => (bundle = viewModel(value)))
			.catch((caught: unknown) => (error = caught instanceof Error ? caught.message : String(caught)));
	});

	async function changeSettings(enabled: boolean, level: typeof bundle.settings.minLevel): Promise<void> {
		error = undefined;
		try {
			bundle = viewModel(await updateDiagnosticSettings(enabled, level));
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}

	async function tracePayloads(durationSeconds: number): Promise<void> {
		error = undefined;
		try {
			bundle = viewModel(await startPayloadTracing(durationSeconds));
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}

	async function exportBundle(destination: string, revision: number): Promise<void> {
		error = undefined;
		notice = undefined;
		try {
			await exportDiagnostics(destination, revision);
			notice = 'Diagnostic bundle exported.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}
</script>

<svelte:head><title>Diagnostics · Pau</title></svelte:head>

<ApplicationShell
	workspaceName="Diagnostics"
	contextLabel="Diagnostics"
	productItems={productNavigation(page.route.id, workspaceId)}
	contextItems={[]}>
	{#if error}<p class="diagnostics-route__message diagnostics-route__message--error" role="alert">{error}</p>{/if}
	{#if notice}<p class="diagnostics-route__message" role="status">{notice}</p>{/if}
	<div class="diagnostics-route">
		<div class="diagnostics-route__motion">
			<MotionSettingControl
				value={interfacePreferences.motion}
				onChange={(value) => interfacePreferences.setMotion(value)} />
		</div>
		<DiagnosticsView
			{bundle}
			onSettingsChange={(enabled, level) => void changeSettings(enabled, level)}
			onStartPayloadTracing={(duration) => void tracePayloads(duration)}
			onExport={(destination, revision) => void exportBundle(destination, revision)} />
	</div>
</ApplicationShell>

<style>
	/* The shell's main column already insets the page, so the route adds no padding of its own. */
	.diagnostics-route {
		display: grid;
		gap: 1.5rem;
		color: var(--pau-text, #e7e9f7);
		background: var(--pau-surface, #1c1e2d);
	}

	/* Match the view header's inset so the control starts on the title's edge. */
	.diagnostics-route__motion {
		padding-inline: var(--pau-space-3);
	}

	.diagnostics-route__message {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 5;
		margin: 0;
		padding: 0.65rem 0.8rem;
		color: var(--pau-text, #e7e9f7);
		background: var(--pau-surface-raised, #25283a);
		border: 1px solid var(--pau-accent, #38ef9d);
	}

	.diagnostics-route__message--error {
		border-color: var(--pau-danger, #ee7180);
	}
</style>
