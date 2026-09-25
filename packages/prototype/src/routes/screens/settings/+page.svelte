<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const themes = [
		{ id: 'eldritch', name: 'Eldritch', colors: ['#38ef9d', '#43c7e8', '#f5bf69', '#ee7180'] },
		{ id: 'nord', name: 'Nord', colors: ['#88c0d0', '#81a1c1', '#ebcb8b', '#bf616a'] },
		{ id: 'iceberg', name: 'Iceberg', colors: ['#84a0c6', '#89b8c2', '#b4be82', '#e27878'] },
		{ id: 'catppuccin', name: 'Catppuccin Mocha', colors: ['#cba6f7', '#89dceb', '#a6e3a1', '#f38ba8'] },
		{ id: 'vitesse', name: 'Vitesse Dark', colors: ['#4d9375', '#5da994', '#e6cc77', '#cb7676'] }
	];
	let theme = $state('iceberg');
	let applyToNeovim = $state(false);
	let loadInit = $state(false);
	let font = $state('IBM Plex Sans');
</script>

<PrototypePage
	section="V1 screen · 07"
	title="Settings"
	note="Theme and editor choices show their scope directly. Loading the user’s Neovim configuration remains separate from applying Pau’s colors because the two actions carry different risks.">
	<div
		data-theme={theme}
		style:--font-ui={font === 'Inter'
			? "'Inter Variable', system-ui"
			: font === 'Atkinson Hyperlegible Next'
				? "'Atkinson Hyperlegible Next Variable', system-ui"
				: "'IBM Plex Sans Variable', system-ui"}>
		<MockApp context="settings / appearance">
			<div class="mock-layout grid-cols-[3.5rem_14rem_minmax(0,1fr)]!">
				<ProductRail active="settings" />

				<aside class="mock-context-rail" aria-label="Settings sections">
					<p class="mock-section-label">Settings</p>
					<div class="mock-list">
						<button type="button" aria-pressed="true"
							><span class="i-tabler-palette"></span><span>Appearance</span></button>
						<button type="button"><span class="i-tabler-robot"></span><span>Agents</span></button>
						<button type="button"><span class="i-tabler-code"></span><span>Neovim</span></button>
						<button type="button"><span class="i-tabler-keyboard"></span><span>Keybindings</span></button>
						<button type="button"><span class="i-tabler-bell"></span><span>Notifications</span></button>
					</div>
				</aside>

				<section class="mock-main overflow-auto p-6" aria-label="Appearance settings">
					<div class="mx-auto max-w-5xl">
						<h2 class="mb-4 mt-0 text-lg font-600">Theme</h2>
						<div class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
							{#each themes as item (item.id)}
								<button
									class="border bg-surface-raised p-3 text-left"
									class:border-accent={theme === item.id}
									class:border-line={theme !== item.id}
									type="button"
									aria-pressed={theme === item.id}
									onclick={() => (theme = item.id)}>
									<div class="mb-5 mock-code text-xs leading-5">
										<span class="text-muted">const</span> rows =
										<span style:color={item.colors[0]}>gutter</span>(42)<br /><span style:color={item.colors[1]}
											>type</span>
										Hunk = <span style:color={item.colors[2]}>"ok"</span>
									</div>
									<div class="mb-2 flex gap-1">
										{#each item.colors as color (color)}<span class="h-1.5 flex-1" style:background={color}></span
											>{/each}
									</div>
									<span class="text-xs">{item.name}</span>
								</button>
							{/each}
						</div>

						<div class="mt-7 max-w-3xl border-y border-line">
							<label class="flex min-h-12 items-center justify-between gap-4 border-b border-line text-sm">
								<span>Apply theme to Neovim</span><input
									class="accent-[var(--color-accent)]"
									type="checkbox"
									bind:checked={applyToNeovim} />
							</label>
							<label class="flex min-h-12 items-center justify-between gap-4 border-b border-line text-sm">
								<span>Load my init.lua</span><input
									class="accent-[var(--color-accent)]"
									type="checkbox"
									bind:checked={loadInit} />
							</label>
							<label class="flex min-h-12 items-center justify-between gap-4 text-sm">
								<span>Interface font</span>
								<select
									class="border border-line bg-canvas px-2 py-1 text-sm"
									bind:value={font}
									aria-label="Interface font">
									<option>IBM Plex Sans</option><option>Inter</option><option>Atkinson Hyperlegible Next</option>
								</select>
							</label>
						</div>

						<div class="mt-10 flex items-center justify-between">
							<div>
								<h2 class="m-0 text-lg font-600">Agents</h2>
								<p class="mt-1 text-xs text-muted">Detected from your current environment.</p>
							</div>
							<button class="app-button" type="button"><span class="i-tabler-refresh"></span>Scan again</button>
						</div>
						<div class="mt-3 divide-y divide-line border-y border-line mock-code text-xs">
							{#each [['Pi', '~/.local/bin/pi', 'ready'], ['Claude Code', '/usr/local/bin/claude', 'ready'], ['Codex', '~/.cargo/bin/codex', 'not found']] as agent (agent[0])}
								<div class="grid min-h-12 grid-cols-[1fr_2fr_auto] items-center gap-4">
									<span>{agent[0]}</span><span class="text-muted">{agent[1]}</span><span
										class={agent[2] === 'ready' ? 'text-positive' : 'text-muted'}>{agent[2]}</span>
								</div>
							{/each}
						</div>
					</div>
				</section>
			</div>
		</MockApp>
	</div>
</PrototypePage>
