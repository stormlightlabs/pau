<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import { featureDemos, type FeatureKey } from './docs-data';

	let { activeFeature }: { activeFeature: FeatureKey } = $props();
	let activeSession = $state<'search' | 'mcp'>('search');
	let sessionSteered = $state(false);
	let selectedFile = $state<'page' | 'design'>('page');
	let mcpEnabled = $state(true);
	let mcpTested = $state(false);
</script>

<div
	class="product-preview min-w-0 self-center border border-site-code-line bg-site-code text-site-code-ink shadow-[0_24px_60px_color-mix(in_srgb,var(--site-ink)_18%,transparent)]">
	<div
		class="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-site-code-line px-3.5 font-sitecode text-[0.68rem] max-md:grid-cols-[1fr_auto]">
		<span class="flex items-center gap-1.5"><span class="size-4"><PauMark /></span> pau-desktop</span>
		<span class="op-65 max-md:hidden">Example workspace</span>
		<span class="flex justify-end gap-1" aria-hidden="true"
			><i class="size-1.75 rounded-full bg-site-highlight"></i><i class="size-1.75 rounded-full bg-site-code-line"></i
			><i class="size-1.75 rounded-full bg-site-code-line"></i></span>
	</div>

	<div class="grid min-h-96 grid-cols-[3rem_minmax(0,1fr)] max-md:min-h-92 max-md:grid-cols-[2.5rem_minmax(0,1fr)]">
		<div class="flex flex-col items-center gap-5 border-r border-site-code-line pt-5 op-55" aria-hidden="true">
			<span class="i-tabler-layout-dashboard"></span>
			<span class="i-tabler-messages text-site-highlight"></span>
			<span class="i-tabler-files"></span>
			<span class="i-tabler-plug-connected"></span>
		</div>

		<div class="min-w-0 p-[clamp(1.25rem,4vw,2rem)] max-md:p-4">
			<div class="flex items-start justify-between gap-4 max-md:grid">
				<div class="grid gap-1">
					<small class="font-sitecode text-[0.65rem] op-60">{featureDemos[activeFeature].label}</small>
					<strong class="font-heading text-[1.15rem]">{featureDemos[activeFeature].title}</strong>
				</div>
				<span class="font-sitecode text-[0.65rem] op-60">{featureDemos[activeFeature].meta}</span>
			</div>
			<p class="mb-6 mt-3 max-w-[56ch] text-[0.82rem] leading-6 op-70">{featureDemos[activeFeature].description}</p>

			{#key activeFeature}
				<div class="preview-demo min-h-48 border-t border-site-code-line">
					{#if activeFeature === 'sessions'}
						<div class="grid min-h-48 grid-cols-[minmax(8rem,0.72fr)_minmax(0,1.28fr)] max-md:grid-cols-1">
							<div
								class="grid content-start border-r border-site-code-line py-2 max-md:grid-cols-2 max-md:border-b max-md:border-r-0"
								aria-label="Example sessions">
								<button
									class="preview-select grid min-h-13 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 border-0 border-l-2 border-transparent bg-transparent px-2.5 py-2 text-left text-site-code-ink op-65 aria-pressed:border-l-site-highlight aria-pressed:bg-white/5 aria-pressed:op-100"
									type="button"
									aria-pressed={activeSession === 'search'}
									onclick={() => {
										activeSession = 'search';
										sessionSteered = false;
									}}>
									<span class="i-tabler-sparkles" aria-hidden="true"></span>
									<span class="grid min-w-0"
										><strong class="text-[0.72rem]">Improve file search</strong><small
											class="font-sitecode text-[0.58rem] op-55">Pi · running</small
										></span>
								</button>
								<button
									class="preview-select grid min-h-13 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 border-0 border-l-2 border-transparent bg-transparent px-2.5 py-2 text-left text-site-code-ink op-65 aria-pressed:border-l-site-highlight aria-pressed:bg-white/5 aria-pressed:op-100"
									type="button"
									aria-pressed={activeSession === 'mcp'}
									onclick={() => {
										activeSession = 'mcp';
										sessionSteered = false;
									}}>
									<span class="i-simple-icons-anthropic" aria-hidden="true"></span>
									<span class="grid min-w-0"
										><strong class="text-[0.72rem]">Review MCP diagnostics</strong><small
											class="font-sitecode text-[0.58rem] op-55">Claude · waiting</small
										></span>
								</button>
							</div>
							<div class="flex min-w-0 flex-col p-3.5">
								{#if activeSession === 'search'}
									<p class="m-0 text-[0.7rem] leading-5">
										<span class="mb-1 block font-sitecode text-[0.58rem] text-site-highlight">Pi</span>The tree now
										keeps keyboard focus when search results refresh.
									</p>
									<div
										class="mt-3 w-fit border-l-2 border-[#7ad9a8] bg-[#7ad9a8]/10 px-2 py-1.5 font-sitecode text-[0.58rem] text-[#7ad9a8]">
										<span class="i-tabler-file-diff"></span> 3 files changed
									</div>
								{:else}
									<p class="m-0 text-[0.7rem] leading-5">
										<span class="mb-1 block font-sitecode text-[0.58rem] text-site-highlight">Claude</span>The OAuth
										token stays with the native client. Should I add the failure-state test?
									</p>
									<div
										class="mt-3 w-fit border-l-2 border-site-highlight bg-site-highlight/10 px-2 py-1.5 font-sitecode text-[0.58rem] text-site-highlight">
										<span class="i-tabler-message-question"></span> Waiting for direction
									</div>
								{/if}
								<div
									class="mt-auto flex min-h-9.5 items-center justify-between gap-2 border border-site-code-line pl-2.5 text-[0.62rem] op-70">
									<span>{sessionSteered ? 'Direction queued for this turn' : 'Add direction…'}</span>
									<button
										class="min-w-15 self-stretch border-0 bg-site-highlight text-[0.62rem] font-700 text-[#17332d]"
										type="button"
										onclick={() => (sessionSteered = !sessionSteered)}>{sessionSteered ? 'Undo' : 'Steer'}</button>
								</div>
							</div>
						</div>
					{:else if activeFeature === 'files'}
						<div class="grid min-h-48 grid-cols-[minmax(8rem,0.72fr)_minmax(0,1.28fr)] max-md:grid-cols-1">
							<div
								class="border-r border-site-code-line py-2 max-md:border-b max-md:border-r-0"
								aria-label="Changed files">
								<p class="mb-2 mt-0 border-b border-site-code-line px-3 pb-2 font-sitecode text-[0.58rem] op-55">
									<span class="i-octicon-git-branch-16"></span> feature/docs-site
								</p>
								<button
									class="preview-select grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-0 border-l-2 border-transparent bg-transparent px-3 text-left text-[0.72rem] text-site-code-ink op-65 aria-pressed:border-l-site-highlight aria-pressed:bg-white/5 aria-pressed:op-100"
									type="button"
									aria-pressed={selectedFile === 'page'}
									onclick={() => (selectedFile = 'page')}
									><span class="i-catppuccin-svelte"></span><span>+page.svelte</span><em
										class="text-site-highlight not-italic">M</em
									></button>
								<button
									class="preview-select grid min-h-10 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-0 border-l-2 border-transparent bg-transparent px-3 text-left text-[0.72rem] text-site-code-ink op-65 aria-pressed:border-l-site-highlight aria-pressed:bg-white/5 aria-pressed:op-100"
									type="button"
									aria-pressed={selectedFile === 'design'}
									onclick={() => (selectedFile = 'design')}
									><span class="i-catppuccin-markdown"></span><span>surfaces.md</span><em
										class="text-site-highlight not-italic">M</em
									></button>
							</div>
							<div class="min-w-0 font-sitecode">
								<div
									class="flex min-h-10 items-center justify-between gap-2 border-b border-site-code-line px-3 text-[0.6rem]">
									<span>{selectedFile === 'page' ? '+page.svelte' : 'surfaces.md'}</span><em
										class="text-[#7ad9a8] not-italic">+{selectedFile === 'page' ? '18' : '9'} −2</em>
								</div>
								<pre class="m-0 overflow-x-auto p-3 text-[0.57rem] leading-7"><code
										>{#if selectedFile === 'page'}<span
												class="block w-max min-w-full op-55">  &lt;section class="interactive-feature"&gt;</span>
<span
												class="block w-max min-w-full bg-[#7ad9a8]/10 text-[#7ad9a8]"
												>+   &lt;button aria-pressed=&#123;active&#125;&gt;</span>
<span
												class="block w-max min-w-full bg-[#7ad9a8]/10 text-[#7ad9a8]">+     Files</span>
<span
												class="block w-max min-w-full bg-[#7ad9a8]/10 text-[#7ad9a8]">+   &lt;/button&gt;</span>
<span
												class="block w-max min-w-full op-55">  &lt;/section&gt;</span
											>{:else}<span class="block w-max min-w-full op-55">  ## Website and documentation</span>
<span
												class="block w-max min-w-full bg-[#f48b8b]/10 text-[#f48b8b]"
												>- The preview uses a shared list.</span>
<span
												class="block w-max min-w-full bg-[#7ad9a8]/10 text-[#7ad9a8]"
												>+ Each preview follows its real task.</span>
<span
												class="block w-max min-w-full bg-[#7ad9a8]/10 text-[#7ad9a8]"
												>+ Files open beside their diff.</span
											>{/if}</code></pre>
							</div>
						</div>
					{:else}
						<div class="p-3.5">
							<div
								class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 max-md:grid-cols-[auto_minmax(0,1fr)]">
								<span class="i-simple-icons-github text-xl" aria-hidden="true"></span>
								<div class="grid min-w-0">
									<strong class="text-[0.72rem]">GitHub</strong><small class="font-sitecode text-[0.58rem] op-55"
										>Claude · user scope · OAuth</small>
								</div>
								<label
									class="mcp-switch grid cursor-pointer grid-cols-[auto_auto] items-center gap-1.5 max-md:col-span-2"
									><input class="absolute pointer-events-none op-0" bind:checked={mcpEnabled} type="checkbox" /><span
									></span
									><em class="text-[0.58rem] not-italic">{mcpEnabled ? 'Enabled' : 'Disabled'}</em></label>
							</div>
							<div class="mcp-route my-4 grid grid-cols-3" aria-label="Connection lifecycle">
								<span data-complete class="relative grid justify-items-center gap-1 font-sitecode text-[0.54rem] op-50"
									><i>1</i>Configured</span>
								<span
									data-complete={mcpEnabled || undefined}
									class="relative grid justify-items-center gap-1 font-sitecode text-[0.54rem] op-50"
									><i>2</i>Authorized</span>
								<span
									data-complete={mcpTested || undefined}
									class="relative grid justify-items-center gap-1 font-sitecode text-[0.54rem] op-50"
									><i>3</i>Tested</span>
							</div>
							<div
								class="flex items-center justify-between gap-3 border border-site-code-line bg-white/3 p-2.5 max-md:flex-col max-md:items-stretch">
								<div class="grid min-w-0">
									<strong class="text-[0.72rem]"
										>{mcpTested ? 'Connection passed' : mcpEnabled ? 'Ready to test' : 'Server disabled'}</strong
									><small class="font-sitecode text-[0.58rem] op-55"
										>{mcpTested
											? 'Tools and resources negotiated in 240 ms'
											: 'No connection starts until you request it.'}</small>
								</div>
								<button
									class="min-h-9 bg-site-highlight px-3 text-[0.62rem] font-700 text-[#17332d] disabled:op-45"
									type="button"
									disabled={!mcpEnabled}
									onclick={() => (mcpTested = true)}
									><span class="i-tabler-plug-connected"></span> Test connection</button>
							</div>
							{#if mcpTested}<div class="mt-2.5 flex gap-1.5">
									{#each ['Tools', 'Resources', 'Prompts'] as capability}<span
											class="border border-site-code-line px-1.5 py-1 font-sitecode text-[0.54rem] text-[#7ad9a8]"
											>{capability}</span
										>{/each}
								</div>{/if}
						</div>
					{/if}
				</div>
			{/key}
		</div>
	</div>
</div>
