<script lang="ts">
	import type { SessionViewModel } from './types/session';
	import '../styles/tokens.css';

	type Props = {
		status: SessionViewModel['status'];
		/** Accessible name for the mark, such as "Running". */
		label: string;
	};

	let { status, label }: Props = $props();
</script>

<!--
	One glyph per state so the state never depends on color alone. Only the
	running arc moves, and it holds still under reduced motion.
-->
<svg
	class={`session-status-mark session-status-mark--${status}`}
	data-status={status}
	role="img"
	aria-label={label}
	viewBox="0 0 12 12"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round">
	{#if status === 'idle'}
		<circle cx="6" cy="6" r="3.5" fill="currentColor" stroke="none" />
	{:else if status === 'running'}
		<circle cx="6" cy="6" r="4" opacity="0.3" />
		<path d="M6 2a4 4 0 0 1 4 4" />
	{:else if status === 'starting'}
		<circle cx="6" cy="6" r="4" stroke-dasharray="2 2" />
	{:else if status === 'waiting'}
		<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="currentColor" />
	{:else if status === 'not_responding'}
		<circle cx="6" cy="6" r="4" />
		<path d="M6 3.75v2.5M6 8.25v0" />
	{:else if status === 'stopping'}
		<rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke-dasharray="2 2" />
	{:else if status === 'stopped'}
		<rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />
	{:else}
		<path d="M3 3l6 6M9 3l-6 6" />
	{/if}
</svg>

<style>
	.session-status-mark {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		color: var(--pau-text-muted);
	}

	.session-status-mark--idle,
	.session-status-mark--running {
		color: var(--pau-success);
	}

	.session-status-mark--starting,
	.session-status-mark--stopping {
		color: var(--pau-info);
	}

	.session-status-mark--waiting {
		color: var(--pau-warning);
	}

	.session-status-mark--not_responding,
	.session-status-mark--failed {
		color: var(--pau-danger);
	}

	.session-status-mark--running {
		animation: session-status-spin 0.9s linear infinite;
	}

	@keyframes session-status-spin {
		to {
			transform: rotate(360deg);
		}
	}

	:global(:root[data-motion='reduce']) .session-status-mark--running {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .session-status-mark--running {
			animation: none;
		}
	}
</style>
