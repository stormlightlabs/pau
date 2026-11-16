<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import SessionStatusMark from '../lib/SessionStatusMark.svelte';
	import { baySections, markStates, rowStrips } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The bay's width: 344px wide, 288px narrow. */
		width?: string;
		/** The strip shown as the open session. */
		currentId?: string;
	};

	let { width = 'var(--pau-size-bay)', currentId = 'sandbox' }: Props = $props();
	const id = $props.id();
	const tone = (status: string) => markStates.find((state) => state.status === status)?.tone;
</script>

<!--
	A bay at real volume: three sections under their headings, the open
	session selected, then one-line row strips for changed files.
-->
<nav class="strips-demo" style:width aria-label="Sessions">
	{#each baySections as section, index (section.label)}
		<section aria-labelledby={`${id}-${index}`}>
			<h2 class="pau-bay-heading" class:pau-bay-heading--attention={section.attention}>
				<span class="pau-section-label" id={`${id}-${index}`}>{section.label}</span><span class="pau-count"
					>{section.strips.length}</span>
			</h2>
			<ul class="strips-demo__list" class:strips-demo__list--attention={section.attention}>
				{#each section.strips as strip (strip.id)}
					{@const stateTone = tone(strip.status)}
					<li>
						<a
							class="pau-strip"
							class:pau-strip--settled={section.settled}
							href={`#${strip.id}`}
							aria-current={strip.id === currentId ? 'page' : undefined}>
							<SessionStatusMark status={strip.status} label={strip.state} />
							<span class="pau-strip__line"
								><span class="pau-strip__name">{strip.name}</span><span class="pau-strip__agent">{strip.agent}</span
								></span>
							<span class="pau-strip__meta pau-mono">{strip.workspace}</span>
							<span></span>
							<span
								class={['pau-strip__state', stateTone && `pau-tone-${stateTone}`]}
								class:pau-mono={strip.status === 'running'}>{strip.state}</span>
							<span class="pau-strip__figure pau-mono">{strip.age}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<section aria-labelledby={`${id}-changes`}>
		<h2 class="pau-bay-heading">
			<span class="pau-section-label" id={`${id}-changes`}>Changes</span><span class="pau-count"
				>{rowStrips.length}</span>
		</h2>
		<ul class="strips-demo__list">
			{#each rowStrips as row, index (row.id)}
				<li>
					<button
						type="button"
						class="pau-strip pau-strip--row"
						aria-current={index === 0 ? 'true' : undefined}
						aria-disabled={index === rowStrips.length - 1 ? 'true' : undefined}>
						<Icon name={row.icon} size={16} />
						<span class="pau-strip__name" class:pau-mono={row.mono}>{row.name}</span>
						<span class="pau-strip__meta pau-mono">{row.meta}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
</nav>

<style>
	.strips-demo {
		max-width: 100%;
		padding-bottom: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-surface);
	}

	.strips-demo__list {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.strips-demo__list > li {
		display: grid;
		min-width: 0;
	}

	/* Needs you strips sit one step lifted, separated by rules in the bay color. */
	.strips-demo__list--attention > li {
		background: var(--pau-surface-raised);
	}

	.strips-demo__list--attention > li + li {
		border-top: 1px solid var(--pau-surface);
	}
</style>
