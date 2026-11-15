<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import { menuItems } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The width the menu sits in. */
		width?: string;
	};

	let { width = '24rem' }: Props = $props();
	let active = $state(0);
</script>

<!--
	The shared menu surface with its rows: icons, a checked row, a hint, a
	key cap, a disabled row with its reason, and a divider. Arrow keys move
	the active row, as the context menu does.
-->
<div class="menus-demo" style:max-width={width}>
	<div
		class="pau-menu"
		role="menu"
		aria-label="README.md actions"
		tabindex="0"
		onkeydown={(event) => {
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : menuItems.length - 1)) % menuItems.length;
		}}>
		{#each menuItems as item, index (item.label)}
			{#if index === 3}<div class="pau-menu__divider" role="separator"></div>{/if}
			<button
				type="button"
				role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
				aria-checked={item.checked}
				aria-disabled={item.disabled || undefined}
				tabindex="-1"
				class="pau-menu__item pau-option"
				class:pau-option--active={index === active}>
				{#if item.icon}<Icon name={item.icon} size={16} />{/if}
				<span>{item.label}</span>
				{#if item.keys}<kbd><span>{item.keys}</span></kbd>{:else if item.hint}<span class="pau-menu__hint"
						>{item.hint}</span
					>{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.menus-demo {
		padding: var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		background: var(--pau-canvas);
	}
</style>
