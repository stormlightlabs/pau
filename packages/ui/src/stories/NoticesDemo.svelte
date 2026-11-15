<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import { codeSpans } from '../lib/code-spans';
	import { longText, notices } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The main surface's width. */
		width?: string;
	};

	let { width = '48rem' }: Props = $props();
</script>

<!--
	A notice in each tone with its actions, a notice without an icon or
	actions, and the notice slot under a page header.
-->
<div class="notices-demo" style:max-width={width}>
	<section aria-label="Resources header">
		<header class="pau-page-header">
			<h1 class="pau-page-header__title">Resources</h1>
		</header>
	</section>
	<div class="pau-notice-slot">
		<section class="pau-notice pau-notice--warning" aria-labelledby="notices-demo-slot">
			<Icon name="warning" size={16} />
			<div class="pau-notice__text">
				<h2 class="pau-notice__title" id="notices-demo-slot">Discovery warnings</h2>
				<p class="pau-notice__body">Two extensions failed to load. The others are listed below.</p>
			</div>
		</section>
	</div>
	<div class="notices-demo__list">
		{#each notices as notice (notice.tone)}
			<section class={`pau-notice pau-notice--${notice.tone}`} aria-labelledby={`notices-demo-${notice.tone}`}>
				<Icon name={notice.icon} size={16} />
				<div class="pau-notice__text">
					<h2 class="pau-notice__title" id={`notices-demo-${notice.tone}`}>{notice.title}</h2>
					<p class="pau-notice__body">
						{#each codeSpans(notice.body) as span, index (index)}{#if span.code}<code>{span.text}</code
								>{:else}{span.text}{/if}{/each}
					</p>
				</div>
				<div class="pau-notice__actions">
					{#each notice.actions as action (action)}
						<button type="button" class="pau-button pau-button--secondary">{action}</button>
					{/each}
				</div>
			</section>
		{/each}
		<section class="pau-notice" aria-labelledby="notices-demo-plain">
			<div class="pau-notice__text">
				<h2 class="pau-notice__title" id="notices-demo-plain">{longText.title}</h2>
				<p class="pau-notice__body">{longText.label}. {longText.title}.</p>
			</div>
		</section>
	</div>
</div>

<style>
	.notices-demo {
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}

	.notices-demo__list {
		display: grid;
		gap: var(--pau-space-3);
		padding: 0 var(--pau-space-5) var(--pau-space-5);
	}
</style>
