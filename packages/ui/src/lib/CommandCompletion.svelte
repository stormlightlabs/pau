<script lang="ts">
	import type { CommandOption } from './types/session';

	type Props = {
		/** Id of the listbox, referenced by the composer's `aria-controls`. */
		id: string;
		/** Commands that match the typed name. */
		commands: CommandOption[];
		/** Index of the highlighted command. */
		selected: number;
		onAccept: (command: CommandOption) => void;
	};

	let { id, commands, selected, onAccept }: Props = $props();

	const sourceLabels = { builtin: 'Pi', extension: 'Extension', prompt: 'Prompt', skill: 'Skill' } as const;
</script>

<div class="command-completion">
	{#if commands.length === 0}
		<p class="command-completion__empty">No matching commands</p>
	{:else}
		<ul {id} role="listbox" aria-label="Commands">
			{#each commands as command, index (command.source + command.name)}
				<!-- The composer keeps focus and handles the keyboard. -->
				<li
					id="{id}-option-{index}"
					role="option"
					aria-selected={index === selected}
					aria-disabled={command.unavailable ? 'true' : undefined}
					class:command-completion__option--selected={index === selected}
					class:command-completion__option--unavailable={command.unavailable}
					onmousedown={(event) => {
						event.preventDefault();
						if (!command.unavailable) onAccept(command);
					}}>
					<span class="command-completion__name">
						/{command.name}
						{#if command.argument}<span class="command-completion__argument">{command.argument}</span>{/if}
					</span>
					<span class="command-completion__source">{sourceLabels[command.source]}</span>
					{#if command.unavailable}
						<span class="command-completion__description">Unavailable. {command.unavailable}</span>
					{:else if command.description}
						<span class="command-completion__description">{command.description}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.command-completion {
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
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: baseline;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3);
		cursor: pointer;
	}

	.command-completion__option--selected {
		background: var(--pau-canvas);
		box-shadow: inset 2px 0 0 var(--pau-accent);
	}

	.command-completion__name {
		color: var(--pau-text);
		font-family: var(--pau-font-code);
	}

	.command-completion__argument {
		color: var(--pau-text-muted);
	}

	.command-completion__option--unavailable {
		cursor: default;
	}

	.command-completion__option--unavailable .command-completion__name {
		color: var(--pau-text-muted);
	}

	.command-completion__source {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.command-completion__description {
		overflow: hidden;
		color: var(--pau-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.command-completion__empty {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
	}
</style>
