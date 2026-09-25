<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const sessions = [
		{ id: 'shell', name: 'session-shell', status: 'working', color: 'var(--color-info)' },
		{ id: 'review', name: 'review-reconnect', status: 'needs you', color: 'var(--color-warning)' },
		{ id: 'tokens', name: 'theme-tokens', status: 'idle', color: 'var(--color-positive)' }
	];
	let selected = $state('shell');
	let contextRailOpen = $state(true);
	let inspectorOpen = $state(true);
	let focused = $state(false);
	let prompt = $state('');
	let sentPrompt = $state('');
	let sentMode = $state('');
	let deliveryMode = $state('Queue follow-up');
	let model = $state('Sonnet 4.5');
	let thinking = $state('Think: high');
	let contextAttached = $state(true);

	function submitPrompt(event: SubmitEvent) {
		event.preventDefault();
		const value = prompt.trim();
		if (value.length === 0) return;
		sentPrompt = value;
		sentMode = deliveryMode;
		prompt = '';
	}
</script>

<PrototypePage
	section="V1 screen · 02"
	title="Session workspace"
	note="The center stays devoted to the current task. Either sidebar can close independently, and focus mode removes all navigation while preserving the active session and composer.">
	<MockApp context="workspaces / pau">
		<div
			class="mock-layout session-layout"
			class:session-layout--no-context={!contextRailOpen && !focused}
			class:session-layout--no-inspector={!inspectorOpen && !focused}
			class:session-layout--no-sidebars={!contextRailOpen && !inspectorOpen && !focused}
			class:session-layout--focused={focused}>
			{#if !focused}<ProductRail active="sessions" />{/if}

			{#if contextRailOpen && !focused}<aside class="mock-context-rail" aria-label="Sessions">
					<div class="flex items-center justify-between">
						<p class="mock-section-label mb-0!">Sessions</p>
						<button class="icon-button size-8!" type="button" aria-label="Start session">
							<span class="i-tabler-plus" aria-hidden="true"></span>
						</button>
					</div>
					<div class="mock-list mt-3">
						{#each sessions as session (session.id)}
							<button type="button" aria-pressed={selected === session.id} onclick={() => (selected = session.id)}>
								<span class="status-dot" style:color={session.color}></span>
								<span class="truncate mock-code">{session.name}</span>
								<small>{session.status}</small>
							</button>
						{/each}
					</div>
				</aside>{/if}

			<section class="mock-main flex min-h-0 flex-col" aria-label="Conversation">
				<header class="flex min-h-13 items-center gap-3 border-b border-line px-4">
					<div class="min-w-0 flex-1">
						<strong class="mock-code block truncate"
							>{sessions.find((session) => session.id === selected)?.name}</strong>
						<span class="text-xs text-muted">pi · sonnet · running for 02:14</span>
					</div>
					<button class="icon-button" type="button" aria-label="Interrupt agent">
						<span class="i-tabler-player-stop" aria-hidden="true"></span>
					</button>
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
					<button
						class="icon-button"
						type="button"
						aria-label={focused ? 'Exit focus mode' : 'Enter focus mode'}
						aria-pressed={focused}
						onclick={() => (focused = !focused)}>
						<span class={focused ? 'i-tabler-arrows-minimize' : 'i-tabler-arrows-maximize'} aria-hidden="true"></span>
					</button>
				</header>

				<div class="flex-1 overflow-auto p-5">
					<div class="mb-6 max-w-[64ch]">
						<div class="mb-2 text-xs text-muted">You · now</div>
						<p class="m-0 text-sm leading-6">
							Keep the session controls compact. Show what the agent is doing without making the transcript read like a
							log viewer.
						</p>
					</div>

					<div class="mb-5 border-l border-line pl-4 mock-code text-xs text-muted">
						<div class="grid grid-cols-[4rem_1fr_auto] gap-3 py-1">
							<span>read</span><b class="text-text">SessionView.svelte</b><span>248 lines</span>
						</div>
						<div class="grid grid-cols-[4rem_1fr_auto] gap-3 py-1">
							<span>edit</span><b class="text-text">session-shell.css</b><span class="text-positive">+18 −7</span>
						</div>
						<div class="grid grid-cols-[4rem_1fr_auto] gap-3 py-1">
							<span>bash</span><b class="text-text">pnpm test session</b><span class="text-positive">42 passed</span>
						</div>
					</div>

					<div class="max-w-[68ch]">
						<div class="mb-2 text-xs text-accent">Pi · sonnet</div>
						<p class="m-0 text-sm leading-6">
							The task remains readable as a conversation. Tool activity is compressed into a scan line, while the
							selected result can open in the inspector.
						</p>
					</div>

					{#if sentPrompt}
						<div class="mt-6 max-w-[64ch] border-l-2 border-accent pl-4 text-sm">
							<div class="mb-1 text-xs text-muted">{sentMode}</div>
							{sentPrompt}
						</div>
					{/if}
				</div>

				<form class="agent-composer m-4 mt-0 border border-line bg-surface" onsubmit={submitPrompt}>
					{#if contextAttached}
						<div class="agent-composer__context">
							<span class="i-tabler-file-code text-accent" aria-hidden="true"></span>
							<span class="truncate">SessionView.svelte</span>
							<span class="text-muted">lines 118–164</span>
							<button
								type="button"
								aria-label="Remove SessionView.svelte context"
								onclick={() => (contextAttached = false)}><span class="i-tabler-x"></span></button>
						</div>
					{/if}
					<label class="sr-only" for="session-prompt">Message Pi</label>
					<textarea
						id="session-prompt"
						class="agent-composer__input"
						rows="2"
						bind:value={prompt}
						placeholder={deliveryMode === 'Steer now'
							? 'Redirect the current turn…'
							: 'Ask a question or queue the next task…'}></textarea>
					<div class="agent-composer__controls">
						<div class="agent-composer__tools">
							<button type="button" aria-label="Attach workspace context" onclick={() => (contextAttached = true)}
								><span class="i-tabler-paperclip"></span></button>
							<button type="button" aria-label="Mention file or resource"><span class="i-tabler-at"></span></button>
							<button type="button" aria-label="Open prompt commands"><span class="i-tabler-slash"></span></button>
						</div>
						<select class="agent-composer__delivery" bind:value={deliveryMode} aria-label="Message delivery">
							<option>Queue follow-up</option><option>Steer now</option>
						</select>
						<select class="agent-composer__model" bind:value={model} aria-label="Model">
							<option>Sonnet 4.5</option><option>Opus 4.1</option><option>Haiku 4.5</option>
						</select>
						<select class="agent-composer__thinking" bind:value={thinking} aria-label="Thinking level">
							<option>Think: high</option><option>Think: medium</option><option>Think: low</option>
						</select>
						<button class="agent-composer__permission" type="button" aria-label="Permission profile: guarded"
							><span class="i-tabler-shield-check"></span><span>Guarded</span></button>
						<span class="agent-composer__usage" title="Context usage">8.2k / 200k</span>
						<button
							class="agent-composer__send"
							type="submit"
							aria-label={deliveryMode === 'Steer now' ? 'Steer agent' : 'Queue follow-up'}>
							<span
								class={deliveryMode === 'Steer now' ? 'i-tabler-corner-up-left' : 'i-tabler-arrow-up'}
								aria-hidden="true"></span>
						</button>
					</div>
				</form>
			</section>

			{#if inspectorOpen && !focused}<aside class="mock-inspector" aria-label="Inspector">
					<details class="inspector-section" open>
						<summary><span>Plan · 3 of 5</span><span class="text-xs text-muted">live</span></summary>
						<ol class="grid list-none gap-3 p-0 text-xs">
							<li class="text-positive"><span class="i-tabler-check mr-2"></span>Map session states</li>
							<li class="text-positive"><span class="i-tabler-check mr-2"></span>Compress tool rows</li>
							<li class="text-warning"><span class="i-tabler-loader-2 mr-2"></span>Check narrow layout</li>
							<li class="text-muted"><span class="i-tabler-point mr-2"></span>Write interaction test</li>
						</ol>
					</details>
					<details class="inspector-section" open>
						<summary><span>Checks</span><span class="i-tabler-chevron-down text-muted"></span></summary>
						<div class="grid gap-3 text-xs">
							<div class="flex justify-between"><span>Typecheck</span><span class="text-positive">passed</span></div>
							<div class="flex justify-between">
								<span>Component tests</span><span class="text-positive">42 passed</span>
							</div>
							<div class="flex justify-between">
								<span>Visual review</span><span class="text-warning">waiting</span>
							</div>
						</div>
					</details>
				</aside>{/if}
		</div>
	</MockApp>
</PrototypePage>
