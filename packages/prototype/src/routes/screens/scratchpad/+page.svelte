<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const notes = [
		{ id: 'today', title: 'Today', detail: '7 lines', state: 'edited' },
		{ id: 'reconnect', title: 'Reconnect questions', detail: '12 lines', state: 'saved' },
		{ id: 'shell', title: 'Session shell ideas', detail: '9 lines', state: 'saved' }
	];
	const noteContent: Record<string, string> = {
		today: `# Today

- Compare the dashboard at narrow widths
- Decide whether tool rows show counts or the latest command
- Review reconnect behavior with Claude

## Question

Should a resumed session return to its last open inspector?`,
		reconnect: `# Reconnect questions

The UI should distinguish a dropped browser connection from a stopped native session.

- What survives a desktop reload?
- When does replay become partial?
- Which action is safe to retry?`,
		shell: `# Session shell ideas

Keep the transcript central. Put plan, checks, permissions, and selected tool detail in the inspector.

The bottom terminal dock is the only surface that should split the main column.`
	};

	let selected = $state('today');
	let content = $state(noteContent.today);
	let target = $state('Pi · session-shell');
	let attachedFiles = $state(['dev/PLAN.md', 'SessionView.svelte']);
	let sent = $state(false);

	function selectNote(id: string) {
		selected = id;
		content = noteContent[id];
		sent = false;
	}

	function toggleFile(file: string) {
		attachedFiles = attachedFiles.includes(file)
			? attachedFiles.filter((attached) => attached !== file)
			: [...attachedFiles, file];
	}
</script>

<PrototypePage
	section="V1 screen · 04"
	title="Scratchpad"
	note="The scratchpad catches incomplete thoughts without forcing them into a session. Notes can stay private, become a prompt, or carry selected workspace context into an existing agent session.">
	<MockApp context="pau / scratchpad / today">
		<div class="mock-layout">
			<ProductRail active="scratchpad" />

			<aside class="mock-context-rail flex flex-col" aria-label="Scratchpads">
				<div class="flex items-center justify-between">
					<p class="mock-section-label mb-0!">Scratchpads</p>
					<button class="icon-button size-8!" type="button" aria-label="New scratchpad"
						><span class="i-tabler-plus"></span></button>
				</div>
				<div class="mock-list mt-3">
					{#each notes as note (note.id)}
						<button type="button" aria-pressed={selected === note.id} onclick={() => selectNote(note.id)}>
							<span class="i-tabler-note"></span>
							<span><strong class="block truncate text-text">{note.title}</strong><small>{note.detail}</small></span>
							<span
								class={note.state === 'edited' ? 'size-1.5 rounded-full bg-warning' : 'i-tabler-check text-positive'}
								aria-label={note.state}></span>
						</button>
					{/each}
				</div>

				<p class="mock-section-label mt-7">Pinned</p>
				<div class="mock-list">
					<button type="button"><span class="i-tabler-template"></span><span>Review checklist</span></button>
					<button type="button"><span class="i-tabler-terminal-2"></span><span>Useful commands</span></button>
				</div>

				<div class="mt-auto border-t border-line pt-4 text-xs leading-5 text-muted">
					Scratchpads are workspace files. Agents receive them only when you attach or send them.
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Scratchpad editor">
				<header class="flex min-h-13 items-center gap-3 border-b border-line px-4">
					<div class="min-w-0 flex-1">
						<strong class="block truncate text-sm">{notes.find((note) => note.id === selected)?.title}</strong><span
							class="text-xs text-muted">Scratchpad · saved locally</span>
					</div>
					<button class="icon-button" type="button" aria-label="Pin scratchpad"
						><span class="i-tabler-pin"></span></button>
					<button class="icon-button" type="button" aria-label="More scratchpad actions"
						><span class="i-tabler-dots"></span></button>
				</header>

				<div
					class="flex min-h-10 items-center gap-1 border-b border-line bg-surface px-3"
					aria-label="Formatting tools">
					<button class="icon-button size-8!" type="button" aria-label="Heading"
						><span class="i-tabler-h-2"></span></button>
					<button class="icon-button size-8!" type="button" aria-label="Bold"
						><span class="i-tabler-bold"></span></button>
					<button class="icon-button size-8!" type="button" aria-label="Checklist"
						><span class="i-tabler-list-check"></span></button>
					<button class="icon-button size-8!" type="button" aria-label="Code block"
						><span class="i-tabler-code"></span></button>
					<span class="ml-auto text-xs text-muted">Markdown</span>
				</div>

				<label class="sr-only" for="scratchpad-content">Scratchpad content</label>
				<textarea
					id="scratchpad-content"
					class="min-h-0 flex-1 resize-none border-0 bg-canvas p-7 font-sans text-[0.95rem] leading-7 text-text outline-none"
					bind:value={content}
					spellcheck="true"></textarea>

				<footer
					class="flex min-h-9 items-center justify-between border-t border-line bg-surface px-4 text-xs text-muted">
					<span>{content.split(/\s+/).filter(Boolean).length} words</span><span>Saved just now · workspace scope</span>
				</footer>
			</section>

			<aside class="mock-inspector flex flex-col" aria-label="Use scratchpad">
				<p class="mock-section-label">Use this note</p>
				<label class="mb-2 text-xs text-muted" for="scratch-target">Target session</label>
				<select id="scratch-target" class="app-field mb-5" bind:value={target}>
					<option>Pi · session-shell</option>
					<option>Claude Code · reconnect-fix</option>
					<option>New session…</option>
				</select>

				<p class="mock-section-label">Workspace context</p>
				<div class="grid gap-2">
					{#each ['dev/PLAN.md', 'SessionView.svelte', 'reconnect.test.ts'] as file (file)}
						<label class="flex min-h-9 items-center gap-2 border border-line px-2 text-xs">
							<input type="checkbox" checked={attachedFiles.includes(file)} onchange={() => toggleFile(file)} />
							<span class="i-tabler-file-code text-muted"></span><span class="truncate">{file}</span>
						</label>
					{/each}
				</div>
				<button class="mt-2 border-0 bg-transparent p-2 text-left text-xs text-muted hover:text-text" type="button"
					><span class="i-tabler-plus mr-2"></span>Add file or selection</button>

				<div class="mt-6 border-y border-line py-4 text-xs leading-5 text-muted">
					Only this note and the checked files will be sent. The target session keeps its current permission profile.
				</div>

				<div class="mt-5 grid gap-2">
					<button class="app-button-primary" type="button" onclick={() => (sent = true)}
						><span class="i-tabler-send"></span>{sent
							? `Sent to ${target.split(' · ', 1)[0]}`
							: 'Send as prompt'}</button>
					<button class="app-button" type="button"><span class="i-tabler-bookmark"></span>Save as prompt</button>
				</div>

				<p class="mt-auto mb-0 text-xs leading-5 text-muted">
					Sending creates a visible user message in the target session. It does not start an agent-to-agent handoff.
				</p>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
