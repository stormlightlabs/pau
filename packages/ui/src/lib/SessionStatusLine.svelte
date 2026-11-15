<script lang="ts">
	import '../styles/tokens.css';

	import { formatCost, formatTokens } from './context-usage';
	import Icon from './Icon.svelte';
	import MetaText from './MetaText.svelte';
	import type { ExtensionStatus, SessionUsage } from './types/session';

	type Props = {
		/** The session's working directory, when known. */
		path?: string;
		/** The workspace's current Git branch. Absent outside a repository or on a detached HEAD. */
		branch?: string;
		/** Latest usage report. Absent until the agent sends one. */
		usage?: SessionUsage;
		/** Whether the agent reports usage at all. */
		usageSupported?: boolean;
		/** Keyed status text from configured Pi extensions. */
		statuses?: ExtensionStatus[];
	};

	let { path, branch, usage, usageSupported = false, statuses = [] }: Props = $props();

	/**
	 * Mirrors Pi's terminal footer: a zero count is left out, so a session
	 * without replies shows no numbers instead of a row of zeros.
	 */
	const figures = $derived.by(() => {
		if (!usageSupported || !usage) return [];
		const { input, output, cacheRead, cacheWrite } = usage.tokens;
		return [
			{ mark: '↑', label: 'Input tokens', value: input, text: formatTokens(input) },
			{ mark: '↓', label: 'Output tokens', value: output, text: formatTokens(output) },
			{ mark: 'R', label: 'Cache read', value: cacheRead, text: formatTokens(cacheRead) },
			{ mark: 'W', label: 'Cache write', value: cacheWrite, text: formatTokens(cacheWrite) },
			{ mark: '', label: 'Cost', value: usage.cost, text: formatCost(usage.cost) }
		].filter((figure) => figure.value > 0);
	});

	/** Pi's footer orders statuses by key and flattens each to one line. */
	const statusText = $derived(
		statuses
			.toSorted((left, right) => left.key.localeCompare(right.key))
			.map((status) => status.text.replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.join(' · ')
	);
</script>

{#if path || branch || figures.length > 0 || statusText}
	<div class="status-line" role="group" aria-label="Session status">
		<div class="status-line__session">
			{#if path}
				<span class="status-line__path" title={path}>
					<Icon name="files" class="status-line__icon" size={14} />
					<span class="pau-visually-hidden">Working directory</span>
					<!-- Right-to-left direction moves the ellipsis to the start; the isolate keeps the path readable. -->
					<span class="status-line__path-text"><bdi>{path}</bdi></span>
				</span>
			{/if}
			{#if branch}
				<span class="status-line__branch" title={branch}>
					<Icon name="gitBranch" class="status-line__icon" size={14} />
					<span class="pau-visually-hidden">Branch</span>
					<span class="status-line__branch-text">{branch}</span>
				</span>
			{/if}
			{#if figures.length > 0}
				<span class="status-line__figures">
					{#each figures as figure (figure.label)}
						<span class="status-line__figure" title={figure.label}>
							{#if figure.mark}<span aria-hidden="true">{figure.mark}</span>{/if}<span class="pau-visually-hidden"
								>{figure.label}</span>
							{figure.text}
						</span>
					{/each}
				</span>
			{/if}
		</div>
		{#if statusText}
			<p class="status-line__extensions"><MetaText text={statusText} /></p>
		{/if}
	</div>
{/if}

<style>
	/*
	 * Statuses wrap under the session details before anything shrinks. On
	 * the first row the path gives up its width before the branch, and the
	 * figures never shrink.
	 */
	.status-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-1) var(--pau-space-4);
		/* Without it, the full path's width would widen the composer column. */
		min-width: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		line-height: 1.5;
	}

	.status-line__session {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--pau-space-3);
		min-width: 0;
		font-family: var(--pau-font-code);
		font-variant-numeric: tabular-nums;
	}

	.status-line__path,
	.status-line__branch,
	.status-line__figure {
		display: inline-flex;
		align-items: center;
		gap: var(--pau-space-1);
		white-space: nowrap;
	}

	.status-line__path {
		flex: 0 1000 auto;
		min-width: 0;
	}

	/* A branch keeps its full name up to a cap, so the path always shrinks first. */
	.status-line__branch {
		flex: none;
		max-width: 28ch;
	}

	.status-line :global(.status-line__icon) {
		flex: none;
	}

	.status-line__path-text,
	.status-line__branch-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-line__path-text {
		direction: rtl;
		text-align: left;
	}

	.status-line__figures {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--pau-space-3);
		margin-inline-start: auto;
	}

	.status-line__extensions {
		flex: 0 1 auto;
		margin: 0 0 0 auto;
		text-align: end;
	}
</style>
