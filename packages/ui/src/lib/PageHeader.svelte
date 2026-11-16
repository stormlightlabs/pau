<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	import Icon from './Icon.svelte';
	import { getWorkspaceColumn } from './workspace-column';

	/**
	 * The 48px header of the main surface, whose rule lines up with the bay's
	 * and the workspace column's. It holds the view title, an optional state
	 * chip or count centered on the title's capitals, and the view's actions
	 * at the far end. An action that ends something, such as Stop, goes in
	 * `danger`, apart from the others after a rule.
	 *
	 * Inside a shell with a workspace column, a narrow window adds the toggle
	 * that opens the column as an overlay, just before the rule.
	 */
	type Props = {
		title: string;
		/** Id the view's `aria-labelledby` points at. */
		titleId: string;
		/** A state chip or count beside the title. */
		meta?: Snippet;
		actions?: Snippet;
		/** The one action that ends or removes something, set apart after a rule. */
		danger?: Snippet;
		/**
		 * Whether the header cancels the main surface's padding so it runs edge to
		 * edge at the top. A view that already runs edge to edge passes `false`.
		 */
		flush?: boolean;
	};

	let { title, titleId, meta, actions, danger, flush = true }: Props = $props();

	const column = getWorkspaceColumn();
	const toggleShown = $derived(Boolean(column?.available && column.overlay));
</script>

<header class="pau-page-header page-header" class:page-header--flush={flush}>
	<h1 class="pau-page-header__title" id={titleId} {title}>{title}</h1>
	{#if meta}{@render meta()}{/if}
	<span class="pau-page-header__spacer"></span>
	{#if actions || danger || toggleShown}
		<div class="pau-page-header__actions">
			{#if actions}{@render actions()}{/if}
			{#if toggleShown && column}
				<button
					type="button"
					class="pau-button pau-button--quiet pau-button--icon"
					aria-label={`Show ${column.label.toLowerCase()}`}
					title={column.label}
					aria-expanded={column.visible}
					aria-controls="shell-workspace"
					onclick={column.toggle}>
					<Icon name="panel" size={16} />
				</button>
			{/if}
			{#if danger}
				<span class="pau-page-header__rule" role="separator"></span>
				{@render danger()}
			{/if}
		</div>
	{/if}
</header>

<style>
	.page-header {
		min-width: 0;
		font-family: var(--pau-font-ui);
	}

	/*
	 * The header spans the main surface and keeps its title on the content's
	 * leading edge. A view whose sections inset their content sets
	 * `--pau-page-header-inset` to the same step, so the title starts where
	 * the section text starts.
	 */
	.page-header--flush {
		margin: calc(-1 * var(--pau-shell-padding, 0px)) calc(-1 * var(--pau-shell-padding, 0px)) var(--pau-space-5);
		padding-inline: calc(var(--pau-shell-padding, 0px) + var(--pau-page-header-inset, 0px));
	}
</style>
