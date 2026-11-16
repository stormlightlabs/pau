<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import Select from '../lib/Select.svelte';
	import { longText } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The sheet's width, so a story can show a narrow container. */
		width?: string;
	};

	let { width = '40rem' }: Props = $props();
	const id = $props.id();
	let level = $state('high');
	const levels = [
		{ value: 'low', label: 'Low' },
		{ value: 'high', label: 'High' },
		{ value: 'xhigh', label: 'Extra high' }
	];
</script>

<!--
	Text fields, select triggers and choice rows in each state. Controls that
	share a row share a center line, which the measurement test checks.
-->
<div class="fields-demo" style:max-width={width}>
	<section aria-labelledby={`${id}-text`}>
		<h2 id={`${id}-text`} class="pau-section-label">Text fields</h2>
		<div class="fields-demo__row" data-row="field">
			<label class="pau-field fields-demo__grow">
				<Icon name="search" size={16} />
				<input type="search" aria-label="Filter sessions" placeholder="Filter sessions" />
				<kbd><span>/</span></kbd>
			</label>
			<button type="button" class="pau-button pau-button--secondary">Search</button>
		</div>
		<input class="pau-field" aria-label="Workspace path" value="/Users/operator/projects/pau" />
		<input class="pau-field" aria-label="Custom editor command" aria-invalid="true" value="zed --wait {'{line}'}" />
		<input class="pau-field" aria-label="Workspace path, disabled" disabled value="/Users/operator/projects/pau" />
		<input class="pau-field" aria-label="Branch name" value={longText.chip} />
		<input class="pau-field" type="search" aria-label="Search transcript" placeholder="Search this conversation" />
	</section>

	<section aria-labelledby={`${id}-select`}>
		<h2 id={`${id}-select`} class="pau-section-label">Select and picker</h2>
		<div class="fields-demo__row" data-row="select">
			<Select label="Thinking level" options={levels} bind:value={level} />
			<Select label="Thinking level, quiet" variant="quiet" options={levels} value={level} />
			<Select label="Thinking level, disabled" options={levels} value={level} disabled disabledReason="Pi is busy" />
			<span class="pau-chip"><Icon name="gitBranch" size={12} /><span>main</span></span>
		</div>
	</section>

	<section aria-labelledby={`${id}-choice`}>
		<h2 id={`${id}-choice`} class="pau-section-label">Checkbox and radio</h2>
		<div class="fields-demo__row" data-row="choice">
			<label class="pau-choice"><input type="checkbox" checked /><span>Wrap long lines</span></label>
			<label class="pau-choice"><input type="checkbox" /><span>Show hidden files</span></label>
			<label class="pau-choice"><input type="checkbox" disabled /><span>Show ignored files</span></label>
		</div>
		<div class="fields-demo__row" data-row="radio">
			<label class="pau-choice"><input type="radio" name={`${id}-motion`} checked /><span>System</span></label>
			<label class="pau-choice"><input type="radio" name={`${id}-motion`} /><span>Reduce</span></label>
			<label class="pau-choice"><input type="radio" name={`${id}-motion`} disabled /><span>Full</span></label>
		</div>
		<label class="pau-choice pau-choice--multiline fields-demo__multiline">
			<input type="checkbox" checked />
			<span
				>Notify me when a session I am not looking at waits for me, fails, or stops responding, and badge the app icon
				until I open it.</span>
		</label>
	</section>
</div>

<style>
	.fields-demo {
		display: grid;
		gap: var(--pau-space-5);
		padding: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}

	section {
		display: grid;
		gap: var(--pau-space-2);
		min-width: 0;
	}

	h2 {
		margin: 0;
	}

	.fields-demo__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2) var(--pau-space-4);
		min-width: 0;
	}

	.fields-demo__grow {
		flex: 1 1 12rem;
	}

	.fields-demo__multiline {
		max-width: 32rem;
	}
</style>
