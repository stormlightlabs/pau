<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import PiMark from '$lib/components/PiMark.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const sessions = [
		{
			id: 'shell',
			name: 'session-shell',
			branch: 'session-shell',
			status: 'working',
			tone: 'text-info',
			elapsed: '02:14',
			added: 18,
			removed: 7
		},
		{
			id: 'review',
			name: 'review-reconnect',
			branch: 'reconnect-fix',
			status: 'needs you',
			tone: 'text-warning',
			elapsed: '08:31',
			added: 42,
			removed: 12
		},
		{
			id: 'tokens',
			name: 'theme-tokens',
			branch: 'theme-tokens',
			status: 'idle',
			tone: 'text-muted',
			elapsed: '—',
			added: 0,
			removed: 0
		}
	];

	let selected = $state('shell');
	let contextRailOpen = $state(true);
	let inspectorOpen = $state(true);
	let dockOpen = $state(false);
	let focused = $state(false);
	let prompt = $state('');
	let sentPrompt = $state('');
	let sentMode = $state('');
	let deliveryMode = $state('Queue follow-up');
	let model = $state('Sonnet 4.5');
	let thinking = $state('Think: high');
	let contextAttached = $state(true);
	let extensionDialogOpen = $state(false);

	const session = $derived(sessions.find((item) => item.id === selected) ?? sessions[0]);

	function submitPrompt(event: SubmitEvent) {
		event.preventDefault();
		const value = prompt.trim();
		if (value.length === 0) return;
		sentPrompt = value;
		sentMode = deliveryMode;
		prompt = '';
	}
</script>

{#snippet viewActions()}
	<button
		class="icon-button"
		type="button"
		aria-label="Toggle sessions sidebar"
		aria-pressed={contextRailOpen && !focused}
		onclick={() => {
			focused = false;
			contextRailOpen = !contextRailOpen;
		}}>
		<span
			class={contextRailOpen && !focused
				? 'i-tabler-layout-sidebar-left-collapse'
				: 'i-tabler-layout-sidebar-left-expand'}
			aria-hidden="true"></span>
	</button>
	<button
		class="icon-button"
		type="button"
		aria-label="Toggle inspector"
		aria-pressed={inspectorOpen && !focused}
		onclick={() => {
			focused = false;
			inspectorOpen = !inspectorOpen;
		}}>
		<span
			class={inspectorOpen && !focused
				? 'i-tabler-layout-sidebar-right-collapse'
				: 'i-tabler-layout-sidebar-right-expand'}
			aria-hidden="true"></span>
	</button>
{/snippet}

<PrototypePage
	section="V1 screen · 02"
	title="Session workspace"
	note="The center stays devoted to the current task. Either sidebar can close independently, the terminal dock splits the main column when you open it, and focus mode removes all navigation while preserving the session and composer.">
	<MockApp context="workspaces / pau" branch={session.branch} actions={viewActions}>
		<div
			class="mock-layout session-layout relative"
			class:session-layout--no-context={!contextRailOpen && !focused}
			class:session-layout--no-inspector={!inspectorOpen && !focused}
			class:session-layout--no-sidebars={!contextRailOpen && !inspectorOpen && !focused}
			class:session-layout--focused={focused}>
			{#if !focused}<ProductRail active="sessions" />{/if}

			{#if contextRailOpen && !focused}
				<aside class="mock-context-rail p-0!" aria-label="Sessions">
					<div class="section-head">
						<span class="section-label">Sessions</span>
						<span class="chip">3 running</span>
						<button class="icon-button ml-auto size-7!" type="button" aria-label="Start session">
							<span class="i-tabler-plus" aria-hidden="true"></span>
						</button>
					</div>
					<div class="grid">
						{#each sessions as item (item.id)}
							<button
								class="row-button grid min-h-13 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2 pl-2 pr-2.5"
								type="button"
								aria-pressed={selected === item.id}
								onclick={() => (selected = item.id)}>
								<span class={`status-dot ${item.tone}`}></span>
								<span class="min-w-0">
									<span class="block truncate font-mono text-body text-text">{item.name}</span>
									<span class="mt-0.5 flex items-center gap-1.5 text-micro">
										<span class="i-octicon-git-branch-16" aria-hidden="true"></span>
										<span class="truncate">{item.branch}</span>
										{#if item.added > 0}
											<span class="diffstat"
												><span class="text-added">+{item.added}</span><span class="text-removed">−{item.removed}</span
												></span>
										{/if}
									</span>
								</span>
								<span class="grid justify-items-end gap-0.5 text-micro">
									<span class={item.tone}>{item.status}</span>
									<span class="font-mono">{item.elapsed}</span>
								</span>
							</button>
						{/each}
					</div>

					<div class="section-head mt-4">
						<span class="section-label">Queued</span>
					</div>
					<div class="px-4 py-3 text-micro text-muted">
						Codex holds <span class="text-text">path boundary tests</span> until a write slot is free.
					</div>
				</aside>
			{/if}

			<section class="mock-main flex min-h-0 flex-col" aria-label="Conversation">
				<header class="pane-header">
					<span class="pane-title">
						<span class={`status-dot ${session.tone}`}></span>
						<span class="truncate font-mono">{session.name}</span>
					</span>
					<span class="hidden shrink-0 items-center gap-1.5 text-micro text-muted lg:flex">
						<span class="chip-code"><PiMark class="size-4.5" />pi</span>
						<span>running {session.elapsed}</span>
					</span>
					<div class="pane-actions">
						<button
							class="icon-button"
							type="button"
							aria-label="Show extension request"
							onclick={() => (extensionDialogOpen = true)}>
							<span class="i-tabler-plug" aria-hidden="true"></span>
						</button>
						<button class="icon-button" type="button" aria-label="Interrupt agent">
							<span class="i-tabler-player-stop" aria-hidden="true"></span>
						</button>
						<button
							class="icon-button"
							type="button"
							aria-label="Toggle terminal dock"
							aria-pressed={dockOpen}
							onclick={() => (dockOpen = !dockOpen)}>
							<span class="i-tabler-terminal-2" aria-hidden="true"></span>
						</button>
						<button
							class="icon-button"
							type="button"
							aria-label={focused ? 'Exit focus mode' : 'Enter focus mode'}
							aria-pressed={focused}
							onclick={() => (focused = !focused)}>
							<span class={focused ? 'i-tabler-arrows-minimize' : 'i-tabler-arrows-maximize'} aria-hidden="true"></span>
						</button>
					</div>
				</header>

				<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-5">
					<div class="grid gap-2">
						<div class="turn-label">You<span class="font-400 tracking-normal">· 10:42</span></div>
						<p class="turn-body">
							Keep the session controls compact. Show what the agent is doing without making the transcript read like a
							log viewer.
						</p>
					</div>

					<details class="max-w-[74ch] border-l-2 border-line" open>
						<summary
							class="flex min-h-8 cursor-pointer list-none items-center gap-2 pl-3 text-micro text-muted hover:text-text [&::-webkit-details-marker]:hidden">
							<span class="i-tabler-chevron-down" aria-hidden="true"></span>
							<span>3 tool calls · 12s</span>
							<span class="diffstat ml-auto"
								><span class="text-added">+18</span><span class="text-removed">−7</span></span>
						</summary>
						<button class="tool-row" type="button">
							<span>read</span><strong>SessionView.svelte</strong><span>248 lines</span>
						</button>
						<button class="tool-row" type="button">
							<span>edit</span><strong>session-shell.css</strong><span class="text-added">+18 −7</span>
						</button>
						<button class="tool-row" type="button">
							<span>bash</span><strong>pnpm test session</strong><span class="text-positive">42 passed</span>
						</button>
					</details>

					<div class="grid gap-2">
						<div class="turn-label text-accent">Pi<span class="font-400 tracking-normal">· sonnet</span></div>
						<p class="turn-body">
							The task remains readable as a conversation. Tool activity is compressed into one scan line, and any
							result can open in the inspector without leaving the turn.
						</p>
					</div>

					{#if sentPrompt}
						<div class="grid max-w-[74ch] gap-2 border-l-2 border-accent pl-4">
							<div class="turn-label text-accent">{sentMode}</div>
							<p class="turn-body">{sentPrompt}</p>
						</div>
					{/if}
				</div>

				{#if dockOpen}
					<section
						class="grid max-h-56 min-h-0 grid-rows-[auto_minmax(0,1fr)] border-t border-line"
						aria-label="Terminal">
						<div class="flex min-h-9 items-center gap-2 border-b border-line bg-surface pl-3 pr-2 text-micro">
							<span class="i-tabler-terminal-2 text-accent" aria-hidden="true"></span>
							<span class="font-mono text-text">zsh</span>
							<span class="text-muted">pau · session-shell</span>
							<span class="chip ml-auto">exit 0</span>
							<button
								class="icon-button size-7!"
								type="button"
								aria-label="Close terminal dock"
								onclick={() => (dockOpen = false)}>
								<span class="i-tabler-x" aria-hidden="true"></span>
							</button>
						</div>
						<div class="term-surface">
							<div class="term-line"><span class="text-accent">❯</span> pnpm test session</div>
							<div class="text-ansi-dim">· running 3 files</div>
							<div class="term-line">
								<span class="text-ansi-green">✓</span> session/composer.test.ts
								<span class="text-ansi-dim">18 tests</span>
							</div>
							<div class="term-line">
								<span class="text-ansi-green">✓</span> session/transcript.test.ts
								<span class="text-ansi-dim">24 tests</span>
							</div>
							<div class="term-line">
								<span class="text-ansi-green">42 passed</span> <span class="text-ansi-dim">in 1.84s</span>
							</div>
							<div class="term-line"><span class="text-accent">❯</span> <span class="animate-pulse">▌</span></div>
						</div>
					</section>
				{/if}

				<form class="border-t border-line bg-surface focus-within:border-t-accent" onsubmit={submitPrompt}>
					{#if contextAttached}
						<div class="flex flex-wrap items-center gap-1 px-3 pt-2">
							<span class="composer-chip">
								<span class="i-tabler-file-code text-accent" aria-hidden="true"></span>
								<span class="truncate">SessionView.svelte</span>
								<span class="font-mono text-muted">118–164</span>
								<button
									class="inline-flex size-4 items-center justify-center border-0 bg-transparent text-muted hover:text-danger"
									type="button"
									aria-label="Remove SessionView.svelte context"
									onclick={() => (contextAttached = false)}><span class="i-tabler-x" aria-hidden="true"></span></button>
							</span>
							<button
								class="composer-chip border-dashed text-muted hover:border-line-strong hover:text-text"
								type="button">
								<span class="i-tabler-plus" aria-hidden="true"></span>Add context
							</button>
						</div>
					{/if}

					<label class="sr-only" for="session-prompt">Message Pi</label>
					<div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2 pl-3 pr-2">
						<span class="font-mono text-prose text-accent" aria-hidden="true">❯</span>
						<textarea
							id="session-prompt"
							class="block max-h-36 w-full resize-none border-0 bg-transparent p-0 text-prose text-text outline-none [field-sizing:content] placeholder:text-muted"
							rows="1"
							bind:value={prompt}
							placeholder={deliveryMode === 'Steer now'
								? 'Redirect the current turn…'
								: 'Ask a question or queue the next task…'}></textarea>
						<div class="flex items-center gap-px">
							<button class="composer-tool" type="button" aria-label="Mention file or resource"
								><span class="i-tabler-at" aria-hidden="true"></span></button>
							<button class="composer-tool" type="button" aria-label="Open prompt commands"
								><span class="i-tabler-slash" aria-hidden="true"></span></button>
							<button
								class="composer-tool"
								type="button"
								aria-label="Attach workspace context"
								onclick={() => (contextAttached = true)}
								><span class="i-tabler-paperclip" aria-hidden="true"></span></button>
							<button
								class="ml-1 inline-flex size-8 items-center justify-center border-0 bg-accent text-canvas hover:opacity-88 disabled:bg-surface-raised disabled:text-muted disabled:opacity-100"
								type="submit"
								disabled={prompt.trim().length === 0}
								aria-label={deliveryMode === 'Steer now' ? 'Steer agent' : 'Queue follow-up'}>
								<span
									class={deliveryMode === 'Steer now' ? 'i-tabler-corner-up-left' : 'i-tabler-arrow-up'}
									aria-hidden="true"></span>
							</button>
						</div>
					</div>

					<div class="flex min-h-7.5 items-center gap-0.5 border-t border-line pl-2.5 pr-2 text-micro text-muted">
						<span class="relative inline-flex items-center">
							<select class="composer-menu" bind:value={deliveryMode} aria-label="Message delivery">
								<option>Queue follow-up</option><option>Steer now</option>
							</select>
							<span
								class="i-tabler-chevron-down pointer-events-none absolute right-1.5 text-[0.6rem]"
								aria-hidden="true"></span>
						</span>
						<span class="h-3.5 w-px bg-line"></span>
						<span class="relative inline-flex items-center">
							<select class="composer-menu" bind:value={model} aria-label="Model">
								<option>Sonnet 4.5</option><option>Opus 4.1</option><option>Haiku 4.5</option>
							</select>
							<span
								class="i-tabler-chevron-down pointer-events-none absolute right-1.5 text-[0.6rem]"
								aria-hidden="true"></span>
						</span>
						<span class="relative inline-flex items-center">
							<select class="composer-menu" bind:value={thinking} aria-label="Thinking level">
								<option>Think: high</option><option>Think: medium</option><option>Think: low</option>
							</select>
							<span
								class="i-tabler-chevron-down pointer-events-none absolute right-1.5 text-[0.6rem]"
								aria-hidden="true"></span>
						</span>
						<span class="h-3.5 w-px bg-line"></span>
						<button
							class="inline-flex h-6 items-center gap-1.5 border-0 bg-transparent px-1.5 text-micro text-muted hover:bg-surface-raised hover:text-text"
							type="button"
							aria-label="Permission profile: guarded">
							<span class="i-tabler-shield-check" aria-hidden="true"></span>Guarded
						</button>
						<span class="ml-auto hidden font-mono md:inline" title="Context usage">8.2k / 200k</span>
					</div>
				</form>
			</section>

			{#if extensionDialogOpen}
				<div class="absolute inset-0 z-30 grid place-items-center bg-canvas/80 p-4">
					<div
						class="w-full max-w-md rounded-[var(--radius-surface)] border border-focus bg-surface p-4 shadow-2xl"
						role="dialog"
						aria-modal="true"
						aria-labelledby="extension-dialog-title">
						<h2 id="extension-dialog-title" class="m-0 text-body font-600 text-text">Allow workspace update?</h2>
						<p class="mt-2 text-prose text-muted">The configured extension wants to update its workspace index.</p>
						<div class="mt-4 flex justify-end gap-2">
							<button class="app-button" type="button" onclick={() => (extensionDialogOpen = false)}>No</button>
							<button class="app-button-primary" type="button" onclick={() => (extensionDialogOpen = false)}
								>Yes</button>
						</div>
					</div>
				</div>
			{/if}

			{#if inspectorOpen && !focused}
				<aside class="mock-inspector p-0!" aria-label="Inspector">
					<div class="section-head">
						<span class="section-label">Inspector</span>
						<span class="chip ml-auto">session-shell</span>
					</div>
					<div class="p-3">
						<details class="inspector-section" open>
							<summary><span>Plan · 3 of 5</span><span class="text-micro text-muted">live</span></summary>
							<ol class="grid list-none gap-2.5 p-0 text-meta">
								<li class="text-positive">
									<span class="i-tabler-check mr-2" aria-hidden="true"></span>Map session states
								</li>
								<li class="text-positive">
									<span class="i-tabler-check mr-2" aria-hidden="true"></span>Compress tool rows
								</li>
								<li class="text-warning">
									<span class="i-tabler-loader-2 mr-2" aria-hidden="true"></span>Check narrow layout
								</li>
								<li class="text-muted">
									<span class="i-tabler-point mr-2" aria-hidden="true"></span>Write interaction test
								</li>
							</ol>
						</details>
						<details class="inspector-section" open>
							<summary
								><span>Changes</span><span class="diffstat"
									><span class="text-added">+18</span><span class="text-removed">−7</span></span
								></summary>
							<div class="grid gap-2 font-mono text-meta">
								<div class="flex items-center justify-between gap-2">
									<span class="truncate">SessionView.svelte</span><span class="text-added">+12</span>
								</div>
								<div class="flex items-center justify-between gap-2">
									<span class="truncate">session-shell.css</span><span class="diffstat"
										><span class="text-added">+6</span><span class="text-removed">−7</span></span>
								</div>
							</div>
						</details>
						<details class="inspector-section" open>
							<summary
								><span>Checks</span><span class="i-tabler-chevron-down text-muted" aria-hidden="true"></span></summary>
							<div class="grid gap-2.5 text-meta">
								<div class="flex justify-between"><span>Typecheck</span><span class="text-positive">passed</span></div>
								<div class="flex justify-between">
									<span>Component tests</span><span class="text-positive">42 passed</span>
								</div>
								<div class="flex justify-between">
									<span>Visual review</span><span class="text-warning">waiting</span>
								</div>
							</div>
						</details>
					</div>
				</aside>
			{/if}
		</div>
	</MockApp>
</PrototypePage>
