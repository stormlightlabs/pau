<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const files = ['src/session/SessionView.svelte', 'src/session/session-shell.css', 'src/session/state.ts'];
	let activeFile = $state(files[0]);
	const accepted = new SvelteSet<number>();

	function toggleHunk(hunk: number) {
		if (accepted.has(hunk)) accepted.delete(hunk);
		else accepted.add(hunk);
	}
</script>

<PrototypePage
	section="V1 screen · 05"
	title="Editor and review"
	note="Files, code, and review share one workspace. The review rail summarizes changed files and hunks; it does not crowd the editor with a second navigation system.">
	<MockApp context="pau / editor">
		<div class="mock-layout">
			<ProductRail active="editor" />

			<aside class="mock-context-rail" aria-label="Files">
				<p class="mock-section-label">Files · pau</p>
				<div class="mock-list mock-code">
					{#each files as file (file)}
						<button type="button" aria-pressed={activeFile === file} onclick={() => (activeFile = file)}>
							<span
								class={file.endsWith('.svelte')
									? 'i-catppuccin-svelte'
									: file.endsWith('.css')
										? 'i-catppuccin-css'
										: 'i-catppuccin-typescript'}
								aria-hidden="true"></span>
							<span class="truncate">{file.split('/').at(-1)}</span>
							<span class="text-warning">M</span>
						</button>
					{/each}
				</div>
				<p class="mock-section-label mt-7">Outline</p>
				<div class="grid gap-2 pl-2 mock-code text-xs text-muted">
					<span>SessionView</span><span>toolSummary</span><span>submitFollowUp</span>
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Editor">
				<div class="mock-tabs" role="tablist" aria-label="Open files">
					{#each files.slice(0, 2) as file (file)}
						<button
							class="mock-tab mock-code"
							type="button"
							role="tab"
							aria-selected={activeFile === file}
							onclick={() => (activeFile = file)}>{file.split('/').at(-1)}</button>
					{/each}
				</div>
				<div class="flex-1 overflow-auto p-4 mock-code text-[0.78rem] leading-6">
					<div class="grid grid-cols-[2rem_1fr] text-muted">
						<span>1</span><span
							><b class="text-[#cba6f7]">&lt;script</b> <b class="text-[#89b4fa]">lang</b>=<i class="text-[#a6e3a1]"
								>"ts"</i
							>&gt;</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr]">
						<span class="text-muted">2</span><span class="pl-4"
							><b class="text-[#cba6f7]">import</b> ToolSummary <b class="text-[#cba6f7]">from</b>
							<i class="text-[#a6e3a1]">'./ToolSummary.svelte'</i>;</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr] text-muted"><span>3</span><span></span></div>
					<div class="grid grid-cols-[2rem_1fr]">
						<span class="text-muted">4</span><span class="pl-4"
							><b class="text-[#89b4fa]">let</b> inspectorOpen = <b class="text-[#cba6f7]">$state</b>(<b
								class="text-[#fab387]">true</b
							>);</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr]">
						<span class="text-muted">5</span><span class="pl-4"
							><b class="text-[#89b4fa]">let</b> selectedTool =
							<b class="text-[#cba6f7]">$state</b>&lt;ToolCall&gt;();</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr] text-muted"><span>6</span><span></span></div>
					<div class="-mx-4 grid grid-cols-[3rem_1fr] border-l-2 border-warning bg-surface-selected px-4">
						<span class="text-muted">7</span><span
							><b class="text-[#cba6f7]">function</b> <b class="text-[#89b4fa]">openTool</b>(tool: ToolCall) &#123;</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr]">
						<span class="text-muted">8</span><span class="pl-4">selectedTool = tool;</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr]">
						<span class="text-muted">9</span><span class="pl-4"
							>inspectorOpen = <b class="text-[#fab387]">true</b>;</span>
					</div>
					<div class="grid grid-cols-[2rem_1fr]"><span class="text-muted">10</span><span>&#125;</span></div>
					<div class="grid grid-cols-[2rem_1fr] text-muted"><span>11</span><span></span></div>
					<div class="grid grid-cols-[2rem_1fr] text-muted">
						<span>12</span><span><b class="text-[#cba6f7]">&lt;/script&gt;</b></span>
					</div>
				</div>
				<footer
					class="flex min-h-8 items-center justify-between border-t border-line bg-surface px-3 text-xs text-muted">
					<span><span class="i-octicon-git-branch-16 mr-1"></span>session-shell</span><span
						>Ln 7, Col 1 · UTF-8 · Svelte</span>
				</footer>
			</section>

			<aside class="mock-inspector p-0!" aria-label="Review">
				<header class="flex min-h-13 items-center justify-between border-b border-line px-4">
					<strong class="text-sm">Review</strong><span class="text-xs text-muted">{accepted.size} / 2 accepted</span>
				</header>
				<div class="p-3">
					<div class="mb-4 grid gap-1 mock-code text-xs">
						<div class="flex justify-between bg-surface-selected p-2">
							<span>SessionView.svelte</span><span class="text-positive">+18</span>
						</div>
						<div class="flex justify-between p-2">
							<span>session-shell.css</span><span class="text-warning">+9 −3</span>
						</div>
					</div>
					{#each [1, 2] as hunk (hunk)}
						<section class="mb-3 border border-line" aria-label={`Diff hunk ${hunk}`}>
							<header
								class="flex items-center justify-between bg-surface-raised px-2 py-1 mock-code text-xs text-muted">
								<span>@@ −{hunk * 8},5 +{hunk * 8},7 @@</span>
								<button
									class="icon-button size-7!"
									type="button"
									aria-label={`${accepted.has(hunk) ? 'Undo acceptance of' : 'Accept'} hunk ${hunk}`}
									onclick={() => toggleHunk(hunk)}>
									<span
										class={accepted.has(hunk) ? 'i-tabler-check text-positive' : 'i-tabler-check'}
										aria-hidden="true"></span>
								</button>
							</header>
							<div class="bg-[#3a2734] px-2 py-1 mock-code text-xs">− overflow: hidden;</div>
							<div class="bg-[#263a34] px-2 py-1 mock-code text-xs">+ min-width: 0;</div>
							<div class="bg-[#263a34] px-2 py-1 mock-code text-xs">+ overflow: auto;</div>
						</section>
					{/each}
				</div>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
