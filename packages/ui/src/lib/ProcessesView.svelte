<script lang="ts">
	import EmptyState from './EmptyState.svelte';
	import MetaText from './MetaText.svelte';
	import '../styles/tokens.css';
	import { formatBytes, formatCpu, formatElapsed } from './resource-format';
	import ViewHeader from './ViewHeader.svelte';
	import type { ProcessResourceActions, ProcessResourceSnapshot } from './types/resource-monitoring';

	let {
		workspaceName,
		processes,
		actions = {},
		onInterrupt,
		onStop
	}: {
		workspaceName: string;
		processes: ProcessResourceSnapshot[];
		actions?: Record<string, ProcessResourceActions>;
		onInterrupt?: (sessionId: string) => void;
		onStop?: (sessionId: string) => void;
	} = $props();

	let expanded = $state<string>();

	function toggle(processId: string): void {
		expanded = expanded === processId ? undefined : processId;
	}
</script>

<section class="processes-view" aria-labelledby="processes-title">
	<ViewHeader eyebrow={workspaceName} title="Processes" titleId="processes-title">
		{#snippet meta()}
			<span class="processes-view__count" aria-live="polite">
				{processes.length} monitored {processes.length === 1 ? 'tree' : 'trees'}
			</span>
		{/snippet}
	</ViewHeader>

	{#if processes.length === 0}
		<EmptyState title="No managed processes">
			<p>Start an agent session or terminal in this workspace to see its resource use.</p>
		</EmptyState>
	{:else}
		<div class="processes-view__table" role="table" aria-label="Workspace process resource use">
			<div class="processes-view__table-heading" role="row">
				<span role="columnheader">Process</span>
				<span role="columnheader">CPU</span>
				<span role="columnheader">Memory</span>
				<span role="columnheader">Count</span>
				<span role="columnheader">Elapsed</span>
				<span role="columnheader">Disk I/O</span>
				<span role="columnheader" class="processes-view__actions-heading">Actions</span>
			</div>
			{#each processes as process (process.processId)}
				<div class:process-row--warning={process.pressure} class="process-row" role="row">
					<div class="process-row__identity" role="cell">
						<button
							type="button"
							aria-label={`${expanded === process.processId ? 'Collapse' : 'Expand'} ${process.label} process tree`}
							aria-expanded={expanded === process.processId}
							onclick={() => toggle(process.processId)}>
							<span aria-hidden="true">{expanded === process.processId ? '▾' : '▸'}</span>
							<span
								><strong>{process.label}</strong><small><MetaText text={`${process.kind} · ${process.status}`} /></small
								></span>
						</button>
						{#if process.pressure}<em>{process.pressure} pressure</em>{/if}
					</div>
					<span role="cell" data-label="CPU">{formatCpu(process.cpuPercent)}</span>
					<span role="cell" data-label="Memory">
						{formatBytes(process.residentMemoryBytes)}
						<small>peak {formatBytes(process.peakResidentMemoryBytes)}</small>
					</span>
					<span role="cell" data-label="Count"
						>{process.processCount}<small>peak {process.peakProcessCount}</small></span>
					<span role="cell" data-label="Elapsed">{formatElapsed(process.elapsedMillis)}</span>
					<span role="cell" data-label="Disk I/O">
						{#if process.diskReadBytes === undefined || process.diskWriteBytes === undefined}
							Unavailable
						{:else}
							↓ {formatBytes(process.diskReadBytes)}<small>↑ {formatBytes(process.diskWriteBytes)}</small>
						{/if}
					</span>
					<div class="process-row__actions" role="cell">
						{#if process.sessionId && actions[process.processId]?.interrupt}
							<button type="button" onclick={() => onInterrupt?.(process.sessionId!)}>Interrupt</button>
						{/if}
						{#if process.sessionId && actions[process.processId]?.stop}
							<button class="process-row__stop" type="button" onclick={() => onStop?.(process.sessionId!)}>Stop</button>
						{/if}
					</div>
				</div>
				{#if expanded === process.processId}
					<div class="process-tree" role="row">
						<div role="cell">
							<h2>{process.label} process tree</h2>
							{#if process.processes.length === 0}
								<p>The process has ended. Only its final summary remains.</p>
							{:else}
								<ul>
									{#each process.processes as child (child.pid)}
										<li>
											<code>PID {child.pid}</code>
											<span>{formatCpu(child.cpuPercent)} CPU</span>
											<span>{formatBytes(child.residentMemoryBytes)} memory</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</section>

<style>
	.processes-view {
		container-type: inline-size;
		min-width: 0;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		/* Line the empty state up with the header's title. */
		--empty-state-inset: var(--pau-space-3);
	}

	.processes-view__count,
	.process-row small,
	.process-tree p {
		color: var(--pau-text-muted);
	}

	.process-tree h2,
	.process-tree p {
		margin: 0;
	}

	.processes-view__table {
		min-width: 48rem;
		border-top: 1px solid var(--pau-border);
	}

	.processes-view__table-heading,
	.process-row {
		display: grid;
		grid-template-columns: minmax(12rem, 1.6fr) repeat(5, minmax(5.5rem, 0.75fr)) minmax(7.5rem, 0.8fr);
		align-items: center;
		gap: var(--pau-space-3);
		min-height: 3.75rem;
		padding-inline: var(--pau-space-3);
		border-bottom: 1px solid var(--pau-border);
	}

	.processes-view__table-heading {
		min-height: var(--pau-size-row-lg);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	.process-row {
		font-variant-numeric: tabular-nums;
	}

	.process-row--warning {
		box-shadow: inset 3px 0 var(--pau-warning);
	}

	.process-row__identity {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
	}

	.process-row__identity > button {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 0;
		padding: var(--pau-space-1) 0;
		color: inherit;
		background: transparent;
		border: 0;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}

	.process-row__identity button span:last-child,
	.process-row > span {
		display: grid;
		min-width: 0;
	}

	.process-row__identity em {
		padding-inline: var(--pau-space-1);
		color: var(--pau-warning);
		font-size: var(--pau-type-xs);
		font-style: normal;
		white-space: nowrap;
	}

	.process-row small {
		font-size: var(--pau-type-xs);
	}

	.process-row__actions {
		display: flex;
		justify-content: end;
		gap: var(--pau-space-1);
	}

	.process-row__actions button {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	.process-row__actions .process-row__stop {
		color: var(--pau-danger);
	}

	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.process-tree {
		padding: var(--pau-space-3) var(--pau-space-4) var(--pau-space-4) 2.75rem;
		border-bottom: 1px solid var(--pau-border);
		background: var(--pau-surface-raised);
	}

	.process-tree h2 {
		font-size: var(--pau-type-sm);
	}

	.process-tree ul {
		display: grid;
		gap: var(--pau-space-2);
		margin: var(--pau-space-2) 0 0;
		padding: 0;
		list-style: none;
	}

	.process-tree li {
		display: grid;
		grid-template-columns: minmax(7rem, 1fr) repeat(2, minmax(7rem, 1fr));
		gap: var(--pau-space-4);
		max-width: 36rem;
	}

	.process-tree code {
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
	}

	@media (max-width: 64rem) {
		.processes-view {
			overflow-x: auto;
		}
	}

	@media (max-width: 42rem) {
		.processes-view :global(.view-header) {
			position: sticky;
			left: 0;
		}

		.processes-view__table {
			min-width: 0;
		}

		.processes-view__table-heading {
			display: none;
		}

		.process-row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--pau-space-3) var(--pau-space-4);
			padding-block: var(--pau-space-3);
		}

		.process-row__identity,
		.process-row__actions {
			grid-column: 1 / -1;
		}

		.process-row > span::before {
			color: var(--pau-text-muted);
			font-size: var(--pau-type-xs);
			content: attr(data-label);
		}

		.process-row__actions {
			justify-content: start;
		}

		.process-tree {
			padding-inline: var(--pau-space-3);
		}

		.process-tree li {
			grid-template-columns: 1fr;
			gap: 0;
		}
	}
</style>
