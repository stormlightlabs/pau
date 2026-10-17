<script lang="ts">
	import {
		contextLevel,
		formatCost,
		formatPercent,
		formatTokenCount,
		formatTokens,
		type ContextLevel
	} from './context-usage';
	import type { SessionUsage } from './types/session';

	type Props = {
		/** Latest usage report. Absent until the agent has sent one, which hides the meter. */
		usage?: SessionUsage;
		/** Whether the agent reports usage at all. */
		supported?: boolean;
	};

	let { usage, supported = true }: Props = $props();

	let open = $state(false);
	let root = $state<HTMLDivElement>();

	const context = $derived(usage?.context);
	const level = $derived<ContextLevel>(context ? contextLevel(context) : 'unknown');
	const summary = $derived.by(() => {
		if (!context) return 'Usage';
		const window = formatTokens(context.contextWindow);
		return context.tokens === undefined
			? `Context unknown / ${window}`
			: `Context ${formatTokens(context.tokens)} / ${window} · ${formatPercent(context.percent ?? 0)}`;
	});
	const note = $derived.by(() => {
		if (context?.tokens === undefined && context) return 'Pi measures context again after its next reply.';
		if (level === 'danger') return 'The context window is almost full.';
		if (level === 'warning') return 'The context window is filling up.';
		return undefined;
	});

	function closeOutside(event: PointerEvent): void {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window
	onpointerdown={closeOutside}
	onkeydown={(event) => {
		if (event.key === 'Escape') open = false;
	}} />

{#if supported && usage}
	<div class="context-meter" bind:this={root}>
		<button
			type="button"
			class={`context-meter__button context-meter__button--${level}`}
			aria-expanded={open}
			aria-controls="context-meter-details"
			onclick={() => (open = !open)}>
			<span class="context-meter__label">{summary}</span>
			{#if context}
				<span
					class="context-meter__bar"
					{...context.percent === undefined
						? { 'aria-hidden': true }
						: {
								role: 'meter',
								'aria-label': 'Context window used',
								'aria-valuemin': 0,
								'aria-valuemax': 100,
								'aria-valuenow': context.percent,
								'aria-valuetext': formatPercent(context.percent)
							}}>
					<span style:width={`${Math.min(100, context.percent ?? 0)}%`}></span>
				</span>
			{/if}
		</button>
		{#if open}
			<div id="context-meter-details" class="context-meter__details" role="group" aria-label="Session usage">
				{#if note}<p class={`context-meter__note context-meter__note--${level}`}>{note}</p>{/if}
				<dl>
					{#if context}
						<div>
							<dt>Context window</dt>
							<dd>{formatTokenCount(context.contextWindow)}</dd>
						</div>
					{/if}
					<div>
						<dt>Input tokens</dt>
						<dd>{formatTokenCount(usage.tokens.input)}</dd>
					</div>
					<div>
						<dt>Output tokens</dt>
						<dd>{formatTokenCount(usage.tokens.output)}</dd>
					</div>
					<div>
						<dt>Cache read</dt>
						<dd>{formatTokenCount(usage.tokens.cacheRead)}</dd>
					</div>
					<div>
						<dt>Cache write</dt>
						<dd>{formatTokenCount(usage.tokens.cacheWrite)}</dd>
					</div>
					<div>
						<dt>Total tokens</dt>
						<dd>{formatTokenCount(usage.tokens.total)}</dd>
					</div>
					<div>
						<dt>Cost</dt>
						<dd>{formatCost(usage.cost)}</dd>
					</div>
				</dl>
			</div>
		{/if}
	</div>
{/if}

<style>
	.context-meter {
		position: relative;
	}

	.context-meter__button {
		display: grid;
		gap: var(--pau-space-1);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-sm);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.context-meter__button--warning {
		border-color: var(--pau-warning);
	}

	.context-meter__button--danger {
		border-color: var(--pau-danger);
	}

	.context-meter__bar {
		display: block;
		height: 3px;
		overflow: hidden;
		background: var(--pau-border);
		border-radius: 2px;
	}

	.context-meter__bar span {
		display: block;
		height: 100%;
		background: var(--pau-accent);
	}

	.context-meter__button--warning .context-meter__bar span {
		background: var(--pau-warning);
	}

	.context-meter__button--danger .context-meter__bar span {
		background: var(--pau-danger);
	}

	.context-meter__details {
		position: absolute;
		top: calc(100% + var(--pau-space-1));
		right: 0;
		z-index: 10;
		width: 16rem;
		max-width: 80vw;
		padding: var(--pau-space-3);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		font-size: var(--pau-type-sm);
	}

	.context-meter__note {
		margin: 0 0 var(--pau-space-2);
		color: var(--pau-text-muted);
	}

	.context-meter__note--warning {
		color: var(--pau-warning);
	}

	.context-meter__note--danger {
		color: var(--pau-danger);
	}

	dl {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
	}

	dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--pau-space-3);
	}

	dt {
		color: var(--pau-text-muted);
	}

	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
</style>
