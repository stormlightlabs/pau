<script lang="ts">
	import type {
		EffectiveSandboxView,
		SandboxProfile,
		SandboxSelectionModel,
		SandboxSettingsModel
	} from './types/sandbox';

	let {
		selection,
		effective,
		scope = 'workspace',
		unavailable,
		error,
		saving = false,
		onChange,
		onSave,
		onUseWorkspaceDefault
	}: {
		/** Stored selection. The form edits a copy until it is saved. */
		selection: SandboxSelectionModel;
		/** Profile the current draft would enforce, when it is sandboxed. */
		effective?: EffectiveSandboxView;
		/** Whether the selection is the workspace default or one session's override. */
		scope?: 'workspace' | 'session';
		/** Why no sandbox can start on this host. */
		unavailable?: string;
		/** Validation or save failure for the draft. */
		error?: string;
		saving?: boolean;
		onChange?: (selection: SandboxSelectionModel) => void;
		onSave?: (selection: SandboxSelectionModel) => void;
		onUseWorkspaceDefault?: () => void;
	} = $props();

	const defaults: SandboxSettingsModel = {
		profile: 'workspace-write',
		grants: { domains: [], writableRoots: [], unixSockets: false },
		homeReadDeny: false,
		shareClaudeTemp: false,
		unsandboxedTools: [],
		credentialReferences: []
	};

	let draft = $state<SandboxSelectionModel>({ mode: 'unsandboxed' });
	let initialized = $state(false);
	$effect.pre(() => {
		if (initialized) return;
		draft = structuredClone($state.snapshot(selection));
		initialized = true;
	});

	let settings = $derived(draft.mode === 'sandboxed' ? draft.settings : undefined);
	let networkGranted = $derived((settings?.grants.domains.length ?? 0) > 0);
	let agentLabel = $derived(effective?.adapter === 'claude' ? 'Claude' : 'Pi');

	function update(next: SandboxSelectionModel): void {
		draft = next;
		onChange?.($state.snapshot(next) as SandboxSelectionModel);
	}

	function setMode(mode: SandboxSelectionModel['mode']): void {
		update(mode === 'unsandboxed' ? { mode } : { mode, settings: settings ?? structuredClone(defaults) });
	}

	function setSettings(change: Partial<SandboxSettingsModel>): void {
		if (settings) update({ mode: 'sandboxed', settings: { ...settings, ...change } });
	}

	function setGrants(change: Partial<SandboxSettingsModel['grants']>): void {
		if (settings) setSettings({ grants: { ...settings.grants, ...change } });
	}

	function lines(value: string): string[] {
		return value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	}

	const profiles: { value: SandboxProfile; label: string; detail: string }[] = [
		{
			value: 'workspace-write',
			label: 'Workspace write',
			detail: 'Writes the workspace and a session temporary directory.'
		},
		{ value: 'read-only', label: 'Read only', detail: 'Writes only the session temporary directory.' }
	];
</script>

<section class="sandbox" aria-labelledby="sandbox-title">
	<header class="sandbox__header">
		<div>
			<h2 id="sandbox-title">Agent sandbox</h2>
			<p>
				{scope === 'workspace' ? 'Default for new agent sessions in this workspace' : 'This session only'}
			</p>
		</div>
		<span class="sandbox__state" class:off={draft.mode === 'unsandboxed'}>
			{draft.mode === 'unsandboxed' ? 'Sandbox off' : 'Sandbox on'}
		</span>
	</header>

	<fieldset class="sandbox__section">
		<legend>Mode</legend>
		<label class="sandbox__choice">
			<input
				type="radio"
				name="sandbox-mode"
				checked={draft.mode === 'unsandboxed'}
				onchange={() => setMode('unsandboxed')} />
			<span>
				<strong>Unsandboxed</strong>
				<small>Agent tools run with your normal access to files, network, and credentials.</small>
			</span>
		</label>
		<label class="sandbox__choice">
			<input
				type="radio"
				name="sandbox-mode"
				checked={draft.mode === 'sandboxed'}
				disabled={unavailable !== undefined}
				onchange={() => setMode('sandboxed')} />
			<span>
				<strong>Sandboxed</strong>
				<small>
					{unavailable
						? `Unavailable on this computer: ${unavailable}`
						: 'Agent tools run inside an operating-system sandbox. Nothing falls back to running outside it.'}
				</small>
			</span>
		</label>
		<p class="sandbox__note">
			Terminals and editors stay unsandboxed. Permission prompts decide when an agent asks; they never widen what the
			sandbox allows.
		</p>
	</fieldset>

	{#if settings}
		<fieldset class="sandbox__section">
			<legend>Profile</legend>
			{#each profiles as profile (profile.value)}
				<label class="sandbox__choice">
					<input
						type="radio"
						name="sandbox-profile"
						checked={settings.profile === profile.value}
						onchange={() => setSettings({ profile: profile.value })} />
					<span><strong>{profile.label}</strong><small>{profile.detail}</small></span>
				</label>
			{/each}
		</fieldset>

		<fieldset class="sandbox__section sandbox__grants">
			<legend>Grants</legend>
			<label>
				<span>Network destinations</span>
				<small
					>One per line, such as registry.npmjs.org, *.example.com, or 127.0.0.1:5173. Empty keeps the network off.</small>
				<textarea
					rows="3"
					value={settings.grants.domains.join('\n')}
					onchange={(event) => setGrants({ domains: lines(event.currentTarget.value) })}></textarea>
			</label>
			<label>
				<span>Extra writable directories</span>
				<small>Absolute paths, one per line.</small>
				<textarea
					rows="2"
					value={settings.grants.writableRoots.join('\n')}
					onchange={(event) => setGrants({ writableRoots: lines(event.currentTarget.value) })}></textarea>
			</label>
			<label>
				<span>Tools allowed outside the sandbox</span>
				<small>Tool names, one per line. Each call asks for your approval and runs with your normal access.</small>
				<textarea
					rows="2"
					value={settings.unsandboxedTools.join('\n')}
					onchange={(event) => setSettings({ unsandboxedTools: lines(event.currentTarget.value) })}></textarea>
			</label>
			<label class="sandbox__check">
				<input
					type="checkbox"
					checked={settings.homeReadDeny}
					onchange={(event) => setSettings({ homeReadDeny: event.currentTarget.checked })} />
				<span>
					Block reads from the home directory
					<small>
						{networkGranted
							? 'Recommended while a network destination is granted, because readable files can leave the computer.'
							: 'The workspace and the tools the sandbox needs stay readable.'}
					</small>
				</span>
			</label>
			<label class="sandbox__check">
				<input
					type="checkbox"
					checked={settings.grants.unixSockets}
					onchange={(event) => setGrants({ unixSockets: event.currentTarget.checked })} />
				<span>
					Allow Unix sockets
					<small
						>Linux cannot limit sockets by path, so this allows every socket, including Docker and SSH agents.</small>
				</span>
			</label>
			<label class="sandbox__check">
				<input
					type="checkbox"
					checked={settings.shareClaudeTemp}
					onchange={(event) => setSettings({ shareClaudeTemp: event.currentTarget.checked })} />
				<span>
					Share /tmp/claude with Claude Code
					<small>Every sandbox that shares it can read and change the other's temporary files.</small>
				</span>
			</label>
		</fieldset>

		{#if effective}
			<div class="sandbox__effective" aria-labelledby="sandbox-effective-title">
				<h3 id="sandbox-effective-title">Effective access for {agentLabel}</h3>
				<p>
					{effective.mechanism} on {effective.platform}.
					{#if !effective.verified}
						<strong class="warning">Pau has not verified this platform's sandbox.</strong>
					{/if}
				</p>
				<dl>
					<dt>Writable</dt>
					<dd>
						<ul>
							{#each effective.writable as path (path)}<li><code>{path}</code></li>{/each}
						</ul>
					</dd>
					<dt>Readable</dt>
					<dd>
						{effective.readable.homeDenied
							? 'Outside the home directory, plus the paths below'
							: 'Everything except the denied paths'}
						{#if effective.readable.allowed.length > 0}
							<ul>
								{#each effective.readable.allowed as path (path)}<li><code>{path}</code></li>{/each}
							</ul>
						{/if}
					</dd>
					<dt>Denied reads</dt>
					<dd>
						<ul>
							{#each effective.readable.denied as path (path)}<li><code>{path}</code></li>{/each}
						</ul>
					</dd>
					<dt>Protected from writes</dt>
					<dd>
						<ul>
							{#each effective.protected as path (path)}<li><code>{path}</code></li>{/each}
						</ul>
					</dd>
					<dt>Network</dt>
					<dd>
						{#if effective.network.domains.length === 0}
							Off
						{:else}
							<ul>
								{#each effective.network.domains as domain (domain)}
									<li>
										<code>{domain}</code>{effective.network.localAddresses.includes(domain)
											? ' (this computer or a private network)'
											: ''}
									</li>
								{/each}
							</ul>
						{/if}
						{effective.network.unixSockets ? 'Every Unix socket is reachable.' : 'Unix sockets are blocked.'}
					</dd>
					<dt>Credentials</dt>
					<dd>
						{effective.credentials.denied.length} credential stores denied.
						{effective.credentials.brokered.length === 0 ? 'No credential is brokered.' : ''}
					</dd>
					<dt>Environment</dt>
					<dd>Only {effective.environment.join(', ')}</dd>
					<dt>Limits</dt>
					<dd>
						<ul>
							{#each effective.limits as limit (limit)}<li>{limit}</li>{/each}
						</ul>
					</dd>
					<dt>Inside the sandbox</dt>
					<dd>{effective.sandboxedTools.join(', ')}</dd>
					{#if effective.unsandboxedTools.length > 0}
						<dt>Outside, after approval</dt>
						<dd>{effective.unsandboxedTools.join(', ')}</dd>
					{/if}
					<dt>Disabled</dt>
					<dd>
						<ul>
							{#each effective.disabledTools as tool (tool)}<li>{tool}</li>{/each}
						</ul>
					</dd>
					{#if effective.placeholders.length > 0}
						<dt>Placeholders</dt>
						<dd>
							Empty files that block creating protected paths. File and Git views hide them while the sandbox runs.
							<ul>
								{#each effective.placeholders as path (path)}<li><code>{path}</code></li>{/each}
							</ul>
						</dd>
					{/if}
					<dt>Executables</dt>
					<dd>
						<ul>
							{#each effective.executables as executable (executable.name)}
								<li><code>{executable.path}</code>{executable.version ? ` ${executable.version}` : ''}</li>
							{/each}
						</ul>
					</dd>
				</dl>
				<div class="sandbox__gaps">
					<h4>Known gaps</h4>
					<ul>
						{#each effective.knownGaps as gap (gap)}<li>{gap}</li>{/each}
					</ul>
				</div>
			</div>
		{/if}
	{/if}

	{#if error}
		<p class="sandbox__error" role="alert">{error}</p>
	{/if}

	<footer class="sandbox__actions">
		{#if scope === 'session'}
			<button class="quiet" type="button" onclick={() => onUseWorkspaceDefault?.()}>Use workspace default</button>
		{/if}
		<button type="button" disabled={saving} onclick={() => onSave?.($state.snapshot(draft) as SandboxSelectionModel)}>
			{scope === 'workspace' ? 'Save workspace default' : 'Apply to this session'}
		</button>
	</footer>
</section>

<style>
	.sandbox {
		display: grid;
		width: min(54rem, calc(100vw - 2rem));
		color: var(--workbench-text);
		background: var(--workbench-surface);
		border: 1px solid var(--workbench-border);
	}

	.sandbox__header,
	.sandbox__section,
	.sandbox__effective,
	.sandbox__actions,
	.sandbox__error {
		padding: 1rem 1.125rem;
	}

	.sandbox__header,
	.sandbox__section,
	.sandbox__effective {
		border-bottom: 1px solid var(--workbench-border);
	}

	.sandbox__header,
	.sandbox__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.sandbox__actions {
		justify-content: flex-end;
	}

	h2,
	h3,
	h4,
	p,
	dl,
	dd {
		margin: 0;
	}

	h2 {
		font-size: 1rem;
	}

	h3,
	h4,
	legend,
	dt {
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.03em;
	}

	p,
	small,
	dd,
	li {
		color: var(--workbench-muted);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	fieldset {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		border: 0;
		border-bottom: 1px solid var(--workbench-border);
	}

	legend {
		float: left;
		width: 100%;
		margin-bottom: 0.25rem;
		padding: 0;
	}

	.sandbox__state {
		color: var(--workbench-available-text);
		font-size: 0.75rem;
		font-weight: 650;
	}

	.sandbox__state.off {
		color: var(--workbench-muted);
	}

	.sandbox__choice,
	.sandbox__check {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		min-height: 2.5rem;
		font-size: 0.875rem;
	}

	.sandbox__choice input,
	.sandbox__check input {
		margin-top: 0.2rem;
		accent-color: var(--workbench-focus);
	}

	.sandbox__choice strong,
	.sandbox__choice small,
	.sandbox__check small {
		display: block;
	}

	.sandbox__grants > label:not(.sandbox__check) {
		display: grid;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	textarea {
		width: 100%;
		min-height: 2.5rem;
		padding: 0.5rem;
		color: var(--workbench-text);
		background: var(--workbench-canvas);
		border: 1px solid var(--workbench-border);
		border-radius: 0.25rem;
		font: 0.8125rem/1.4 var(--workbench-mono, ui-monospace, monospace);
		resize: vertical;
	}

	textarea:focus-visible,
	input:focus-visible,
	button:focus-visible {
		outline: 3px solid var(--workbench-focus);
		outline-offset: 2px;
	}

	.sandbox__effective {
		display: grid;
		gap: 0.75rem;
	}

	dl {
		display: grid;
		grid-template-columns: minmax(9rem, 0.3fr) 1fr;
		gap: 0.5rem 1rem;
	}

	dd {
		min-width: 0;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	code {
		overflow-wrap: anywhere;
		color: var(--workbench-text);
		font-size: 0.75rem;
	}

	.warning,
	.sandbox__error {
		color: var(--workbench-unavailable-text);
	}

	.sandbox__gaps ul {
		padding-left: 1rem;
		list-style: disc;
	}

	button {
		min-height: 2.5rem;
		padding: 0.5rem 0.75rem;
		color: var(--workbench-button-text);
		background: var(--workbench-button-surface);
		border: 1px solid transparent;
		border-radius: 0.25rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 650;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--workbench-button-hover);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	button.quiet {
		color: var(--workbench-text);
		background: transparent;
		border-color: var(--workbench-border);
	}

	@media (max-width: 42rem) {
		dl {
			grid-template-columns: 1fr;
		}

		dd {
			margin-bottom: 0.5rem;
		}

		.sandbox__actions {
			flex-direction: column-reverse;
			align-items: stretch;
		}
	}
</style>
