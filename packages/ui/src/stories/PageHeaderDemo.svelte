<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import SessionStatusMark from '../lib/SessionStatusMark.svelte';
	import { longText } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The main surface's width. */
		width?: string;
	};

	let { width = '60rem' }: Props = $props();
</script>

<!--
	The page header in three states: a running session with its actions and
	the isolated Stop, a waiting session with a long title, and a view with
	no state and one action.
-->
<div class="page-header-demo" style:max-width={width}>
	<section aria-label="Running header">
		<header class="pau-page-header" data-header="running">
			<h1 class="pau-page-header__title">Audit log shutdown drain</h1>
			<span class="pau-state pau-tone-info"
				><SessionStatusMark status="running" label="Running" /><span aria-hidden="true">Running</span></span>
			<span class="pau-page-header__spacer"></span>
			<div class="pau-page-header__actions">
				<button type="button" class="pau-button pau-button--quiet"
					><Icon name="terminal" size={16} /><span>Terminal</span></button>
				<button type="button" class="pau-button pau-button--quiet"><span>Compact</span></button>
				<button type="button" class="pau-button pau-button--quiet pau-button--icon" aria-label="Show workspace"
					><Icon name="panel" size={16} /></button>
				<span class="pau-page-header__rule" role="separator"></span>
				<button type="button" class="pau-button pau-button--danger">Stop</button>
			</div>
		</header>
	</section>

	<section aria-label="Long header">
		<header class="pau-page-header" data-header="long">
			<h1 class="pau-page-header__title" title={longText.title}>{longText.title}</h1>
			<span class="pau-state pau-tone-waiting"
				><SessionStatusMark status="waiting" label="Waiting for you" /><span aria-hidden="true">Waiting for you</span
				></span>
			<span class="pau-page-header__spacer"></span>
			<div class="pau-page-header__actions">
				<button type="button" class="pau-button pau-button--quiet"><span>Export</span></button>
				<span class="pau-page-header__rule" role="separator"></span>
				<button type="button" class="pau-button pau-button--danger" disabled>Stop</button>
			</div>
		</header>
	</section>

	<section aria-label="View header">
		<header class="pau-page-header" data-header="view">
			<h1 class="pau-page-header__title">Settings</h1>
			<span class="pau-count">8 sections</span>
			<span class="pau-page-header__spacer"></span>
			<div class="pau-page-header__actions">
				<button type="button" class="pau-button pau-button--secondary">Reset to defaults</button>
			</div>
		</header>
	</section>
</div>

<style>
	.page-header-demo {
		display: grid;
		gap: var(--pau-space-5);
		padding-block: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}

	.page-header-demo > section {
		min-width: 0;
	}
</style>
