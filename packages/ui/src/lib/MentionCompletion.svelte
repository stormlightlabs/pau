<script lang="ts">
	import type { FileMention } from './types/session';

	type Props = {
		/** Id of the listbox, referenced by the composer's `aria-controls`. */
		id: string;
		/** Files and folders that match the typed path. */
		files: FileMention[];
		/** Index of the highlighted entry. */
		selected: number;
		/** Whether the last search failed. */
		failed: boolean;
		onAccept: (file: FileMention) => void;
	};

	let { id, files, selected, failed, onAccept }: Props = $props();

	/** Splits a path into the folder part and the name shown first. */
	function parts(file: FileMention): { folder: string; name: string } {
		const trimmed = file.directory ? file.path.slice(0, -1) : file.path;
		const slash = trimmed.lastIndexOf('/');
		return { folder: trimmed.slice(0, slash + 1), name: trimmed.slice(slash + 1) + (file.directory ? '/' : '') };
	}
</script>

<div class="mention-completion">
	{#if failed}
		<p class="mention-completion__empty" role="status">Files could not be searched</p>
	{:else if files.length === 0}
		<p class="mention-completion__empty" role="status">No matching files</p>
	{:else}
		<ul {id} role="listbox" aria-label="Files">
			{#each files as file, index (file.path)}
				{@const { folder, name } = parts(file)}
				<!-- The composer keeps focus and handles the keyboard. -->
				<li
					id="{id}-option-{index}"
					role="option"
					aria-selected={index === selected}
					class:mention-completion__option--selected={index === selected}
					onmousedown={(event) => {
						event.preventDefault();
						onAccept(file);
					}}>
					<span class="mention-completion__name">{name}</span>
					{#if folder}
						<span class="mention-completion__folder">{folder}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.mention-completion {
		max-height: 14rem;
		overflow-y: auto;
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		font-size: var(--pau-type-sm);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: baseline;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3);
		cursor: pointer;
	}

	.mention-completion__option--selected {
		background: var(--pau-canvas);
		box-shadow: inset 2px 0 0 var(--pau-accent);
	}

	.mention-completion__name {
		flex: none;
		color: var(--pau-text);
		font-family: var(--pau-font-code);
	}

	.mention-completion__folder {
		overflow: hidden;
		color: var(--pau-text-muted);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mention-completion__empty {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
	}
</style>
