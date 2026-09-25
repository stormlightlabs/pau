<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PauMark from './PauMark.svelte';

	let { children } = $props();

	const groups = [
		{
			label: 'V1 screens',
			items: [
				{ href: '/screens/dashboard', label: 'Dashboard', icon: 'i-tabler-home' },
				{ href: '/screens/session', label: 'Session', icon: 'i-tabler-messages' },
				{ href: '/screens/orchestration', label: 'Harness control', icon: 'i-tabler-topology-star-3' },
				{ href: '/screens/scratchpad', label: 'Scratchpad', icon: 'i-tabler-notebook' },
				{ href: '/screens/editor', label: 'Editor & review', icon: 'i-tabler-code' },
				{ href: '/screens/neovim', label: 'Neovim', icon: 'i-simple-icons-neovim' },
				{ href: '/screens/terminal', label: 'Terminal', icon: 'i-tabler-terminal-2' },
				{ href: '/screens/resources', label: 'Resources', icon: 'i-tabler-plug-connected' },
				{ href: '/screens/settings', label: 'Settings', icon: 'i-tabler-adjustments' }
			]
		},
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
			Static fixtures only. Change the copy, states, and layout here before product implementation.
		</p>
	</aside>

	<main class="prototype-main">{@render children()}</main>
</div>
