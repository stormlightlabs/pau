<script lang="ts">
	import '../styles/tokens.css';
	import type { MotionSetting } from '../motion';

	type Props = {
		/** The saved setting. */
		value: MotionSetting;
		/** Called when the operator picks a setting. */
		onChange: (value: MotionSetting) => void;
	};

	let { value, onChange }: Props = $props();

	const choices: { value: MotionSetting; label: string; hint: string }[] = [
		{ value: 'system', label: 'System', hint: 'Follow the operating system setting.' },
		{ value: 'reduce', label: 'Reduce', hint: 'Fade instead of sliding or scaling.' },
		{ value: 'full', label: 'Full', hint: 'Always animate, whatever the system says.' }
	];
</script>

<fieldset class="motion-setting">
	<legend>Motion</legend>
	<div class="motion-setting__choices">
		{#each choices as choice (choice.value)}
			<label class="motion-setting__choice pau-choice" title={choice.hint}>
				<input
					type="radio"
					name="motion-setting"
					value={choice.value}
					checked={value === choice.value}
					onchange={() => onChange(choice.value)} />
				<span>{choice.label}</span>
			</label>
		{/each}
	</div>
</fieldset>

<style>
	.motion-setting {
		margin: 0;
		padding: 0;
		border: 0;
		font-size: var(--pau-type-md);
	}

	legend {
		padding: 0;
		margin-block-end: var(--pau-space-2);
		color: var(--pau-text);
	}

	.motion-setting__choices {
		display: flex;
		gap: var(--pau-space-3);
	}

	.motion-setting__choice {
		display: inline-flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		color: var(--pau-text);
		cursor: pointer;
	}
</style>
