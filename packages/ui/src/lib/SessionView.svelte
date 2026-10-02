<script lang="ts">
	import ApplicationShell, { type ShellNavItem } from './ApplicationShell.svelte';
	import ExtensionUi from './ExtensionUi.svelte';
	import SessionResourceSummary from './SessionResourceSummary.svelte';
	import type { ProcessResourceSnapshot } from './types/resource-monitoring';
	import type {
		ExtensionUiResponse,
		ExtensionUiState,
		PromptQueue,
		SandboxDenial,
		SessionViewModel,
		SessionWorkspace,
		TranscriptTool
	} from './types/session';

	type Props = {
		workspaces: SessionWorkspace[];
		activeSessionId?: string;
		disconnected?: boolean;
		onSelectSession?: (sessionId: string) => void;
		onSend?: (sessionId: string, text: string, queue?: PromptQueue) => void | Promise<void>;
		onInterrupt?: (sessionId: string) => void | Promise<void>;
		onStop?: (sessionId: string) => void | Promise<void>;
		resourceSnapshot?: ProcessResourceSnapshot;
		onExtensionUiResponse?: (sessionId: string, response: ExtensionUiResponse) => void | Promise<void>;
		onExtensionUiTimeout?: (sessionId: string, requestId: string) => void;
		onOpenPiTerminal?: (sessionId: string) => void;
	};

	let {
		workspaces,
		activeSessionId,
		disconnected = false,
		onSelectSession = () => {},
		onSend = () => {},
		onInterrupt = () => {},
		onStop = () => {},
		resourceSnapshot,
		onExtensionUiResponse = () => {},
		onExtensionUiTimeout = () => {},
		onOpenPiTerminal
	}: Props = $props();

	const emptyExtensionUi: ExtensionUiState = { notifications: [], statuses: [], widgets: [] };

	let draft = $state('');
	let queue = $state<PromptQueue>('steer');
	let sending = $state(false);
	let error = $state<string>();
	let composer = $state<HTMLTextAreaElement>();

	const sessions = $derived(workspaces.flatMap((workspace) => workspace.sessions));
	const activeSession = $derived(sessions.find((session) => session.id === activeSessionId));
	const activeWorkspace = $derived(
		workspaces.find((workspace) => workspace.sessions.some((session) => session.id === activeSessionId))
	);
	const productItems = $derived([
		{
			id: 'sessions',
			label: 'Sessions',
			icon: 'agents',
			active: true,
			attention: sessions.some((session) => hasAttention(session))
		},
		{ id: 'files', label: 'Files', icon: 'files' },
		{ id: 'processes', label: 'Processes', icon: 'processes' },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	] satisfies ShellNavItem[]);

	function hasAttention(session: SessionViewModel): boolean {
		return session.status === 'waiting' || Boolean(session.attention) || session.status === 'failed';
	}

	function statusLabel(status: SessionViewModel['status']): string {
		return {
			starting: 'Starting',
			idle: 'Ready',
			running: 'Running',
			waiting: 'Needs you',
			stopping: 'Stopping',
			stopped: 'Stopped',
			failed: 'Failed'
		}[status];
	}

	function selectSession(sessionId: string): void {
		error = undefined;
		draft = '';
		onSelectSession(sessionId);
	}

	function moveSession(sessionId: string, offset: number): void {
		const index = sessions.findIndex((session) => session.id === sessionId);
		if (index === -1) return;
		const next = sessions[(index + offset + sessions.length) % sessions.length];
		if (next) selectSession(next.id);
	}

	async function submitPrompt(): Promise<void> {
		if (sending || !activeSession || !draft.trim()) return;
		const text = draft.trim();
		sending = true;
		error = undefined;
		try {
			await onSend(activeSession.id, text, activeSession.status === 'running' ? queue : undefined);
			draft = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The prompt could not be sent. Try again.';
		} finally {
			sending = false;
			composer?.focus();
		}
	}

	async function interrupt(): Promise<void> {
		if (!activeSession || !activeSession.capabilities.interrupt) return;
		error = undefined;
		try {
			await onInterrupt(activeSession.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The session could not be interrupted. Try again.';
		}
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && activeSession?.status === 'running') {
			event.preventDefault();
			void interrupt();
			return;
		}
		if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
		event.preventDefault();
		void submitPrompt();
	}

	function toolStatus(tool: TranscriptTool): string {
		return tool.status === 'running' ? 'In progress' : tool.status === 'failed' ? 'Failed' : 'Complete';
	}

	function denialTitle(denial: SandboxDenial): string {
		if (denial.target === 'network') return 'Sandbox blocked network access';
		if (denial.target === 'unexplained') return 'Sandbox may have blocked this call';
		return `Sandbox blocked a file ${denial.operation}`;
	}

	function denialExplanation(denial: SandboxDenial): string {
		if (denial.target === 'network') {
			return 'The active sandbox does not allow connections to this destination.';
		}
		if (denial.target === 'unexplained') {
			return 'Pau could not identify the blocked file or destination. Open the failed tool call for its error.';
		}
		return {
			unreadable: 'The active sandbox does not allow this path to be read.',
			protected: 'The active sandbox keeps this path read-only.',
			'outside-writable': 'This path is outside the folders the active sandbox can write.'
		}[denial.reason];
	}
</script>

<ApplicationShell
	workspaceName={activeWorkspace?.name ?? 'Workspaces'}
	contextLabel="Workspaces and sessions"
	{productItems}
	contextItems={[]}
	{disconnected}
	inspectorOpen={Boolean(resourceSnapshot)}>
	{#snippet context()}
		<nav class="session-rail" aria-label="Workspaces and sessions">
			{#if sessions.length === 0}
				<p class="session-rail__empty">No sessions yet</p>
			{:else}
				{#each workspaces as workspace (workspace.id)}
					<section aria-labelledby={`workspace-${workspace.id}`}>
						<h2 id={`workspace-${workspace.id}`}>{workspace.name}</h2>
						<ul>
							{#each workspace.sessions as session (session.id)}
								<li>
									<button
										type="button"
										class:active={session.id === activeSessionId}
										aria-current={session.id === activeSessionId ? 'page' : undefined}
										onclick={() => selectSession(session.id)}
										onkeydown={(event) => {
											if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
											event.preventDefault();
											moveSession(session.id, event.key === 'ArrowDown' ? 1 : -1);
										}}>
										<span
											class:attention={hasAttention(session)}
											class={`session-rail__state session-rail__state--${session.status}`}></span>
										<span class="session-rail__name">{session.title}</span>
										<small>{statusLabel(session.status)}</small>
										{#if hasAttention(session)}<span class="session-view__sr-only">Attention required</span>{/if}
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
		</nav>
	{/snippet}

	{#snippet inspector()}
		<SessionResourceSummary
			snapshot={resourceSnapshot}
			actions={{
				interrupt: activeSession?.capabilities.interrupt ?? false,
				stop: activeSession?.capabilities.stop ?? false
			}}
			onInterrupt={(sessionId) => onInterrupt(sessionId)}
			onStop={(sessionId) => onStop(sessionId)} />
	{/snippet}

	{#if activeSession}
		<section class="session-view" aria-labelledby="session-title">
			<header class="session-view__header">
				<div>
					<p>{activeSession.agent}{activeSession.model ? ` · ${activeSession.model}` : ''}</p>
					<h1 id="session-title">{activeSession.title}</h1>
				</div>
				<div class={`session-view__status session-view__status--${activeSession.status}`} role="status">
					<span></span>{statusLabel(activeSession.status)}
				</div>
			</header>

			{#if activeSession.status === 'starting'}
				<p class="session-view__notice" role="status">Starting the agent process…</p>
			{:else if activeSession.status === 'waiting'}
				<p class="session-view__notice session-view__notice--attention" role="alert">
					<strong>Attention required.</strong>
					{activeSession.attention ?? 'The agent is waiting for your response.'}
				</p>
			{:else if activeSession.status === 'failed'}
				<p class="session-view__notice session-view__notice--failed" role="alert">
					<strong>Session failed.</strong>
					{activeSession.error ?? 'Open the diagnostics and start a new session.'}
				</p>
			{:else if activeSession.status === 'stopped'}
				<p class="session-view__notice" role="status">This session has stopped. Its transcript remains available.</p>
			{/if}

			<div class="session-view__transcript" aria-label="Transcript" aria-live="polite">
				{#if activeSession.transcript.length === 0}
					<div class="session-view__empty">
						<h2>Start with a prompt</h2>
						<p>Describe the task, relevant files, and any limits the agent should follow.</p>
					</div>
				{:else}
					{#each activeSession.transcript as entry (entry.id)}
						{#if entry.kind === 'message'}
							<article class={`session-message session-message--${entry.role}`} aria-label={`${entry.role} message`}>
								<h2>{entry.label ?? (entry.role === 'user' ? 'You' : activeSession.agent)}</h2>
								<p>{entry.body}</p>
							</article>
						{:else if entry.kind === 'thinking'}
							<details class="session-thinking" open={!entry.complete}>
								<summary>{entry.complete ? 'Thinking' : 'Thinking…'}</summary>
								<p>{entry.body}</p>
							</details>
						{:else if entry.kind === 'tool'}
							<details class={`session-tool session-tool--${entry.status}`} open={entry.status !== 'complete'}>
								<summary>
									<span>{entry.name}</span><code>{entry.detail}</code><small>{toolStatus(entry)}</small>
								</summary>
								{#if entry.result}<pre>{entry.result}</pre>{/if}
							</details>
						{:else}
							<article class="session-denial" aria-label="Sandbox denial">
								<div>
									<p class="session-denial__label">Sandbox denial</p>
									<h2>{denialTitle(entry)}</h2>
								</div>
								{#if entry.target === 'file'}
									<code>{entry.path}</code>
								{:else if entry.target === 'network'}
									<code>{entry.destination}</code>
								{/if}
								<p>{denialExplanation(entry)}</p>
							</article>
						{/if}
					{/each}
				{/if}
			</div>

			<div class="session-view__composer-stack">
				<ExtensionUi
					state={activeSession.extensionUi ?? emptyExtensionUi}
					onRespond={(response) => onExtensionUiResponse(activeSession.id, response)}
					onTimeout={(requestId) => onExtensionUiTimeout(activeSession.id, requestId)}
					onOpenTerminal={onOpenPiTerminal ? () => onOpenPiTerminal(activeSession.id) : undefined}>
					<form
						class="session-composer"
						aria-label="Prompt composer"
						onsubmit={(event) => {
							event.preventDefault();
							void submitPrompt();
						}}>
						{#if activeSession.status === 'running' && (activeSession.capabilities.steer || activeSession.capabilities.followUp)}
							<label class="session-composer__queue">
								<span>Send as</span>
								<select bind:value={queue}>
									{#if activeSession.capabilities.steer}<option value="steer">Steer now</option>{/if}
									{#if activeSession.capabilities.followUp}<option value="follow-up">Follow up</option>{/if}
								</select>
							</label>
						{/if}
						<label class="session-composer__field">
							<span class="session-view__sr-only">Prompt</span>
							<textarea
								bind:this={composer}
								bind:value={draft}
								onkeydown={handleComposerKeydown}
								placeholder={activeSession.status === 'running'
									? 'Add direction or queue a follow-up'
									: 'Message the agent'}
								disabled={!activeSession.capabilities.prompt ||
									['starting', 'stopping', 'stopped', 'failed'].includes(activeSession.status)}></textarea>
						</label>
						<div class="session-composer__actions">
							{#if activeSession.status === 'running' && activeSession.capabilities.interrupt}
								<button type="button" class="session-composer__interrupt" onclick={() => void interrupt()}>
									Interrupt <kbd>Esc</kbd>
								</button>
							{/if}
							<button
								type="submit"
								disabled={!draft.trim() ||
									sending ||
									!activeSession.capabilities.prompt ||
									['starting', 'stopping', 'stopped', 'failed'].includes(activeSession.status)}>
								{sending
									? 'Sending…'
									: queue === 'follow-up' && activeSession.status === 'running'
										? 'Queue prompt'
										: 'Send prompt'}
								<kbd>⌘↵</kbd>
							</button>
						</div>
						{#if error}<p class="session-composer__error" role="alert">{error}</p>{/if}
					</form>
				</ExtensionUi>
			</div>
		</section>
	{:else}
		<section class="session-view session-view--empty" aria-labelledby="empty-title">
			<div class="session-view__empty">
				<h1 id="empty-title">No session selected</h1>
				<p>Select a session from the rail, or start one in this workspace.</p>
			</div>
		</section>
	{/if}
</ApplicationShell>

<style>
	.session-rail {
		padding: 0 0.55rem 1rem;
	}

	.session-rail section + section {
		margin-top: 1rem;
	}

	.session-rail h2 {
		margin: 0;
		padding: 0.55rem 0.65rem;
		color: var(--pau-text-muted);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.session-rail ul {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-rail button {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.45rem 0.65rem;
		color: var(--pau-text-muted);
		background: transparent;
		border: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.session-rail button:hover,
	.session-rail button.active {
		color: var(--pau-text);
		background: var(--pau-surface-raised);
	}

	.session-rail__state {
		width: 0.4rem;
		height: 0.4rem;
		background: var(--pau-text-muted);
		border-radius: 50%;
	}

	.session-rail__state--idle,
	.session-rail__state--running {
		background: var(--pau-success);
	}

	.session-rail__state--starting,
	.session-rail__state--stopping {
		background: var(--pau-info);
	}

	.session-rail__state.attention {
		background: var(--pau-warning);
	}

	.session-rail__state--failed {
		background: var(--pau-danger);
	}

	.session-rail__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-rail small {
		color: inherit;
		font-size: 0.6875rem;
	}

	.session-rail__empty {
		margin: 0;
		padding: 0.5rem 0.65rem;
		color: var(--pau-text-muted);
	}

	.session-view {
		display: grid;
		grid-template-areas:
			'header'
			'notice'
			'transcript'
			'composer';
		grid-template-rows: auto auto minmax(0, 1fr) auto;
		height: 100%;
		min-height: 0;
		max-width: 58rem;
		margin-inline: auto;
	}

	.session-view--empty {
		place-items: center;
	}

	.session-view__header {
		grid-area: header;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--pau-border);
	}

	.session-view__header p,
	.session-view__header h1,
	.session-message h2,
	.session-message p,
	.session-view__notice,
	.session-view__empty h1,
	.session-view__empty h2,
	.session-view__empty p {
		margin: 0;
	}

	.session-view__header p,
	.session-message h2 {
		color: var(--pau-text-muted);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.session-view__header h1 {
		margin-top: 0.3rem;
		font-size: 1rem;
		font-weight: 600;
		text-wrap: balance;
	}

	.session-view__status {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: none;
		color: var(--pau-text-muted);
		font-size: 0.75rem;
	}

	.session-view__status span {
		width: 0.45rem;
		height: 0.45rem;
		background: currentColor;
		border-radius: 50%;
	}

	.session-view__status--idle,
	.session-view__status--running {
		color: var(--pau-success);
	}

	.session-view__status--waiting {
		color: var(--pau-warning);
	}

	.session-view__status--failed {
		color: var(--pau-danger);
	}

	.session-view__notice {
		grid-area: notice;
		margin-top: 1rem;
		padding: 0.7rem 0.85rem;
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-left: 2px solid var(--pau-info);
	}

	.session-view__notice--attention {
		color: var(--pau-text);
		border-color: var(--pau-warning);
	}

	.session-view__notice--failed {
		color: var(--pau-text);
		border-color: var(--pau-danger);
	}

	.session-view__transcript {
		grid-area: transcript;
		display: grid;
		align-content: start;
		gap: 1.4rem;
		padding-block: 1.5rem 2rem;
		overflow: auto;
	}

	.session-message {
		max-width: 75ch;
	}

	.session-message--user {
		padding-left: 0.9rem;
		border-left: 2px solid var(--pau-accent);
	}

	.session-message p,
	.session-thinking p {
		margin: 0.4rem 0 0;
		font-size: 0.9375rem;
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.session-thinking {
		max-width: 75ch;
		color: var(--pau-text-muted);
	}

	.session-thinking summary,
	.session-tool summary {
		min-height: 2.75rem;
		cursor: pointer;
	}

	.session-thinking p {
		padding-left: 1rem;
		font-size: 0.8125rem;
	}

	.session-tool {
		border-left: 1px solid var(--pau-border);
	}

	.session-tool summary {
		display: grid;
		grid-template-columns: 4rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.8rem;
		padding: 0.4rem 0.75rem;
		color: var(--pau-text-muted);
		list-style-position: outside;
	}

	.session-tool summary::marker {
		color: var(--pau-info);
	}

	.session-tool--failed summary::marker {
		color: var(--pau-danger);
	}

	.session-tool code,
	.session-tool pre {
		color: var(--pau-text);
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		font-variant-ligatures: none;
	}

	.session-tool pre {
		margin: 0;
		padding: 0.5rem 1rem 0.75rem;
		overflow: auto;
		white-space: pre-wrap;
	}

	.session-tool small {
		font-size: 0.6875rem;
	}

	.session-denial {
		display: grid;
		gap: 0.55rem;
		max-width: 75ch;
		padding: 0.75rem 0.9rem;
		background: var(--pau-canvas);
		border-left: 2px solid var(--pau-danger);
	}

	.session-denial h2,
	.session-denial p {
		margin: 0;
	}

	.session-denial h2 {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.session-denial .session-denial__label {
		margin-bottom: 0.2rem;
		color: var(--pau-danger);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.session-denial code {
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--pau-text);
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}

	.session-denial > p {
		color: var(--pau-text-muted);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.session-view__composer-stack {
		position: sticky;
		grid-area: composer;
		bottom: 0;
		display: grid;
		gap: 0.4rem;
	}

	.session-composer {
		display: grid;
		grid-template-areas:
			'queue queue'
			'field actions'
			'error error';
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto auto;
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	.session-composer:focus-within {
		border-color: var(--pau-focus);
	}

	.session-composer__queue {
		grid-area: queue;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.65rem;
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-bottom: 1px solid var(--pau-border);
		font-size: 0.6875rem;
	}

	.session-composer__queue select {
		color: var(--pau-text);
		background: transparent;
		border: 0;
		font: inherit;
	}

	.session-composer__field {
		grid-area: field;
		display: flex;
		min-width: 0;
	}

	.session-composer textarea {
		width: 100%;
		min-height: 3.5rem;
		max-height: 10rem;
		padding: 0.85rem;
		resize: vertical;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
		line-height: 1.5;
	}

	.session-composer textarea::placeholder {
		color: var(--pau-text-muted);
	}

	.session-composer textarea:disabled {
		cursor: not-allowed;
	}

	.session-composer__actions {
		grid-area: actions;
		display: flex;
		align-items: end;
		gap: 0.45rem;
		padding: 0.45rem;
	}

	.session-composer__actions button {
		min-height: 2.75rem;
		padding-inline: 0.85rem;
		color: var(--pau-canvas);
		background: var(--pau-accent);
		border: 0;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	.session-composer__actions button:disabled {
		color: var(--pau-text-muted);
		background: var(--pau-surface-raised);
		cursor: not-allowed;
	}

	.session-composer__actions .session-composer__interrupt {
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		font-weight: 500;
	}

	.session-composer kbd {
		margin-left: 0.35rem;
		color: inherit;
		font: inherit;
		font-size: 0.6875rem;
		opacity: 0.75;
	}

	.session-composer__error {
		grid-area: error;
		margin: 0;
		padding: 0.5rem 0.75rem;
		color: var(--pau-danger);
		border-top: 1px solid var(--pau-border);
	}

	.session-view__empty {
		grid-area: transcript;
		align-self: center;
		max-width: 30rem;
		margin: auto;
		padding: 3rem 1rem;
		text-align: center;
	}

	.session-view__empty h1,
	.session-view__empty h2 {
		font-size: 1rem;
	}

	.session-view__empty p {
		margin-top: 0.5rem;
		color: var(--pau-text-muted);
		line-height: 1.55;
	}

	.session-view__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 40rem) {
		.session-view__header {
			align-items: start;
		}

		.session-tool summary {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}

		.session-tool small {
			grid-column: 2;
		}

		.session-composer {
			grid-template-areas:
				'queue'
				'field'
				'actions'
				'error';
			grid-template-columns: 1fr;
		}

		.session-composer__actions {
			grid-template-columns: 1fr;
		}

		.session-composer__actions {
			align-items: stretch;
		}
	}
</style>
