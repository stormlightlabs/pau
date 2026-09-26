<script lang="ts">
	import { formatBytes, formatCpu, formatElapsed } from './resource-format';
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
	<header>
		<div>
			<p>{workspaceName}</p>
			<h1 id="processes-title">Processes</h1>
		</div>
		<span aria-live="polite">{processes.length} monitored {processes.length === 1 ? 'tree' : 'trees'}</span>
	</header>

	{#if processes.length === 0}
		<div class="processes-view__empty">
			<h2>No managed processes</h2>
			<p>Start an agent session or terminal in this workspace to see its resource use.</p>
		</div>
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
							<span><strong>{process.label}</strong><small>{process.kind} · {process.status}</small></span>
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
		min-width: 0;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	header p,
	header h1,
	header span,
	.processes-view__empty h2,
	.processes-view__empty p,
	.process-tree h2,
	.process-tree p {
		margin: 0;
	}

	header p,
	header span,
	.process-row small,
	.process-tree p {
		color: var(--pau-text-muted);
	}

	header p {
		font-size: 0.72rem;
	}

	h1 {
		font-size: 1.35rem;
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
		gap: 0.75rem;
		min-height: 3.75rem;
		padding-inline: 0.75rem;
		border-bottom: 1px solid var(--pau-border);
	}

	.processes-view__table-heading {
		min-height: 2.25rem;
		color: var(--pau-text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
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
		gap: 0.5rem;
		min-width: 0;
		padding: 0.35rem 0;
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
		padding-inline: 0.35rem;
		color: var(--pau-warning);
		font-size: 0.68rem;
		font-style: normal;
		white-space: nowrap;
	}

	.process-row small {
		font-size: 0.68rem;
	}

	.process-row__actions {
		display: flex;
		justify-content: end;
		gap: 0.35rem;
	}

	.process-row__actions button {
		min-height: 2rem;
		padding-inline: 0.55rem;
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
	}

	.process-row__actions .process-row__stop {
		color: var(--pau-danger);
	}

	button:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 2px;
	}

	.process-tree {
		padding: 0.75rem 1rem 1rem 2.75rem;
		border-bottom: 1px solid var(--pau-border);
		background: var(--pau-surface-raised);
	}

	.process-tree h2 {
		font-size: 0.78rem;
	}

	.process-tree ul {
		display: grid;
		gap: 0.4rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
	}

	.process-tree li {
		display: grid;
		grid-template-columns: minmax(7rem, 1fr) repeat(2, minmax(7rem, 1fr));
		gap: 1rem;
		max-width: 36rem;
	}

	.process-tree code {
		font-family: ui-monospace, monospace;
	}

	.processes-view__empty {
		padding: 3rem 1rem;
		border-block: 1px solid var(--pau-border);
		text-align: center;
	}

	.processes-view__empty h2 {
		font-size: 1rem;
	}

	.processes-view__empty p {
		margin-top: 0.35rem;
		color: var(--pau-text-muted);
	}

	@media (max-width: 64rem) {
		.processes-view {
			overflow-x: auto;
		}
	}

	@media (max-width: 42rem) {
		header {
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
			gap: 0.65rem 1rem;
			padding-block: 0.8rem;
		}

		.process-row__identity,
		.process-row__actions {
			grid-column: 1 / -1;
		}

		.process-row > span::before {
			color: var(--pau-text-muted);
			font-size: 0.68rem;
			content: attr(data-label);
		}

		.process-row__actions {
			justify-content: start;
		}

		.process-tree {
			padding-inline: 0.75rem;
		}

		.process-tree li {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
	}
</style>
