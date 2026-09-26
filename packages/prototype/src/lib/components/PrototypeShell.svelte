<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PauMark from './PauMark.svelte';

	let { children } = $props();
	let mainElement: HTMLElement;

	$effect(() => {
		page.url.pathname;
		mainElement?.scrollTo({ top: 0 });
	});

	const groups = [
		{
			label: 'Product surfaces',
			items: [
				{ href: '/screens/dashboard', label: 'Dashboard', icon: 'i-tabler-home' },
				{ href: '/screens/session', label: 'Session', icon: 'i-tabler-messages' },
				{ href: '/screens/orchestration', label: 'Harness control', icon: 'i-tabler-topology-star-3' },
				{ href: '/screens/scratchpad', label: 'Scratchpad', icon: 'i-tabler-notebook' },
				{ href: '/screens/editor', label: 'Editor & review', icon: 'i-tabler-code' },
				{ href: '/screens/neovim', label: 'Embedded editor study', icon: 'i-simple-icons-neovim' },
				{ href: '/screens/terminal', label: 'Terminal', icon: 'i-tabler-terminal-2' },
				{ href: '/screens/resources', label: 'Resources', icon: 'i-tabler-plug-connected' },
				{ href: '/screens/settings', label: 'Settings', icon: 'i-tabler-adjustments' }
			]
		},
		{ label: 'Public site', items: [{ href: '/docs', label: 'Docs & marketing', icon: 'i-tabler-book-2' }] },
		{
			label: 'Splash states',
			items: [
				{ href: '/splash/launch', label: 'Launch', icon: 'i-tabler-rocket' },
				{ href: '/splash/reconnect', label: 'Reconnect', icon: 'i-tabler-refresh' }
			]
		}
	] as const;
</script>

<div class="prototype-shell">
	<aside class="prototype-nav" aria-label="Prototype screens">
		<a class="prototype-brand" href={resolve('/')}>
			<span class="prototype-brand__mark"><PauMark /></span>
			<span class="prototype-brand__copy">
				<span class="prototype-brand__title"
					><strong>Pau</strong><span class="prototype-brand__badge">Prototype</span></span>
				<span class="prototype-brand__subtitle">Living design sandbox</span>
			</span>
		</a>

		<div class="prototype-nav__groups">
			{#each groups as group (group.label)}
				<div class="prototype-nav__group">
					<div class="prototype-nav__label">{group.label}</div>
					{#each group.items as item (item.href)}
						<a
							class="prototype-nav__link"
							href={resolve(item.href)}
							aria-current={page.url.pathname === resolve(item.href) ? 'page' : undefined}>
							<span class={item.icon} aria-hidden="true"></span>
							<span>{item.label}</span>
						</a>
					{/each}
				</div>
			{/each}
		</div>

		<p class="prototype-nav__footer">
			Fixtures test the decisions recorded in <code>dev/design</code> before they move into product code.
		</p>
	</aside>

	<main class="prototype-main" bind:this={mainElement}>
		{#key page.url.pathname}
			<div class="prototype-main__view">{@render children()}</div>
		{/key}
	</main>
</div>
