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

	const levelOptions: SelectOption<ThinkingLevel>[] = thinkingLevels.map((level) => ({
		value: level,
		label: levelLabels[level]
	}));
</script>

<script lang="ts">
	import Select from './Select.svelte';

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

	const explanation = $derived.by(() => {
		if (!supported) return 'This agent does not support changing the thinking level in a session.';
		if (reasoning === false) return 'This model does not offer thinking levels.';
		return unavailableReason;
	});
</script>

<div class="thinking-level">
	<span aria-hidden="true">Thinking</span>
	<Select
		label="Thinking level"
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
		font-size: var(--pau-type-sm);
	}
</style>
