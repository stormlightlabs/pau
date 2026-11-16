<script lang="ts">
	import '../styles/tokens.css';
	import {
		KEY_GROUPS,
		formatChord,
		keyActionScope,
		type KeyConflict,
		type KeyPlatform,
		type ResolvedKeyAction
	} from './keymap.svelte';

	type Props = {
		actions: readonly ResolvedKeyAction[];
		platform: KeyPlatform;
		/** Names under each action where its shortcut works, as Settings shows it. */
		showScope?: boolean;
	};

	let { actions, platform, showScope = false }: Props = $props();
	const id = $props.id();

	const groups = $derived(
		[...KEY_GROUPS, ...new Set(actions.map((action) => action.group))]
			.filter((group, index, all) => all.indexOf(group) === index)
			.map((group) => ({ group, actions: actions.filter((action) => action.group === group) }))
			.filter((entry) => entry.actions.length > 0)
	);

	/**
	 * What the Pi actions that use Pau's default chords do, phrased to follow
	 * "Pi uses Ctrl+K to". Other actions show their Pi ID.
	 */
	const PI_ACTION_PURPOSES: Record<string, string> = {
		'tui.editor.cursorLeft': 'move the cursor left',
		'tui.editor.deleteToLineEnd': 'delete to the end of the line',
		'tui.editor.jumpForward': 'jump forward to a character',
		'tui.editor.undo': 'undo an edit',
		'tui.altScreen.previousPrompt': 'jump to the previous prompt',
		'tui.altScreen.nextPrompt': 'jump to the next prompt',
		'app.model.select': 'open the model picker',
		'app.model.cycleBackward': 'switch to the previous model',
		'app.tools.expand': 'show or hide tool output',
		'app.session.toggleNamedFilter': 'show only named sessions'
	};

	/** Says which Pi binding uses a chord, and that an editor binding only applies while typing. */
	function conflictNote(conflict: KeyConflict): string {
		const purpose = PI_ACTION_PURPOSES[conflict.piAction];
		const use = purpose ? `to ${purpose}` : `for ${conflict.piAction}`;
		const where = conflict.scope === 'editor' ? ' while you type' : '';
		return `Pi uses ${formatChord(conflict.keys, platform)} ${use}${where}`;
	}

	function chords(action: ResolvedKeyAction): string[] {
		const formatted = action.keys.map((chord) => formatChord(chord, platform));
		return action.range && formatted.length > 2 ? [formatted[0] ?? '', formatted.at(-1) ?? ''] : formatted;
	}
</script>

<!-- Group headings are h3: both the shortcut dialog and the Keyboard settings section title the list with an h2. -->
<div class={['keyboard-shortcut-list', showScope && 'keyboard-shortcut-list--scoped']}>
	{#each groups as { group, actions: groupActions } (group)}
		<section aria-labelledby={`${id}-${group}`}>
			<h3 id={`${id}-${group}`}>{group}</h3>
			<ul>
				{#each groupActions as action (action.id)}
					{@const keys = chords(action)}
					<li>
						<span class="keyboard-shortcuts__label">
							<span>{action.label}</span>
							{#if showScope}
								<span class="keyboard-shortcuts__scope"
									><span class="pau-visually-hidden">Scope:</span> {keyActionScope(action)}</span>
							{/if}
							{#each action.yielded as conflict (conflict.keys)}
								<small>{conflictNote(conflict)}</small>
							{/each}
						</span>
						<span class="keyboard-shortcuts__keys">
							{#if keys.length === 0}
								<span class="keyboard-shortcuts__none">No shortcut</span>
							{:else}
								{#each keys as key, index (key)}
									{#if index > 0}<span class="keyboard-shortcuts__separator">{action.range ? 'to' : 'or'}</span>{/if}
									<kbd>{key}</kbd>
								{/each}
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.keyboard-shortcut-list {
		display: grid;
		gap: var(--pau-space-4);
	}

	h3,
	ul {
		margin: 0;
	}

	h3 {
		margin-bottom: var(--pau-space-1);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	ul {
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		padding-block: var(--pau-space-1);
		border-bottom: 1px solid var(--pau-border);
	}

	.keyboard-shortcuts__label {
		display: grid;
		min-width: 0;
	}

	/* With a scope line under each name, as in Settings, a row reads as two lines and needs room around them. */
	.keyboard-shortcut-list--scoped li {
		padding-block: var(--pau-space-2);
	}

	.keyboard-shortcut-list--scoped .keyboard-shortcuts__label {
		gap: var(--pau-space-1);
	}

	small {
		color: var(--pau-warning);
		font-size: var(--pau-type-xs);
		overflow-wrap: anywhere;
	}

	.keyboard-shortcuts__keys {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--pau-space-1);
	}

	kbd {
		min-width: 1.5rem;
		padding: 0.0625rem var(--pau-space-1);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-xs);
		text-align: center;
	}

	.keyboard-shortcuts__separator,
	.keyboard-shortcuts__none {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.keyboard-shortcuts__scope {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}
</style>
