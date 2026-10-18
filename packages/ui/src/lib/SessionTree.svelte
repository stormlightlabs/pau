<script lang="ts">
	import '../styles/tokens.css';
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { entryLabel, flattenSessionTree, type SessionTreeRow } from './session-tree';
	import type { SessionBranchOutcome, SessionTreeSnapshot } from './types/session';

	type Props = {
		/** Agent name used to label its messages. */
		agent: string;
		/** Whether the session can show its tree and branch. When false, nothing loads. */
		supported: boolean;
		/** Reads the session tree. A rejection shows its message. */
		load: () => Promise<SessionTreeSnapshot>;
		/** Branches from a user message. A rejection shows its message. */
		onBranch: (entryId: string) => Promise<SessionBranchOutcome>;
		/** Receives the branched message's text so the composer can offer it for editing. */
		onBranched?: (text: string) => void;
		/** Explains why branching is unavailable right now, such as during a run. */
		branchUnavailable?: string;
		/**
		 * Reloads the tree whenever it changes to a value other than `null`.
		 * The session view passes the transcript length while the session is
		 * idle, so the tree catches up after each completed run.
		 */
		revision?: unknown;
	};

	let { agent, supported, load, onBranch, onBranched, branchUnavailable, revision = 0 }: Props = $props();

	/** Rows rendered beyond each edge of the viewport so fast scrolling does not flash blank. */
	const OVERSCAN = 8;

	let tree = $state<SessionTreeSnapshot>();
	let loadError = $state<string>();
	let branchError = $state<string>();
	let branchNotice = $state<string>();
	let branching = $state(false);
	let activeKey = $state<string>();
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	let rowHeight = $state(28);
	let viewport = $state<HTMLDivElement>();
	const collapsed = new SvelteSet<string>();
	const expandedRuns = new SvelteSet<string>();

	const rows = $derived(tree ? flattenSessionTree(tree, { collapsed, expandedRuns }) : []);
	const indexByKey = $derived(new Map(rows.map((row, index) => [row.key, index])));
	const activeIndex = $derived(activeKey === undefined ? 0 : (indexByKey.get(activeKey) ?? 0));
	const activeRow = $derived<SessionTreeRow | undefined>(rows[activeIndex]);
	/**
	 * Only rows inside the viewport, plus the focused row, reach the DOM. The
	 * focused row stays rendered so the tree always has a tab stop.
	 */
	const windowed = $derived.by(() => {
		const height = Math.max(rowHeight, 1);
		const start = Math.max(0, Math.floor(scrollTop / height) - OVERSCAN);
		const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / height) + OVERSCAN);
		const indexes = Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
		if (rows.length > 0 && (activeIndex < start || activeIndex >= end)) indexes.push(activeIndex);
		return indexes;
	});
	const branchTarget = $derived(activeRow?.kind === 'entry' && activeRow.item.role === 'user' ? activeRow : undefined);

	async function fetchTree(initial: boolean): Promise<void> {
		loadError = undefined;
		try {
			const next = await load();
			tree = next;
			if (initial || activeKey === undefined || next.entries.every((entry) => entry.id !== activeKey)) {
				activeKey = next.leafId ?? next.entries.at(-1)?.id;
				await tick();
				revealActive('center');
			}
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Pau could not read the session tree.';
		}
	}

	$effect(() => {
		if (!supported || revision === null) return;
		untrack(() => void fetchTree(tree === undefined));
	});

	/** Scrolls so the focused row is visible. */
	function revealActive(align: 'nearest' | 'center' = 'nearest'): void {
		if (!viewport) return;
		const top = activeIndex * rowHeight;
		if (align === 'center') {
			viewport.scrollTop = Math.max(0, top - (viewport.clientHeight - rowHeight) / 2);
		} else if (top < viewport.scrollTop) {
			viewport.scrollTop = top;
		} else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) {
			viewport.scrollTop = top + rowHeight - viewport.clientHeight;
		}
		scrollTop = viewport.scrollTop;
	}

	async function focusRow(key: string | undefined): Promise<void> {
		if (key === undefined) return;
		activeKey = key;
		branchError = undefined;
		branchNotice = undefined;
		await tick();
		revealActive();
		await tick();
		viewport?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
	}

	function toggle(row: SessionTreeRow, expand: boolean): boolean {
		if (row.kind === 'run') {
			if (!expand) return false;
			expandedRuns.add(row.key);
			void focusRow(row.firstId);
			return true;
		}
		if (row.expanded === undefined || row.expanded === expand) return false;
		if (expand) collapsed.delete(row.key);
		else collapsed.add(row.key);
		return true;
	}

	function handleKeydown(event: KeyboardEvent): void {
		const row = activeRow;
		if (!row) return;
		const page = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
		const at = (index: number) => rows[Math.min(rows.length - 1, Math.max(0, index))]?.key;
		let target: string | undefined;
		switch (event.key) {
			case 'ArrowDown': {
				target = at(activeIndex + 1);
				break;
			}
			case 'ArrowUp': {
				target = at(activeIndex - 1);
				break;
			}
			case 'PageDown': {
				target = at(activeIndex + page);
				break;
			}
			case 'PageUp': {
				target = at(activeIndex - page);
				break;
			}
			case 'Home': {
				target = at(0);
				break;
			}
			case 'End': {
				target = at(rows.length - 1);
				break;
			}
			case 'ArrowRight': {
				if (!toggle(row, true) && row.kind === 'entry' && row.expanded) target = at(activeIndex + 1);
				break;
			}
			case 'ArrowLeft': {
				if (!toggle(row, false)) target = row.parentKey;
				break;
			}
			case 'Enter':
			case ' ': {
				if (row.kind === 'run') toggle(row, true);
				else if (row.expanded !== undefined) toggle(row, !row.expanded);
				break;
			}
			default: {
				return;
			}
		}
		event.preventDefault();
		if (target !== undefined) void focusRow(target);
	}

	async function branch(entryId: string): Promise<void> {
		if (branching) return;
		branching = true;
		branchError = undefined;
		branchNotice = undefined;
		try {
			const outcome = await onBranch(entryId);
			if (outcome.cancelled) {
				branchNotice = 'An extension cancelled the branch. The session is unchanged.';
				return;
			}
			onBranched?.(outcome.text ?? '');
			branchNotice = 'Branched. Edit the prompt in the composer and send it to continue.';
			await fetchTree(true);
		} catch (cause) {
			branchError = cause instanceof Error ? cause.message : 'Pau could not branch the session. Try again.';
		} finally {
			branching = false;
		}
	}

	function timestamp(value: string | undefined): string {
		const time = value ? new Date(value) : undefined;
		return time && !Number.isNaN(time.getTime())
			? time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			: '';
	}
</script>

<section class="session-tree" aria-labelledby="session-tree-title" aria-busy={branching}>
	<div class="session-tree__heading">
		<h2 id="session-tree-title">Session tree</h2>
		{#if supported && tree}<span>{tree.entries.length.toLocaleString('en')} entries</span>{/if}
	</div>

	{#if !supported}
		<p class="session-tree__note">{agent} sessions do not support branching, so there is no tree to show.</p>
	{:else if loadError}
		<div class="session-tree__error" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={() => void fetchTree(tree === undefined)}>Try again</button>
		</div>
	{:else if !tree}
		<p class="session-tree__note" role="status">Loading session tree…</p>
	{:else if tree.entries.length === 0}
		<p class="session-tree__note">No entries yet. Send a prompt to start the tree.</p>
	{:else}
		{#if tree.truncated}
			<p class="session-tree__note session-tree__note--truncated" role="note">
				Showing the newest {tree.entries.length.toLocaleString('en')} entries. Older entries are not listed.
			</p>
		{/if}
		<div class="session-tree__probe" aria-hidden="true" bind:clientHeight={rowHeight}></div>
		<div
			class="session-tree__viewport"
			role="tree"
			aria-label="Session entries"
			tabindex="-1"
			bind:this={viewport}
			bind:clientHeight={viewportHeight}
			onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
			onkeydown={handleKeydown}>
			<div class="session-tree__spacer" aria-hidden="true" style:height={`${rows.length * rowHeight}px`}></div>
			{#each windowed as index (rows[index]!.key)}
				{@const row = rows[index]!}
				<!-- The tree element handles every row's keys, as the ARIA tree pattern expects. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="session-tree__row"
					class:session-tree__row--path={row.onPath}
					class:session-tree__row--run={row.kind === 'run'}
					role="treeitem"
					tabindex={index === activeIndex ? 0 : -1}
					data-key={row.key}
					aria-level={row.level}
					aria-posinset={row.position}
					aria-setsize={row.setSize}
					aria-selected={index === activeIndex}
					aria-expanded={row.kind !== 'run' && row.expanded}
					style:top={`${index * rowHeight}px`}
					style:--depth={row.level - 1}
					onclick={() => {
						void focusRow(row.key);
						if (row.kind === 'run') toggle(row, true);
					}}>
					<span class="session-tree__gutter" aria-hidden="true">
						{#if row.kind === 'entry' && row.expanded !== undefined}{row.expanded ? '▾' : '▸'}{/if}
					</span>
					{#if row.kind === 'run'}
						<span class="session-tree__label">Show {row.count} more entries</span>
					{:else}
						<span class="session-tree__label" class:session-tree__label--user={row.item.role === 'user'}>
							{entryLabel(row.item, agent)}
						</span>
						<span class="session-tree__preview">{row.item.preview}</span>
						{#if row.alternatives && !row.expanded}
							<span class="session-tree__badge">
								{row.alternatives === 1 ? '1 hidden branch' : `${row.alternatives} hidden branches`}
							</span>
						{/if}
						{#if row.isLeaf}<span class="session-tree__badge session-tree__badge--current">Current</span>{/if}
						{#if row.onPath && !row.isLeaf}<span class="session-tree__sr-only">On the current branch</span>{/if}
					{/if}
				</div>
			{/each}
		</div>

		<div class="session-tree__detail">
			{#if activeRow?.kind === 'entry'}
				<p class="session-tree__meta">
					<strong>{entryLabel(activeRow.item, agent)}</strong>
					{#if timestamp(activeRow.item.timestamp)}<span>{timestamp(activeRow.item.timestamp)}</span>{/if}
				</p>
				{#if activeRow.item.preview}<p class="session-tree__full">{activeRow.item.preview}</p>{/if}
				{#if branchTarget}
					{#if !branchTarget.onPath}
						<p class="session-tree__hint">
							{agent} can branch only from messages on the current branch.
						</p>
					{:else if branchUnavailable}
						<p class="session-tree__hint">{branchUnavailable}</p>
					{/if}
					<button
						type="button"
						disabled={branching || !branchTarget.onPath || branchUnavailable !== undefined}
						onclick={() => void branch(branchTarget.item.id)}>
						{branching ? 'Branching…' : 'Branch from here'}
					</button>
				{/if}
			{:else if activeRow?.kind === 'run'}
				<p class="session-tree__hint">Press Enter or select the row to show these entries.</p>
			{/if}
			{#if branchError}<p class="session-tree__error" role="alert">{branchError}</p>{/if}
			{#if branchNotice}<p class="session-tree__hint" role="status">{branchNotice}</p>{/if}
		</div>
	{/if}
</section>

<style>
	.session-tree {
		display: grid;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	.session-tree__heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--pau-space-3);
		padding-block: var(--pau-space-3);
		border-bottom: 1px solid var(--pau-border);
	}

	h2 {
		margin: 0;
		font-size: var(--pau-type-xs);
		letter-spacing: 0.04em;
	}

	p {
		margin: 0;
	}

	.session-tree__heading span,
	.session-tree__note,
	.session-tree__hint,
	.session-tree__meta span {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.session-tree__note--truncated {
		padding: var(--pau-space-2);
		border-left: 3px solid var(--pau-info);
		background: var(--pau-surface-raised);
	}

	.session-tree__probe {
		position: absolute;
		height: var(--pau-size-row-sm);
		visibility: hidden;
	}

	.session-tree__viewport {
		position: relative;
		height: min(28rem, 55vh);
		overflow: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-tree__viewport:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.session-tree__row {
		position: absolute;
		inset-inline: 0;
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		box-sizing: border-box;
		height: var(--pau-size-row-sm);
		padding-inline: calc(var(--pau-space-1) + min(var(--depth), 6) * var(--pau-space-3)) var(--pau-space-2);
		border-left: 2px solid transparent;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		white-space: nowrap;
		cursor: pointer;
	}

	.session-tree__row--path {
		border-left-color: var(--pau-accent);
		color: var(--pau-text);
	}

	.session-tree__row[aria-selected='true'] {
		background: var(--pau-surface-raised);
	}

	.session-tree__row:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.session-tree__row--run .session-tree__label {
		font-style: italic;
		font-weight: 400;
	}

	.session-tree__gutter {
		flex: none;
		width: 0.75rem;
		text-align: center;
	}

	.session-tree__label {
		flex: none;
		font-weight: 600;
	}

	.session-tree__label--user {
		color: var(--pau-accent);
	}

	.session-tree__preview {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.session-tree__badge {
		flex: none;
		margin-left: auto;
		padding-inline: var(--pau-space-1);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-tree__badge--current {
		border-color: var(--pau-accent);
		color: var(--pau-accent);
	}

	.session-tree__detail {
		display: grid;
		gap: var(--pau-space-2);
		min-height: 4rem;
	}

	.session-tree__meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--pau-space-2);
		font-size: var(--pau-type-xs);
	}

	.session-tree__full {
		font-size: var(--pau-type-sm);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.session-tree__error {
		display: grid;
		gap: var(--pau-space-2);
		color: var(--pau-danger);
		font-size: var(--pau-type-xs);
	}

	button {
		justify-self: start;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-xs);
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.session-tree__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
