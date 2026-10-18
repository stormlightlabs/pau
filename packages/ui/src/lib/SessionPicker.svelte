<script lang="ts">
	import { formatRelativeTime } from './relative-time';
	import type { SavedSessionList } from './types/session';

	type Props = {
		workspaceName: string;
		/** Loads the workspace's saved sessions. A rejection shows its message. */
		load: () => Promise<SavedSessionList>;
		/** Starts a new session. A rejection shows its message. */
		onNew: () => void | Promise<void>;
		/** Opens a saved session, resuming it unless it is already running. A rejection shows its message. */
		onResume: (savedSessionId: string) => void | Promise<void>;
		onClose?: () => void;
		disabled?: boolean;
		/** Reference time for relative dates. Tests set it for stable output. */
		now?: Date;
	};

	let { workspaceName, load, onNew, onResume, onClose, disabled = false, now = new Date() }: Props = $props();

	let list = $state<SavedSessionList>();
	let loadError = $state<string>();
	let actionError = $state<string>();
	let busyId = $state<string>();

	async function fetchList(): Promise<void> {
		list = undefined;
		loadError = undefined;
		try {
			list = await load();
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Pau could not list saved sessions.';
		}
	}

	async function run(id: string, action: () => void | Promise<void>): Promise<void> {
		if (busyId) return;
		busyId = id;
		actionError = undefined;
		try {
			await action();
		} catch (cause) {
			actionError = cause instanceof Error ? cause.message : 'Try again, or open Diagnostics for details.';
		} finally {
			busyId = undefined;
		}
	}

	// The picker mounts each time it opens, so one load per mount is enough.
	$effect(() => {
		void fetchList();
	});
</script>

<section class="session-picker" aria-labelledby="session-picker-title">
	<header>
		<h1 id="session-picker-title">Sessions in {workspaceName}</h1>
		<div>
			<button type="button" disabled={disabled || busyId !== undefined} onclick={() => run('new', onNew)}>
				{busyId === 'new' ? 'Starting…' : 'New session'}
			</button>
			{#if onClose}<button type="button" onclick={onClose}>Close</button>{/if}
		</div>
	</header>

	{#if actionError}
		<p class="session-picker__error" role="alert">{actionError}</p>
	{/if}

	{#if loadError}
		<div role="alert">
			<p class="session-picker__error">{loadError}</p>
			<button type="button" onclick={() => void fetchList()}>Try again</button>
		</div>
	{:else if !list}
		<p class="session-picker__note" role="status">Loading saved sessions…</p>
	{:else if list.sessions.length === 0}
		<p class="session-picker__note">No saved Pi sessions in this workspace yet. Start a new session to begin one.</p>
	{:else}
		<ul class="session-picker__list" aria-label="Saved sessions">
			{#each list.sessions as saved (saved.id)}
				<li>
					<div>
						<strong>{saved.title}</strong>
						{#if saved.live}
							<small>Running</small>
						{:else if formatRelativeTime(saved.modifiedAt, now)}
							<small>Modified {formatRelativeTime(saved.modifiedAt, now)}</small>
						{/if}
					</div>
					<button
						type="button"
						aria-label={`${saved.live ? 'Open' : 'Resume'} ${saved.title}`}
						disabled={disabled || busyId !== undefined}
						onclick={() => run(saved.id, () => onResume(saved.id))}>
						{#if saved.live}
							{busyId === saved.id ? 'Opening…' : 'Open'}
						{:else}
							{busyId === saved.id ? 'Resuming…' : 'Resume'}
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if list && list.warnings.length > 0}
		<details class="session-picker__warnings">
			<summary>
				{list.warnings.length === 1 ? '1 file was skipped' : `${list.warnings.length} files were skipped`}
			</summary>
			<ul>
				{#each list.warnings as warning (warning.path)}
					<li><code>{warning.path}</code> {warning.message}</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.session-picker {
		grid-area: transcript;
		width: min(100%, 44rem);
		margin: 0 auto;
		padding: var(--pau-space-5) var(--pau-space-4);
		overflow-y: auto;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		flex-wrap: wrap;
	}

	header div {
		display: flex;
		gap: var(--pau-space-2);
	}

	h1 {
		margin: 0;
		font-size: var(--pau-type-lg);
	}

	button {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	button:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.session-picker__list {
		display: grid;
		gap: var(--pau-space-1);
		margin: var(--pau-space-4) 0 0;
		padding: 0;
		list-style: none;
	}

	.session-picker__list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		padding: var(--pau-space-2) var(--pau-space-3);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-picker__list div {
		display: grid;
		min-width: 0;
	}

	strong {
		overflow: hidden;
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-semibold);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	small,
	.session-picker__warnings {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.session-picker__note,
	.session-picker__error {
		margin: var(--pau-space-4) 0 0;
		font-size: var(--pau-type-md);
		line-height: 1.55;
	}

	.session-picker__note {
		color: var(--pau-text-muted);
	}

	.session-picker__error {
		color: var(--pau-danger);
	}

	.session-picker__warnings {
		margin-top: var(--pau-space-4);
	}

	.session-picker__warnings ul {
		margin: var(--pau-space-2) 0 0;
		padding-left: var(--pau-space-4);
		overflow-wrap: anywhere;
	}
</style>
