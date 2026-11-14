<script module lang="ts">
	import type { SelectOption } from './Select.svelte';
	import { thinkingLevels, type ThinkingLevel } from './types/session';

	/** Display names for Pi's thinking levels. Pi still receives the raw values. */
	const levelLabels: Record<ThinkingLevel, string> = {
		off: 'Off',
		minimal: 'Minimal',
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		xhigh: 'Extra high',
		max: 'Max'
	};
</script>

<script lang="ts">
	import Select from './Select.svelte';

	type Props = {
		/** Level the session last used. Absent when the agent has not reported one. */
		level?: ThinkingLevel;
		/** Selects a level. A rejection shows its message and keeps the previous level. */
		onSelect: (level: ThinkingLevel) => void | Promise<void>;
		/** Whether the current model reasons. Absent means the model is not known yet. */
		reasoning?: boolean;
		/**
		 * Levels the current model offers, in Pi's order. Absent until Pi
		 * reports them, which offers every level.
		 */
		levels?: readonly ThinkingLevel[];
		/** Explains why the control is read-only right now, such as during a run. */
		unavailableReason?: string;
	};

	let { level, onSelect, reasoning, levels = thinkingLevels, unavailableReason }: Props = $props();

	/**
	 * The model's levels. A current level the model does not offer stays
	 * listed, disabled, so the control shows what Pi reports instead of
	 * changing it.
	 */
	const levelOptions = $derived<SelectOption<ThinkingLevel>[]>(
		thinkingLevels
			.filter((candidate) => levels.includes(candidate) || candidate === level)
			.map((candidate) => ({
				value: candidate,
				label: levelLabels[candidate],
				disabled: !levels.includes(candidate),
				disabledReason: levels.includes(candidate) ? undefined : 'This model does not offer this level.'
			}))
	);

	const explanation = $derived.by(() => {
		// Pi reports only `off` for a model without reasoning.
		if (reasoning === false || levels.every((candidate) => candidate === 'off')) {
			return 'This model does not offer thinking levels.';
		}
		return unavailableReason;
	});

	let root = $state<HTMLDivElement>();

	/**
	 * Focuses the level list's button, as `/thinking` without a level does.
	 *
	 * @returns Whether it took focus. A disabled list does not.
	 */
	export function show(): boolean {
		const trigger = root?.querySelector<HTMLButtonElement>('button');
		if (!trigger || trigger.disabled) return false;
		trigger.focus();
		return true;
	}
</script>

<div class="thinking-level" bind:this={root}>
	<span aria-hidden="true">Thinking</span>
	<!-- The picker sits in the composer footer, so its list and errors open upward over the transcript. -->
	<Select
		label="Thinking level"
		variant="quiet"
		opens="above"
		options={levelOptions}
		value={level}
		placeholder="Choose a level"
		disabled={explanation !== undefined}
		disabledReason={explanation}
		errorFallback="The thinking level could not be changed. Try again."
		onChange={async (next) => await onSelect(next)} />
</div>

<style>
	.thinking-level {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		color: var(--pau-text-muted);
	}
</style>
