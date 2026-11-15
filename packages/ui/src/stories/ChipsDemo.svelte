<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import SessionStatusMark from '../lib/SessionStatusMark.svelte';
	import { longText, markStates } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The sheet's width, so a story can show a narrow container. */
		width?: string;
	};

	let { width = '40rem' }: Props = $props();
	const id = $props.id();
</script>

<!--
	Status marks with their state labels, neutral chips and key caps. Each
	mark pairs its shape with a text label.
-->
<div class="chips-demo" style:max-width={width}>
	<section aria-labelledby={`${id}-marks`}>
		<h2 id={`${id}-marks`} class="pau-section-label">Status marks</h2>
		<ul class="chips-demo__marks">
			{#each markStates as state (state.status)}
				<li class="chips-demo__row" data-status={state.status}>
					<span class={`pau-state ${state.tone ? `pau-tone-${state.tone}` : ''}`}
						><SessionStatusMark status={state.status} label={state.label} /><span aria-hidden="true">{state.label}</span
						></span>
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby={`${id}-chips`}>
		<h2 id={`${id}-chips`} class="pau-section-label">Chips</h2>
		<div class="chips-demo__row" data-row="chips">
			<span class="pau-chip"><Icon name="gitBranch" size={12} /><span>main</span></span>
			<span class="pau-chip"><Icon name="sandbox" size={12} /><span>Workspace sandbox</span></span>
			<span class="pau-chip"><span>All workspaces</span></span>
			<span class="pau-chip chips-demo__long"><Icon name="gitBranch" size={12} /><span>{longText.chip}</span></span>
		</div>
	</section>

	<section aria-labelledby={`${id}-keys`}>
		<h2 id={`${id}-keys`} class="pau-section-label">Key caps</h2>
		<div class="chips-demo__row" data-row="keys">
			<span class="chips-demo__key"
				><kbd class="pau-kbd"><span>⌘</span></kbd><kbd class="pau-kbd"><span>K</span></kbd></span>
			<span class="pau-cap">Command palette</span>
			<span class="pau-count">12</span>
		</div>
	</section>
</div>

<style>
	.chips-demo {
		display: grid;
		gap: var(--pau-space-5);
		padding: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-surface);
	}

	section {
		display: grid;
		gap: var(--pau-space-2);
		min-width: 0;
	}

	h2 {
		margin: 0;
	}

	.chips-demo__marks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: var(--pau-space-3) var(--pau-space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chips-demo__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 0;
	}

	.chips-demo__long {
		max-width: 16rem;
	}

	.chips-demo__key {
		display: inline-flex;
		gap: var(--pau-space-1);
	}
</style>
