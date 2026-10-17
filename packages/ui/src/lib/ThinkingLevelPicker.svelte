<script lang="ts">
	import { thinkingLevels, type ThinkingLevel } from './types/session';

	type Props = {
		/** Level the session last used. Absent when the agent has not reported one. */
		level?: ThinkingLevel;
		/** Selects a level. A rejection shows its message and keeps the previous level. */
		onSelect: (level: ThinkingLevel) => void | Promise<void>;
		/** Whether the agent can change the thinking level at all. */
		supported?: boolean;
		/** Whether the current model reasons. Absent means the model is not known yet. */
		reasoning?: boolean;
		/** Explains why the control is read-only right now, such as during a run. */
		unavailableReason?: string;
	};

	let { level, onSelect, supported = true, reasoning, unavailableReason }: Props = $props();

	let selectError = $state<string>();
	let pending = $state(false);
	let select = $state<HTMLSelectElement>();

	const explanation = $derived.by(() => {
		if (!supported) return 'This agent does not support changing the thinking level in a session.';
		if (reasoning === false) return 'This model does not offer thinking levels.';
		return unavailableReason;
	});
	const disabled = $derived(explanation !== undefined || pending);

	async function change(next: ThinkingLevel): Promise<void> {
		pending = true;
		selectError = undefined;
		try {
			await onSelect(next);
		} catch (cause) {
			selectError = cause instanceof Error ? cause.message : 'The thinking level could not be changed. Try again.';
			if (select) select.value = level ?? '';
		} finally {
			pending = false;
		}
	}
</script>

<div class="thinking-level">
	<label>
		<span>Thinking</span>
		<select
			bind:this={select}
			aria-label="Thinking level"
			aria-describedby={explanation ? 'thinking-level-note' : undefined}
			title={explanation}
			{disabled}
			value={level ?? ''}
			onchange={(event) => void change(event.currentTarget.value as ThinkingLevel)}>
			{#if level === undefined}<option value="" disabled>Choose a level</option>{/if}
			{#each thinkingLevels as option (option)}
				<option value={option}>{option}</option>
			{/each}
		</select>
	</label>
	{#if explanation}<span id="thinking-level-note" class="thinking-level__hint">{explanation}</span>{/if}
	{#if selectError}<p class="thinking-level__error" role="alert">{selectError}</p>{/if}
</div>

<style>
	.thinking-level {
		position: relative;
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	select {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-sm);
		cursor: pointer;
	}

	select:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	/* Screen readers get the explanation through aria-describedby. Sighted users get the title. */
	.thinking-level__hint {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.thinking-level__error {
		position: absolute;
		top: calc(100% + var(--pau-space-1));
		right: 0;
		z-index: 10;
		width: 16rem;
		max-width: 80vw;
		margin: 0;
		padding: var(--pau-space-2);
		color: var(--pau-danger);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		font-size: var(--pau-type-sm);
	}
</style>
