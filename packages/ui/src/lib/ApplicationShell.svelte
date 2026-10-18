<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { IconKind } from '../icons';
	import '../styles/tokens.css';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import Icon from './Icon.svelte';

	/**
	 * One destination in the product or contextual rail.
	 *
	 * An item without `href` cannot be opened. The rail shows it disabled and
	 * explains why with `unavailable`, so a view that does not work yet never
	 * opens as an empty page.
	 */
	export type ShellNavItem = {
		/** Stable identity for keyed rendering and tests. */
		id: string;
		label: string;
		/** Where the item navigates. */
		href?: string;
		/** Why the item cannot be opened. Defaults to "Coming soon". */
		unavailable?: string;
		icon?: IconKind;
		status?: string;
		attention?: boolean;
		active?: boolean;
	};

	type Props = {
		workspaceName: string;
		contextLabel: string;
		productItems: ShellNavItem[];
		contextItems: ShellNavItem[];
		disconnected?: boolean;
		inspectorOpen?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		children?: Snippet;
		context?: Snippet;
		inspector?: Snippet;
	};

	let {
		workspaceName,
		contextLabel,
		productItems,
		contextItems,
		disconnected = false,
		inspectorOpen = true,
		theme = 'eldritch',
		uiFont = 'ibm-plex-sans',
		children,
		context,
		inspector
	}: Props = $props();

	let contextOpen = $state(false);
	let hasContext = $derived(Boolean(context) || contextItems.length > 0);
	let inspectorVisible = $derived(inspectorOpen);
	let shellStyle = $derived(
		Object.entries(themeCssProperties(theme, uiFont))
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);
</script>

<a class="app-shell__skip-link" href="#main-surface">Skip to main surface</a>
<div
	class:app-shell--with-inspector={inspectorVisible && inspector}
	class:app-shell--without-context={!hasContext}
	class="app-shell"
	data-theme={theme}
	data-ui-font={uiFont}
	style={shellStyle}>
	<header class="app-shell__command-bar">
		<div class="app-shell__identity">
			<svg class="app-shell__mark" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
				<path d="M9.5 6.5H41A13.5 13.5 0 0 1 41 33.5H23.5V26.5H41A6.5 6.5 0 0 0 41 13.5H9.5Z" />
				<path d="M23.5 6.5V48A9.5 9.5 0 0 0 33 57.5H38.5V50.5H33A2.5 2.5 0 0 1 30.5 48V6.5Z" />
			</svg>
			<strong>Pau</strong>
			<span>/</span>
			<span>{workspaceName}</span>
		</div>

		<label class="app-shell__command-input">
			<span class="app-shell__search-icon" aria-hidden="true"></span>
			<span class="app-shell__sr-only">Search or run a command</span>
			<input type="search" placeholder="Search or run a command" />
			<kbd>⌘K</kbd>
		</label>
	</header>

	<nav class="app-shell__product-rail" aria-label="Product">
		<ul>
			{#each productItems as item (item.id)}
				<li>
					{#if item.href}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves rail destinations -->
						<a
							href={item.href}
							class:active={item.active}
							aria-current={item.active ? 'page' : undefined}
							aria-label={item.label}
							title={item.label}>
							<Icon name={item.icon ?? 'agents'} size={20} />
							{#if item.attention}<span class="app-shell__attention" role="img" aria-label="Needs attention"></span
								>{/if}
						</a>
					{:else}
						{@const reason = item.unavailable ?? 'Coming soon'}
						<button
							type="button"
							class="app-shell__unavailable"
							class:active={item.active}
							aria-current={item.active ? 'page' : undefined}
							aria-disabled="true"
							aria-label={item.label}
							aria-describedby={`product-${item.id}-unavailable`}
							title={`${item.label}: ${reason}`}>
							<Icon name={item.icon ?? 'agents'} size={20} />
						</button>
						<span id={`product-${item.id}-unavailable`} class="app-shell__sr-only">{reason}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>

	{#if hasContext}
		<aside class:open={contextOpen} class="app-shell__context-rail" aria-label={contextLabel}>
			<div class="app-shell__rail-heading">
				<span>{contextLabel}</span>
				<button type="button" aria-label="Close navigation" onclick={() => (contextOpen = false)}>
					<Icon name="close" size={18} />
				</button>
			</div>
			{#if context}
				<div class="app-shell__context-content">{@render context()}</div>
			{:else}
				<ul>
					{#each contextItems as item (item.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves rail destinations -->
							<a href={item.href} class:active={item.active} aria-current={item.active ? 'page' : undefined}>
								<span class:attention={item.attention} class="app-shell__item-dot"></span>
								<span>{item.label}</span>
								{#if item.status}<small>{item.status}</small>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	{/if}

	<main id="main-surface" class="app-shell__main" tabindex="-1">
		<div class="app-shell__surface-bar">
			{#if hasContext}
				<button
					type="button"
					class="app-shell__icon-button app-shell__context-toggle"
					aria-label="Open navigation"
					aria-expanded={contextOpen}
					onclick={() => (contextOpen = !contextOpen)}>
					<Icon name="sidebar" size={18} />
				</button>
			{/if}
			{#if disconnected}
				<p class="app-shell__connection" role="status"><span></span>Disconnected</p>
			{:else}
				<p class="app-shell__connection app-shell__connection--online"><span></span>Connected</p>
			{/if}
			{#if inspector}
				<button
					type="button"
					class="app-shell__icon-button"
					aria-label={inspectorVisible ? 'Hide inspector' : 'Show inspector'}
					aria-expanded={inspectorVisible}
					onclick={() => (inspectorVisible = !inspectorVisible)}>
					<Icon name="panel" size={18} />
				</button>
			{/if}
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="app-shell__main-content" role="region" aria-label="Main surface content" tabindex="0">
			{#if children}{@render children()}{/if}
		</div>
	</main>

	{#if inspector && inspectorVisible}
		<button
			type="button"
			class="app-shell__backdrop"
			aria-label="Close inspector"
			onclick={() => (inspectorVisible = false)}></button>
		<aside class="app-shell__inspector" aria-label="Inspector">
			<div class="app-shell__rail-heading">
				<span>Inspector</span>
				<button type="button" aria-label="Close inspector" onclick={() => (inspectorVisible = false)}>
					<Icon name="close" size={18} />
				</button>
			</div>
			<div class="app-shell__inspector-content">{@render inspector()}</div>
		</aside>
	{/if}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	.app-shell {
		--shell-bg: var(--pau-canvas);
		--shell-surface: var(--pau-surface);
		--shell-surface-raised: var(--pau-surface-raised);
		--shell-border: var(--pau-border);
		--shell-text: var(--pau-text);
		--shell-muted: var(--pau-text-muted);
		--shell-faint: var(--pau-text-muted);
		--shell-accent: var(--pau-accent);
		--shell-warning: var(--pau-warning);
		--shell-danger: var(--pau-danger);
		--shell-focus: var(--pau-focus);
		display: grid;
		grid-template-areas:
			'command command command'
			'product context main';
		grid-template-columns: var(--pau-size-rail-product) var(--pau-size-rail-context) minmax(0, 1fr);
		grid-template-rows: 2.75rem minmax(0, 1fr);
		min-width: 20rem;
		height: 100dvh;
		overflow: hidden;
		color: var(--shell-text);
		background: var(--shell-bg);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-sm);
		line-height: 1.4;
	}

	.app-shell--with-inspector {
		grid-template-areas:
			'command command command command'
			'product context main inspector';
		grid-template-columns: var(--pau-size-rail-product) var(--pau-size-rail-context) minmax(24rem, 1fr) var(
				--pau-size-rail-inspector
			);
	}

	/* Views without a contextual rail give its column to the main surface. */
	.app-shell--without-context {
		grid-template-areas:
			'command command'
			'product main';
		grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
	}

	.app-shell--without-context.app-shell--with-inspector {
		grid-template-areas:
			'command command command'
			'product main inspector';
		grid-template-columns: var(--pau-size-rail-product) minmax(24rem, 1fr) var(--pau-size-rail-inspector);
	}

	.app-shell__skip-link {
		position: fixed;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 20;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--shell-bg);
		background: var(--shell-focus);
		transform: translateY(-150%);
	}

	.app-shell__skip-link:focus {
		transform: translateY(0);
	}

	.app-shell__command-bar {
		grid-area: command;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
		padding-inline: var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__identity {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 0;
		color: var(--shell-muted);
	}

	.app-shell__identity strong {
		color: var(--shell-text);
	}

	.app-shell__mark {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		padding: var(--pau-space-1);
		color: var(--shell-bg);
		background: var(--shell-accent);
	}

	.app-shell__command-input {
		display: flex;
		align-items: center;
		width: min(23rem, 45vw);
		height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		border: 1px solid var(--shell-border);
		border-radius: var(--pau-radius-control);
		background: var(--shell-surface);
	}

	.app-shell__search-icon {
		width: 0.75rem;
		height: 0.75rem;
		margin-right: var(--pau-space-2);
		border: 1.5px solid var(--shell-muted);
		border-radius: 50%;
	}

	.app-shell__search-icon::after {
		display: block;
		width: 0.35rem;
		margin: var(--pau-space-2) 0 0 var(--pau-space-2);
		border-top: 1.5px solid var(--shell-muted);
		content: '';
		transform: rotate(45deg);
	}

	.app-shell__command-input input {
		min-width: 0;
		flex: 1;
		color: var(--shell-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
	}

	.app-shell__command-input input::placeholder {
		color: var(--shell-muted);
	}

	.app-shell__command-input:focus-within {
		border-color: var(--shell-focus);
		box-shadow: 0 0 0 1px var(--shell-focus);
	}

	.app-shell__command-input kbd {
		color: var(--shell-faint);
		font: inherit;
	}

	.app-shell__product-rail {
		grid-area: product;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__product-rail ul,
	.app-shell__context-rail ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: var(--pau-space-3) 0;
		list-style: none;
	}

	.app-shell__product-rail a,
	.app-shell__product-rail button {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: var(--pau-size-target-touch);
		margin-inline: auto;
		padding: 0;
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		text-decoration: none;
	}

	.app-shell__product-rail a:hover,
	.app-shell__product-rail .active {
		color: var(--shell-accent);
		background: var(--shell-surface-raised);
	}

	.app-shell__product-rail .app-shell__unavailable {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.app-shell__attention {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		width: 0.4rem;
		height: 0.4rem;
		background: var(--shell-warning);
		border-radius: 50%;
	}

	.app-shell__context-rail {
		grid-area: context;
		min-width: 0;
		overflow-y: auto;
		border-right: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__context-content {
		min-width: 0;
	}

	.app-shell__rail-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--pau-size-row-lg);
		padding-inline: var(--pau-space-4) var(--pau-space-2);
		color: var(--shell-muted);
		font-size: var(--pau-type-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.app-shell__rail-heading button {
		display: none;
	}

	.app-shell__context-rail li {
		padding-inline: var(--pau-space-2);
	}

	.app-shell__context-rail a {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-target-touch);
		padding-inline: var(--pau-space-3);
		color: var(--shell-muted);
		text-decoration: none;
	}

	.app-shell__context-rail a:hover,
	.app-shell__context-rail a.active {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	.app-shell__context-rail small {
		color: var(--shell-muted);
	}

	.app-shell__item-dot {
		width: 0.4rem;
		height: 0.4rem;
		background: var(--shell-accent);
		border-radius: 50%;
	}

	.app-shell__item-dot.attention {
		background: var(--shell-warning);
	}

	.app-shell__main {
		grid-area: main;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		overflow: hidden;
		background: var(--shell-surface);
	}

	.app-shell__surface-bar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		height: var(--pau-size-row-lg);
		padding-inline: var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
		background: var(--shell-surface);
	}

	.app-shell__context-toggle {
		display: none;
	}

	.app-shell__icon-button,
	.app-shell__rail-heading button {
		place-items: center;
		width: 2.75rem;
		height: var(--pau-size-target-touch);
		margin-left: auto;
		padding: 0;
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.app-shell__icon-button:hover,
	.app-shell__rail-heading button:hover {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	.app-shell__connection {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		margin: 0;
		color: var(--shell-danger);
		font-size: var(--pau-type-xs);
	}

	.app-shell__connection span {
		width: 0.45rem;
		height: 0.45rem;
		background: currentColor;
		border-radius: 50%;
	}

	.app-shell__connection--online {
		color: var(--shell-accent);
	}

	.app-shell__main-content {
		min-height: 0;
		padding: clamp(var(--pau-space-4), 3vw, var(--pau-space-6));
		overflow: auto;
	}

	.app-shell__inspector {
		grid-area: inspector;
		min-width: 0;
		overflow: auto;
		border-left: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__inspector-content {
		padding: var(--pau-space-2) var(--pau-space-4) var(--pau-space-4);
	}

	.app-shell__backdrop {
		display: none;
	}

	.app-shell__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	:global(.app-shell a:focus-visible),
	:global(.app-shell button:focus-visible),
	:global(.app-shell textarea:focus-visible),
	:global(.app-shell select:focus-visible) {
		outline: 2px solid var(--shell-focus);
		outline-offset: -2px;
	}

	@media (max-width: 74rem) {
		.app-shell,
		.app-shell--with-inspector {
			grid-template-areas:
				'command command command'
				'product context main';
			grid-template-columns: var(--pau-size-rail-product) var(--pau-size-rail-context) minmax(0, 1fr);
		}

		.app-shell--without-context,
		.app-shell--without-context.app-shell--with-inspector {
			grid-template-areas:
				'command command'
				'product main';
			grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
		}

		.app-shell__inspector {
			position: fixed;
			top: 2.75rem;
			right: 0;
			bottom: 0;
			z-index: 5;
			width: min(var(--pau-size-rail-inspector), calc(100vw - var(--pau-size-rail-product)));
			box-shadow: -1rem 0 2rem rgb(0 0 0 / 24%);
		}

		.app-shell__backdrop {
			position: fixed;
			inset: 2.75rem 0 0 0;
			z-index: 4;
			display: block;
			width: auto;
			height: auto;
			padding: 0;
			background: rgb(7 8 15 / 55%);
			border: 0;
		}

		.app-shell__inspector .app-shell__rail-heading button {
			display: grid;
		}
	}

	@media (max-width: 48rem) {
		.app-shell,
		.app-shell--with-inspector {
			grid-template-areas:
				'command command'
				'product main';
			grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
		}

		.app-shell__identity > span:last-child,
		.app-shell__identity > span:nth-last-child(2),
		.app-shell__command-input kbd {
			display: none;
		}

		.app-shell__command-input {
			width: min(20rem, calc(100vw - 8rem));
		}

		.app-shell__context-toggle {
			display: grid;
			margin-left: 0;
		}

		.app-shell__context-rail {
			position: fixed;
			top: 2.75rem;
			bottom: 0;
			left: var(--pau-size-rail-product);
			z-index: 6;
			width: min(var(--pau-size-rail-context), calc(100vw - var(--pau-size-rail-product)));
			box-shadow: 1rem 0 2rem rgb(0 0 0 / 24%);
			transform: translateX(-110%);
			visibility: hidden;
			transition:
				transform 180ms ease,
				visibility 180ms;
		}

		.app-shell__context-rail.open {
			transform: translateX(0);
			visibility: visible;
		}

		.app-shell__context-rail .app-shell__rail-heading button {
			display: grid;
		}
	}

	@media (max-width: 30rem) {
		.app-shell,
		.app-shell--with-inspector,
		.app-shell--without-context,
		.app-shell--without-context.app-shell--with-inspector {
			grid-template-areas:
				'command'
				'main'
				'product';
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 2.75rem minmax(0, 1fr) var(--pau-size-rail-product);
		}

		.app-shell__product-rail {
			border-top: 1px solid var(--shell-border);
			border-right: 0;
		}

		.app-shell__product-rail ul {
			display: flex;
			justify-content: space-around;
			padding: var(--pau-space-1);
		}

		.app-shell__product-rail a,
		.app-shell__product-rail button {
			margin: 0;
		}

		.app-shell__context-rail {
			left: 0;
			bottom: var(--pau-size-rail-product);
			width: min(var(--pau-size-rail-context), 88vw);
		}

		.app-shell__inspector {
			left: 0;
			bottom: var(--pau-size-rail-product);
			width: 100%;
		}

		.app-shell__identity strong {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.app-shell__context-rail {
			transition: none;
		}
	}
</style>
