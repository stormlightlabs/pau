<script lang="ts">
	import { onMount } from 'svelte';

	import Icon from './Icon.svelte';
	import { formatRelativeTime } from './relative-time';
	import type { SessionSearchHit, SessionSearchOutcome } from './types/session';

	type Props = {
		/** Searches the conversation. A rejection shows its message with a retry. */
		search: (query: string) => Promise<SessionSearchOutcome>;
		/**
		 * Brings a match into view. Returns `false` when the loaded transcript
		 * has no entry for it, and the bar says so.
		 */
		onSelect: (hit: SessionSearchHit) => boolean;
		onClose: () => void;
		/** Names the assistant in result rows. */
		agent?: string;
		/** Wait after the last keystroke before searching. Tests set it to 0. */
		delay?: number;
		/** Reference time for relative dates. Tests set it for stable output. */
		now?: Date;
	};

	let { search, onSelect, onClose, agent = 'Agent', delay = 250, now = new Date() }: Props = $props();

	type Phase = 'idle' | 'searching' | 'done' | 'failed';

	let query = $state('');
	let phase = $state<Phase>('idle');
	let outcome = $state<SessionSearchOutcome>();
	let failure = $state<string>();
	let active = $state(0);
	let notice = $state<string>();
	let input = $state<HTMLInputElement>();
	let retries = $state(0);
	let requests = 0;

	const trimmed = $derived(query.trim());
	const hits = $derived(outcome?.hits ?? []);

	onMount(() => focus());

	/** Moves focus to the query and selects it, so a repeated shortcut starts a new search. */
	export function focus(): void {
		input?.focus();
		input?.select();
	}

	// Each change restarts the wait. A response for an older query is dropped.
	$effect(() => {
		const text = trimmed;
		void retries;
		const request = ++requests;
		notice = undefined;
		if (!text) {
			phase = 'idle';
			outcome = undefined;
			return;
		}
		phase = 'searching';
		const timer = setTimeout(async () => {
			try {
				const result = await search(text);
				if (request !== requests) return;
				outcome = result;
				active = 0;
				phase = 'done';
			} catch (cause) {
				if (request !== requests) return;
				failure = cause instanceof Error ? cause.message : 'The transcript could not be searched. Try again.';
				phase = 'failed';
			}
		}, delay);
		return () => clearTimeout(timer);
	});

	function select(index: number): void {
		const hit = hits[index];
		if (!hit) return;
		active = index;
		notice = onSelect(hit) ? undefined : 'That message is not in the loaded transcript.';
	}

	function step(offset: number): void {
		if (hits.length === 0) return;
		select((active + offset + hits.length) % hits.length);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			step(event.key === 'ArrowDown' ? 1 : -1);
		} else if (phase === 'done' && event.key === 'Enter') {
			event.preventDefault();
			select(active);
		}
	}

	function roleLabel(role: string | undefined): string {
		if (role === 'user') return 'You';
		if (role === 'assistant') return agent;
		if (role === 'toolResult') return 'Tool result';
		return 'Summary';
	}

	/** Clamps the offsets so a malformed match still renders the snippet. */
	function parts(hit: SessionSearchHit): [string, string, string] {
		const start = Math.min(Math.max(hit.matchStart, 0), hit.snippet.length);
		const end = Math.min(Math.max(hit.matchEnd, start), hit.snippet.length);
		return [hit.snippet.slice(0, start), hit.snippet.slice(start, end), hit.snippet.slice(end)];
	}
</script>

<!-- Escape is handled on the container so it closes from the result buttons too. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="transcript-search" aria-label="Search transcript" onkeydown={handleKeydown}>
	<div class="transcript-search__field">
		<Icon name="search" />
		<input
			bind:this={input}
			bind:value={query}
			type="search"
			placeholder="Search this conversation"
			aria-label="Search transcript"
			autocomplete="off"
			spellcheck="false" />
		<button type="button" class="transcript-search__close" aria-label="Close search" onclick={onClose}>
			<Icon name="close" />
		</button>
	</div>

	{#if phase === 'idle'}
		<p class="transcript-search__status">Type to search this conversation.</p>
	{:else if phase === 'searching'}
		<p class="transcript-search__status" role="status">Searching…</p>
	{:else if phase === 'failed'}
		<p class="transcript-search__status transcript-search__status--failed" role="alert">
			{failure}
			<button type="button" onclick={() => retries++}>Try again</button>
		</p>
	{:else if hits.length === 0}
		<p class="transcript-search__status" role="status">No matches for “{trimmed}”.</p>
	{:else}
		<ul class="transcript-search__results" aria-label="Search results">
			{#each hits as hit, index (hit.id)}
				{@const [before, found, after] = parts(hit)}
				{@const when = formatRelativeTime(hit.timestamp, now)}
				<li>
					<button
						type="button"
						tabindex="-1"
						aria-current={index === active ? 'true' : undefined}
						onclick={() => select(index)}>
						<span class="transcript-search__meta">
							<strong>{roleLabel(hit.role)}</strong>
							{#if when}<small>{when}</small>{/if}
						</span>
						<span class="transcript-search__snippet">{before}<mark>{found}</mark>{after}</span>
					</button>
				</li>
			{/each}
		</ul>
		<p class="transcript-search__status" role="status">
			{#if outcome?.truncated}
				Showing the newest {hits.length} matches.
			{:else}
				{hits.length === 1 ? '1 match' : `${hits.length} matches`}
			{/if}
			{#if notice}<span class="transcript-search__notice">{notice}</span>{/if}
		</p>
	{/if}
</section>

<style>
	.transcript-search {
		display: grid;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2);
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		animation: transcript-search-enter var(--pau-duration-medium) var(--pau-ease-enter);
	}

	@keyframes transcript-search-enter {
		from {
			opacity: 0;
			transform: translateY(calc(-1 * var(--pau-motion-offset-sm)));
		}
	}

	.transcript-search__field {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		color: var(--pau-text-muted);
	}

	input {
		flex: 1;
		min-width: 0;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-md);
	}

	input:focus-visible,
	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	button {
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.transcript-search__close {
		min-width: var(--pau-size-row-md);
		min-height: var(--pau-size-row-md);
		background: transparent;
		border: 0;
		border-radius: var(--pau-radius-control);
	}

	.transcript-search__status {
		margin: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.transcript-search__status--failed {
		color: var(--pau-danger);
	}

	.transcript-search__status button {
		margin-left: var(--pau-space-2);
		padding: 0;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		text-decoration: underline;
	}

	.transcript-search__notice {
		margin-left: var(--pau-space-2);
		color: var(--pau-warning);
	}

	.transcript-search__results {
		display: grid;
		max-height: 16rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.transcript-search__results button {
		display: grid;
		gap: var(--pau-space-1);
		width: 100%;
		padding: var(--pau-space-2);
		color: var(--pau-text);
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: var(--pau-radius-control);
		transition: background-color var(--pau-duration-feedback) var(--pau-ease-standard);
	}

	.transcript-search__results button:hover,
	.transcript-search__results button[aria-current='true'] {
		background: var(--pau-surface);
	}

	.transcript-search__meta {
		display: flex;
		gap: var(--pau-space-2);
		font-size: var(--pau-type-xs);
		color: var(--pau-text-muted);
	}

	.transcript-search__meta strong {
		color: var(--pau-text);
		font-weight: var(--pau-weight-semibold);
	}

	.transcript-search__snippet {
		font-size: var(--pau-type-sm);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	mark {
		color: inherit;
		background: color-mix(in srgb, var(--pau-accent) 30%, transparent);
		border-radius: 2px;
	}
</style>
