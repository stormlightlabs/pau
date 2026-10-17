<script lang="ts">
	import '../styles/tokens.css';
	import ApplicationShell, { type ShellNavItem } from './ApplicationShell.svelte';
	import ExtensionUi from './ExtensionUi.svelte';
	import Icon from './Icon.svelte';
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
		/** Shows the loading state until the first session list arrives. */
		loading?: boolean;
		onSelectSession?: (sessionId: string) => void;
		onSend?: (sessionId: string, text: string, queue?: PromptQueue) => void | Promise<void>;
		onInterrupt?: (sessionId: string) => void | Promise<void>;
		onStop?: (sessionId: string) => void | Promise<void>;
		/**
		 * Starts a session in a workspace. When set, the rail offers a start
		 * control for each workspace. A rejected promise shows its message as a
		 * failed start.
		 */
		onStartSession?: (workspaceId: string) => void | Promise<void>;
		resourceSnapshot?: ProcessResourceSnapshot;
		onExtensionUiResponse?: (sessionId: string, response: ExtensionUiResponse) => void | Promise<void>;
		onExtensionUiTimeout?: (sessionId: string, requestId: string) => void;
		onOpenPiTerminal?: (sessionId: string) => void;
	};

	let {
		workspaces,
		activeSessionId,
		disconnected = false,
		loading = false,
		onSelectSession = () => {},
		onSend = () => {},
		onInterrupt = () => {},
		onStop = () => {},
		onStartSession,
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
	let startingWorkspaceId = $state<string>();
	let startFailure = $state<{ workspaceId: string; workspaceName: string; message: string }>();
	let controlError = $state<string>();

	const sessions = $derived(workspaces.flatMap((workspace) => workspace.sessions));
	const activeSession = $derived(sessions.find((session) => session.id === activeSessionId));
	const activeWorkspace = $derived(
		workspaces.find((workspace) => workspace.sessions.some((session) => session.id === activeSessionId))
	);
	const canQueue = $derived(
		activeSession ? activeSession.capabilities.steer || activeSession.capabilities.followUp : false
	);
	const activeQueue = $derived<PromptQueue>(
		activeSession && !activeSession.capabilities.steer && activeSession.capabilities.followUp ? 'follow-up' : queue
	);
	const composerUnavailable = $derived(composerUnavailableReason(activeSession, disconnected));
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

	/** Explains why the composer is disabled, or returns `undefined` when it accepts text. */
	function composerUnavailableReason(session: SessionViewModel | undefined, offline: boolean): string | undefined {
		if (!session) return undefined;
		if (['starting', 'stopping', 'stopped', 'failed'].includes(session.status)) return '';
		if (offline) return 'Pau is reconnecting to the backend. You can send prompts again once it reconnects.';
		if (!session.capabilities.prompt) return `${session.agent} does not accept prompts in this session.`;
		if (session.status === 'running' && !session.capabilities.steer && !session.capabilities.followUp) {
			return `${session.agent} cannot take new direction during a run. Send your prompt when this run finishes.`;
		}
		return undefined;
	}

	async function startSession(workspace: SessionWorkspace): Promise<void> {
		if (!onStartSession || startingWorkspaceId) return;
		startingWorkspaceId = workspace.id;
		startFailure = undefined;
		try {
			await onStartSession(workspace.id);
		} catch (cause) {
			startFailure = {
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				message: cause instanceof Error ? cause.message : 'Try again, or open Diagnostics for details.'
			};
		} finally {
			startingWorkspaceId = undefined;
		}
	}

	async function stop(): Promise<void> {
		if (!activeSession) return;
		controlError = undefined;
		try {
			await onStop(activeSession.id);
		} catch (cause) {
			controlError = cause instanceof Error ? cause.message : 'The session could not be stopped. Try again.';
		}
	}

	function selectSession(sessionId: string): void {
		startFailure = undefined;
		controlError = undefined;
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
			await onSend(activeSession.id, text, activeSession.status === 'running' ? activeQueue : undefined);
			draft = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The prompt could not be sent. Try again.';
		} finally {
			sending = false;
			composer?.focus();
		}
	}

	async function interrupt(): Promise<void> {
		if (disconnected || !activeSession || !activeSession.capabilities.interrupt) return;
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
			{#if loading}
				<p class="session-rail__empty">Loading…</p>
			{:else if workspaces.length === 0}
				<p class="session-rail__empty">No sessions yet</p>
			{:else}
				{#each workspaces as workspace (workspace.id)}
					<section aria-labelledby={`workspace-${workspace.id}`}>
						<div class="session-rail__heading">
							<h2 id={`workspace-${workspace.id}`}>{workspace.name}</h2>
							{#if onStartSession}
								<button
									type="button"
									class="session-rail__start"
									aria-label={`Start session in ${workspace.name}`}
									title="Start session"
									disabled={disconnected || startingWorkspaceId !== undefined}
									onclick={() => void startSession(workspace)}>
									<span aria-hidden="true">+</span>
								</button>
							{/if}
						</div>
						{#if workspace.sessions.length === 0}
							<p class="session-rail__empty">
								{startingWorkspaceId === workspace.id ? 'Starting a session…' : 'No sessions yet'}
							</p>
						{/if}
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

	{#if startFailure}
		<section class="session-view session-view--empty" aria-labelledby="start-failed-title">
			<div class="session-view__empty" role="alert">
				<h1 id="start-failed-title">Could not start a session in {startFailure.workspaceName}</h1>
				<p>{startFailure.message}</p>
				{#if onStartSession}
					<button
						type="button"
						class="session-view__retry"
						disabled={disconnected || startingWorkspaceId !== undefined}
						onclick={() => {
							const workspace = workspaces.find((candidate) => candidate.id === startFailure?.workspaceId);
							if (workspace) void startSession(workspace);
						}}>Try again</button>
				{/if}
			</div>
		</section>
	{:else if loading && !activeSession}
		<section class="session-view session-view--empty" aria-labelledby="loading-title">
			<div class="session-view__empty" role="status">
				<h1 id="loading-title">Loading sessions…</h1>
			</div>
		</section>
	{:else if activeSession}
		<section class="session-view" aria-labelledby="session-title">
			<header class="session-view__header">
				<div>
					<p>{activeSession.agent}{activeSession.model ? ` · ${activeSession.model}` : ''}</p>
					<h1 id="session-title">{activeSession.title}</h1>
				</div>
				<div class="session-view__header-actions">
					<div class={`session-view__status session-view__status--${activeSession.status}`} role="status">
						<span></span>{statusLabel(activeSession.status)}
					</div>
					{#if activeSession.capabilities.stop && ['idle', 'running', 'waiting'].includes(activeSession.status)}
						<button type="button" class="session-view__stop" disabled={disconnected} onclick={() => void stop()}>
							Stop
						</button>
					{/if}
				</div>
			</header>

			<div class="session-view__notices">
				{#if disconnected}
					<p class="session-view__notice session-view__notice--attention" role="status">
						<strong>Disconnected.</strong>
						Pau lost its connection to the backend and is reconnecting. The agent keeps running.
					</p>
				{/if}
				{#if controlError}<p class="session-view__notice session-view__notice--failed" role="alert">
						{controlError}
					</p>{/if}

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
			</div>

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
						{#if activeSession.status === 'running' && canQueue}
							<label class="session-composer__queue">
								<span>Send as</span>
								<select value={activeQueue} onchange={(event) => (queue = event.currentTarget.value as PromptQueue)}>
									{#if activeSession.capabilities.steer}<option value="steer">Steer now</option>{/if}
									{#if activeSession.capabilities.followUp}<option value="follow-up">Follow up</option>{/if}
								</select>
							</label>
						{/if}
						<label class="session-composer__field">
							<span class="session-view__sr-only">Prompt</span>
							<Icon name="chevronRight" class="session-composer__prompt" />
							<textarea
								bind:this={composer}
								bind:value={draft}
								onkeydown={handleComposerKeydown}
								placeholder={activeSession.status === 'running'
									? 'Add direction or queue a follow-up'
									: 'Message the agent'}
								aria-describedby={composerUnavailable ? 'composer-unavailable' : undefined}
								disabled={composerUnavailable !== undefined}></textarea>
						</label>
						<div class="session-composer__actions">
							{#if activeSession.status === 'running' && activeSession.capabilities.interrupt}
								<button
									type="button"
									class="session-composer__interrupt"
									disabled={disconnected}
									onclick={() => void interrupt()}>
									Interrupt <kbd>Esc</kbd>
								</button>
							{/if}
							<button type="submit" disabled={!draft.trim() || sending || composerUnavailable !== undefined}>
								{sending
									? 'Sending…'
									: activeQueue === 'follow-up' && activeSession.status === 'running'
										? 'Queue prompt'
										: 'Send prompt'}
								<kbd>⌘↵</kbd>
							</button>
						</div>
						{#if composerUnavailable}
							<p id="composer-unavailable" class="session-composer__hint">{composerUnavailable}</p>
						{/if}
						{#if error}<p class="session-composer__error" role="alert">{error}</p>{/if}
					</form>
				</ExtensionUi>
			</div>
		</section>
	{:else}
		<section class="session-view session-view--empty" aria-labelledby="empty-title">
			<div class="session-view__empty">
				<h1 id="empty-title">No session selected</h1>
				<p>
					{onStartSession
						? 'Select a session from the rail, or start one with the + button next to a workspace.'
						: 'Select a session from the rail, or start one in this workspace.'}
				</p>
			</div>
		</section>
	{/if}
</ApplicationShell>

<style>
	.session-rail {
		padding: 0 var(--pau-space-2) var(--pau-space-4);
	}

	.session-rail__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.session-rail .session-rail__start {
		display: grid;
		place-items: center;
		width: 2rem;
		min-height: var(--pau-size-row-md);
		grid-template-columns: 1fr;
		padding: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-lg);
		text-align: center;
	}

	.session-rail .session-rail__start:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.session-rail section + section {
		margin-top: var(--pau-space-4);
	}

	.session-rail h2 {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.session-rail ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-rail button {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-target-touch);
		padding: var(--pau-space-2) var(--pau-space-3);
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
		font-size: var(--pau-type-xs);
	}

	.session-rail__empty {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
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
		gap: var(--pau-space-4);
		padding-bottom: var(--pau-space-4);
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
		font-size: var(--pau-type-xs);
		font-weight: 500;
	}

	.session-view__header h1 {
		margin-top: var(--pau-space-1);
		font-size: var(--pau-type-lg);
		font-weight: 600;
		text-wrap: balance;
	}

	.session-view__header-actions {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		flex: none;
	}

	.session-view__stop,
	.session-view__retry {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	.session-view__stop:disabled,
	.session-view__retry:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.session-view__retry {
		margin-top: var(--pau-space-4);
	}

	.session-view__status {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		flex: none;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
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

	.session-view__notices {
		grid-area: notice;
		display: grid;
		gap: var(--pau-space-2);
	}

	.session-view__notices > :first-child {
		margin-top: var(--pau-space-4);
	}

	.session-view__notice {
		padding: var(--pau-space-3) var(--pau-space-3);
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
		gap: var(--pau-space-5);
		padding-block: var(--pau-space-5) var(--pau-space-6);
		overflow: auto;
	}

	.session-message {
		max-width: 75ch;
	}

	.session-message--user {
		padding-left: var(--pau-space-4);
		border-left: 2px solid var(--pau-accent);
	}

	.session-message p,
	.session-thinking p {
		margin: var(--pau-space-2) 0 0;
		font-size: var(--pau-type-md);
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.session-thinking {
		max-width: 75ch;
		color: var(--pau-text-muted);
	}

	.session-thinking summary,
	.session-tool summary {
		min-height: var(--pau-size-row-md);
		cursor: pointer;
	}

	.session-thinking p {
		padding-left: var(--pau-space-4);
		font-size: var(--pau-type-sm);
	}

	.session-tool {
		border-left: 1px solid var(--pau-border);
	}

	/* Consecutive tool calls read as one compact block under a shared rule. */
	.session-tool + .session-tool {
		margin-top: calc(-1 * var(--pau-space-5));
	}

	.session-tool summary {
		display: grid;
		grid-template-columns: 4rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-3);
		padding: var(--pau-space-1) var(--pau-space-3);
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
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		font-variant-ligatures: none;
	}

	.session-tool pre {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-4) var(--pau-space-3);
		overflow: auto;
		white-space: pre-wrap;
	}

	.session-tool small {
		font-size: var(--pau-type-xs);
	}

	.session-denial {
		display: grid;
		gap: var(--pau-space-2);
		max-width: 75ch;
		padding: var(--pau-space-3) var(--pau-space-4);
		background: var(--pau-canvas);
		border-left: 2px solid var(--pau-danger);
	}

	.session-denial h2,
	.session-denial p {
		margin: 0;
	}

	.session-denial h2 {
		font-size: var(--pau-type-md);
		font-weight: 600;
	}

	.session-denial .session-denial__label {
		margin-bottom: var(--pau-space-1);
		color: var(--pau-danger);
		font-size: var(--pau-type-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.session-denial code {
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--pau-text);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
	}

	.session-denial > p {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
		line-height: 1.5;
	}

	.session-view__composer-stack {
		position: sticky;
		grid-area: composer;
		bottom: 0;
		display: grid;
		gap: var(--pau-space-2);
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
		gap: var(--pau-space-2);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-bottom: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
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
		align-items: start;
		min-width: 0;
	}

	.session-composer__field :global(.session-composer__prompt) {
		flex: none;
		margin: var(--pau-space-3) 0 0 var(--pau-space-3);
		color: var(--pau-accent);
		font-size: var(--pau-type-lg);
	}

	.session-composer textarea {
		width: 100%;
		min-height: 3.5rem;
		max-height: 10rem;
		padding: var(--pau-space-3);
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
		gap: var(--pau-space-2);
		padding: var(--pau-space-2);
	}

	.session-composer__actions button {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-canvas);
		background: var(--pau-accent);
		border: 0;
		border-radius: var(--pau-radius-control);
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
		margin-left: var(--pau-space-1);
		color: inherit;
		font: inherit;
		font-size: var(--pau-type-xs);
		opacity: 0.75;
	}

	.session-composer__hint {
		grid-column: 1 / -1;
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		border-top: 1px solid var(--pau-border);
		font-size: var(--pau-type-sm);
	}

	.session-composer__error {
		grid-area: error;
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-danger);
		border-top: 1px solid var(--pau-border);
	}

	.session-view__empty {
		grid-area: transcript;
		align-self: center;
		max-width: 30rem;
		margin: auto;
		padding: 3rem var(--pau-space-4);
		text-align: center;
	}

	.session-view__empty h1,
	.session-view__empty h2 {
		font-size: var(--pau-type-lg);
	}

	.session-view__empty p {
		margin-top: var(--pau-space-2);
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

	@media (pointer: coarse) {
		.session-thinking summary,
		.session-tool summary,
		.session-view__stop,
		.session-view__retry,
		.session-composer__actions button {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
