<script lang="ts">
	import type { ProcessResourceActions, ProcessResourceSnapshot } from './types/resource-monitoring';
	import { formatBytes, formatCpu, formatElapsed } from './resource-format';

	let {
		snapshot,
		actions = { interrupt: false, stop: false },
		onInterrupt,
		onStop
	}: {
		snapshot?: ProcessResourceSnapshot;
		actions?: ProcessResourceActions;
		onInterrupt?: (sessionId: string) => void;
		onStop?: (sessionId: string) => void;
	} = $props();
</script>

<section class="resource-summary" aria-labelledby="resource-summary-title">
	<div class="resource-summary__heading">
		<h2 id="resource-summary-title">Machine resources</h2>
		{#if snapshot}<span>{formatElapsed(snapshot.elapsedMillis)}</span>{/if}
	</div>
	{#if snapshot}
		<dl>
			<div>
				<dt>CPU</dt>
				<dd>{formatCpu(snapshot.cpuPercent)}</dd>
			</div>
			<div>
				<dt>Memory</dt>
				<dd>
					{formatBytes(snapshot.residentMemoryBytes)}
					<small>peak {formatBytes(snapshot.peakResidentMemoryBytes)}</small>
				</dd>
			</div>
			<div>
				<dt>Processes</dt>
				<dd>{snapshot.processCount}</dd>
			</div>
			<div>
				<dt>Disk I/O</dt>
				<dd>
					{#if snapshot.diskReadBytes === undefined || snapshot.diskWriteBytes === undefined}
						Unavailable
					{:else}
						↓ {formatBytes(snapshot.diskReadBytes)} · ↑ {formatBytes(snapshot.diskWriteBytes)}
					{/if}
				</dd>
			</div>
		</dl>
		{#if snapshot.pressure}
			<div class="resource-summary__warning" role="status">
				<strong>Sustained {snapshot.pressure === 'cpu' ? 'CPU' : 'memory'} pressure</strong>
				<span>The session will keep running until you act.</span>
				{#if snapshot.sessionId && (actions.interrupt || actions.stop)}
					<div>
						{#if actions.interrupt}
							<button type="button" onclick={() => onInterrupt?.(snapshot.sessionId!)}>Interrupt work</button>
						{/if}
						{#if actions.stop}
							<button class="resource-summary__stop" type="button" onclick={() => onStop?.(snapshot.sessionId!)}>
								Stop session
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<p class="resource-summary__empty">Resource samples will appear after the process starts.</p>
	{/if}
</section>

<style>
	.resource-summary {
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	.resource-summary__heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding-block: 0.65rem;
		border-bottom: 1px solid var(--pau-border);
	}

	h2 {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
	}

	.resource-summary__heading span,
	.resource-summary__empty,
	dt,
	small,
	.resource-summary__warning span {
		color: var(--pau-text-muted);
	}

	dl {
		display: grid;
		gap: 0;
		margin: 0;
	}

	dl > div {
		display: grid;
		grid-template-columns: minmax(5rem, 0.75fr) minmax(0, 1.25fr);
		gap: 0.75rem;
		padding-block: 0.55rem;
		border-bottom: 1px solid color-mix(in srgb, var(--pau-border) 65%, transparent);
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		min-width: 0;
		font-variant-numeric: tabular-nums;
		text-align: end;
	}

	dd small {
		display: block;
		font-size: 0.68rem;
	}

	.resource-summary__warning {
		display: grid;
		gap: 0.35rem;
		margin-top: 0.75rem;
		padding: 0.75rem;
		border-left: 3px solid var(--pau-warning);
		background: var(--pau-surface-raised);
	}

	.resource-summary__warning > div {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}

	button {
		min-height: 2rem;
		padding-inline: 0.65rem;
		color: var(--pau-canvas);
		background: var(--pau-warning);
		border: 0;
		border-radius: 3px;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 2px;
	}

	.resource-summary__stop {
		color: var(--pau-canvas);
		background: var(--pau-danger);
	}

	.resource-summary__empty {
		margin: 0;
		padding-block: 0.75rem;
	}
</style>
