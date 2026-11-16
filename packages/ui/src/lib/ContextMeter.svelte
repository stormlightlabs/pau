<script lang="ts">
	import '../styles/tokens.css';
	import { dismissible } from './dismissal';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import MetaText from './MetaText.svelte';
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
	/** A keyboard open appears at once. A pointer open fades in, as Select's list does. */
	let keyboardOpen = $state(false);
	let trigger = $state<HTMLButtonElement>();
	const focusReturn = createFocusReturn();

	const context = $derived(usage?.context);
	const level = $derived<ContextLevel>(context ? contextLevel(context) : 'unknown');
	const summary = $derived.by(() => {
		if (!context) return 'Usage';
		const window = formatTokens(context.contextWindow);
		return context.tokens === undefined
			? `unknown / ${window}`
			: `${formatTokens(context.tokens)} / ${window} · ${formatPercent(context.percent ?? 0)}`;
	});
	/** The label in a narrow container: the share used, or that it is unknown. */
	const short = $derived(context && (context.tokens === undefined ? 'unknown' : formatPercent(context.percent ?? 0)));
	const note = $derived.by(() => {
		if (context && context.tokens === undefined) return 'Pi measures context again after its next reply.';
		if (level === 'danger') return 'The context window is almost full.';
		if (level === 'warning') return 'The context window is filling up.';
		return;
	});

	function toggle(event: MouseEvent): void {
		if (open) {
			open = false;
			return;
		}
		focusReturn.capture(trigger);
		// Assistive technology and keyboard clicks report no pointer detail.
		keyboardOpen = event.detail === 0;
		open = true;
	}
</script>

{#if supported && usage}
	<div
		class="context-meter"
		{@attach open && dismissible({ close: () => (open = false), restoreFocus: () => focusReturn.restore() })}>
		<button
			bind:this={trigger}
			type="button"
			class={`context-meter__button context-meter__button--${level} pau-field`}
			aria-expanded={open}
			aria-controls="context-meter-details"
			onclick={toggle}>
			<span class="context-meter__label">
				<!--
					The bar and the details name the context window, so the label shows only the figures.
					The space after the hidden name starts the line, so CSS drops it from view but the
					accessible name keeps it.
				-->
				<span
					>{#if context}<span class="pau-visually-hidden">Context</span>{/if}
					<span class="context-meter__summary"><MetaText text={summary} /></span>{#if short}<span
							class="context-meter__short">{short}</span
						>{/if}</span>
				<Icon name="chevronDown" class="context-meter__chevron" size="0.75rem" />
			</span>
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
			<div
				id="context-meter-details"
				class="context-meter__details pau-menu"
				class:context-meter__details--keyboard={keyboardOpen}
				role="group"
				aria-label="Session usage">
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

	/*
	 * Select's quiet trigger, with the usage bar under the label. The bar sits
	 * in the bottom padding, so the label centers on the same line as the other
	 * footer controls.
	 */
	.context-meter__button {
		position: relative;
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-2);
		text-align: start;
		background-color: transparent;
		/* Quiet like the other composer footer controls until usage nears the limit. */
		border: 1px solid transparent;
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.context-meter__button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.context-meter__short {
		display: none;
	}

	/*
	 * In a narrow container, such as the composer footer in a phone-width
	 * view, the label keeps only the share used. The details still list the
	 * window and token totals, and display: none keeps the hidden form out of
	 * the accessible name.
	 */
	@container (width < 32rem) {
		.context-meter__summary:has(+ .context-meter__short) {
			display: none;
		}

		.context-meter__short {
			display: inline;
		}
	}

	.context-meter__label {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
	}

	.context-meter__button :global(.context-meter__chevron) {
		flex: none;
		margin-left: auto;
		color: var(--pau-text-muted);
	}

	/* Near the limit, the state border outranks the shared hover border. */
	.context-meter__button.context-meter__button--warning,
	.context-meter__button.context-meter__button--warning:hover {
		border-color: var(--pau-warning);
	}

	.context-meter__button.context-meter__button--danger,
	.context-meter__button.context-meter__button--danger:hover {
		border-color: var(--pau-danger);
	}

	.context-meter__bar {
		position: absolute;
		right: var(--pau-space-1);
		bottom: 0;
		left: var(--pau-space-1);
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

	/*
	 * It sits in the composer footer at the bottom of the window, so it opens
	 * upward from the trigger's left edge, on Select's list surface.
	 */
	.context-meter__details {
		position: absolute;
		bottom: calc(100% + var(--pau-space-1));
		left: 0;
		z-index: 10;
		width: 16rem;
		max-width: calc(100vw - 1rem);
		padding: var(--pau-space-3);
		font-size: var(--pau-type-sm);
		transform-origin: bottom left;
		animation: context-meter-enter var(--pau-duration-move) var(--pau-ease-out);
	}

	.context-meter__details--keyboard {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .context-meter__details {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .context-meter__details {
			animation: none;
		}
	}

	@keyframes context-meter-enter {
		from {
			opacity: 0;
			transform: scale(var(--pau-motion-scale-enter));
		}
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
