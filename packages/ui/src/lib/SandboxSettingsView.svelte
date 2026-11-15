<script lang="ts">
	import '../styles/tokens.css';
	import StateChip from './StateChip.svelte';
	import Select, { type SelectOption } from './Select.svelte';
	import type {
		EffectiveSandboxView,
		SandboxCredentialShape,
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
	let brokeredCredentials = $derived(
		effective?.credentials.references.filter((reference) =>
			effective.credentials.brokered.includes(reference.source)
		) ?? []
	);

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

	function addCredentialReference(): void {
		if (!settings) return;
		setSettings({
			credentialReferences: [...settings.credentialReferences, { source: '', shape: 'whole-value', destinations: [] }]
		});
	}

	function updateCredentialReference(
		index: number,
		change: Partial<SandboxSettingsModel['credentialReferences'][number]>
	): void {
		if (!settings) return;
		setSettings({
			credentialReferences: settings.credentialReferences.map((reference, referenceIndex) =>
				referenceIndex === index ? { ...reference, ...change } : reference
			)
		});
	}

	function removeCredentialReference(index: number): void {
		if (!settings) return;
		setSettings({
			credentialReferences: settings.credentialReferences.filter((_, referenceIndex) => referenceIndex !== index)
		});
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
	const fieldId = $props.id();
	const credentialShapes: SelectOption<SandboxCredentialShape>[] = [
		{ value: 'whole-value', label: 'Whole value' },
		{ value: 'url-password', label: 'Password in a URL' },
		{ value: 'colon-pair', label: 'Credential after a colon' }
	];
</script>

<section class="sandbox" aria-labelledby="sandbox-title">
	<header class="sandbox__header">
		<h2 class="pau-view-title" id="sandbox-title">Agent sandbox</h2>
		<p>
			{scope === 'workspace' ? 'Default for new agent sessions in this workspace' : 'This session only'}
		</p>
		<StateChip on={draft.mode !== 'unsandboxed'}>
			{draft.mode === 'unsandboxed' ? 'Sandbox off' : 'Sandbox on'}
		</StateChip>
	</header>

	<fieldset class="sandbox__section">
		<legend>Mode</legend>
		<label class="sandbox__choice pau-choice pau-choice--multiline">
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
		<label class="sandbox__choice pau-choice pau-choice--multiline">
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
				<label class="sandbox__choice pau-choice pau-choice--multiline">
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
			<label class="sandbox__check pau-choice pau-choice--multiline">
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
			<label class="sandbox__check pau-choice pau-choice--multiline">
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
			<label class="sandbox__check pau-choice pau-choice--multiline">
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

		<fieldset class="sandbox__section sandbox__credentials">
			<legend>Credential references</legend>
			<p>
				Name a variable in Pau's host environment, its value shape, and the TLS destinations that may receive it. Pau
				saves the variable name, never its value. A value that does not match the selected shape blocks the sandbox from
				starting.
			</p>
			{#if settings.credentialReferences.length === 0}
				<p>No credential references.</p>
			{:else}
				{#each settings.credentialReferences as reference, index (index)}
					<fieldset class="sandbox__credential">
						<legend>Credential {index + 1}</legend>
						<label>
							<span>Source environment variable</span>
							<small>For example, PACKAGE_TOKEN. Model provider credentials cannot be used.</small>
							<input
								type="text"
								value={reference.source}
								autocomplete="off"
								spellcheck="false"
								oninput={(event) => updateCredentialReference(index, { source: event.currentTarget.value.trim() })} />
						</label>
						<div class="sandbox__field">
							<span id={`${fieldId}-shape-${index}`}>Value shape</span>
							<small id={`${fieldId}-shape-hint-${index}`}
								>Choose how Pau finds the credential without exposing the rest of the value.</small>
							<Select
								block
								labelledby={`${fieldId}-shape-${index}`}
								describedby={`${fieldId}-shape-hint-${index}`}
								options={credentialShapes}
								value={reference.shape}
								onChange={(shape) => updateCredentialReference(index, { shape })} />
						</div>
						<label>
							<span>TLS destinations</span>
							<small>One host, wildcard, or host and port per line. Do not include a URL scheme or path.</small>
							<textarea
								rows="2"
								value={reference.destinations.join('\n')}
								oninput={(event) =>
									updateCredentialReference(index, { destinations: lines(event.currentTarget.value) })}></textarea>
						</label>
						<button
							class="pau-button pau-button--danger sandbox__remove"
							type="button"
							onclick={() => removeCredentialReference(index)}>
							Remove credential
						</button>
					</fieldset>
				{/each}
			{/if}
			<button class="pau-button pau-button--secondary sandbox__add" type="button" onclick={addCredentialReference}
				>Add credential reference</button>
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
					<dd class="sandbox__brokered">
						<p>{effective.credentials.denied.length} credential stores denied.</p>
						{#if brokeredCredentials.length === 0}
							<p>No credential is brokered.</p>
						{:else}
							<ul aria-label="Brokered credential destinations">
								{#each brokeredCredentials as reference (reference.source)}
									<li>
										<code>{reference.source}</code>
										<span>may be sent to</span>
										<ul>
											{#each reference.destinations as destination (destination)}
												<li><code>{destination}</code></li>
											{/each}
										</ul>
									</li>
								{/each}
							</ul>
							<p class="warning">
								A permitted destination can use a brokered credential on your behalf or return it in a response.
							</p>
						{/if}
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
			<button class="pau-button pau-button--secondary" type="button" onclick={() => onUseWorkspaceDefault?.()}
				>Use workspace default</button>
		{/if}
		<button
			class="pau-button pau-button--primary"
			type="button"
			disabled={saving}
			onclick={() => onSave?.($state.snapshot(draft) as SandboxSelectionModel)}>
			{scope === 'workspace' ? 'Save workspace default' : 'Apply to this session'}
		</button>
	</footer>
</section>

<style>
	.sandbox {
		display: grid;
		width: 100%;
		max-width: 54rem;
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	.sandbox__header,
	.sandbox__section,
	.sandbox__effective,
	.sandbox__actions,
	.sandbox__error {
		padding: var(--pau-space-4) var(--pau-space-4);
	}

	.sandbox__header,
	.sandbox__section,
	.sandbox__effective {
		border-bottom: 1px solid var(--pau-border);
	}

	.sandbox__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
	}

	.sandbox__actions {
		justify-content: flex-end;
	}

	/* The status chip centers on the title line, as in the shared view header. */
	.sandbox__header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--pau-space-4);
	}

	.sandbox__header :is(h2, p) {
		grid-column: 1;
	}

	.sandbox__header > :global(.state-chip) {
		grid-area: 1 / 2;
	}

	h2,
	h3,
	h4,
	p,
	dl,
	dd {
		margin: 0;
	}

	h3,
	h4,
	legend,
	dt {
		font-size: var(--pau-type-sm);
		font-weight: var(--pau-weight-semibold);
		letter-spacing: 0.03em;
	}

	p,
	small,
	dd,
	li {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-md);
		line-height: 1.5;
	}

	fieldset {
		display: grid;
		gap: var(--pau-space-3);
		margin: 0;
		border: 0;
		border-bottom: 1px solid var(--pau-border);
	}

	legend {
		float: left;
		width: 100%;
		margin-bottom: var(--pau-space-1);
		padding: 0;
	}

	.sandbox__choice,
	.sandbox__check {
		display: flex;
		min-height: var(--pau-size-row-lg);
		font-size: var(--pau-type-md);
	}

	.sandbox__choice strong,
	.sandbox__choice small,
	.sandbox__check small {
		display: block;
	}

	.sandbox__choice strong {
		font-weight: var(--pau-weight-medium);
	}

	.sandbox__grants > label:not(.sandbox__check),
	.sandbox__credential label,
	.sandbox__field {
		display: grid;
		gap: var(--pau-space-1);
		font-size: var(--pau-type-md);
	}

	.sandbox__credentials > p:first-of-type {
		max-width: 44rem;
	}

	.sandbox__credential {
		padding: var(--pau-space-3);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
	}

	.sandbox__credential legend {
		float: none;
		width: auto;
		margin-bottom: var(--pau-space-2);
	}

	.sandbox__remove,
	.sandbox__add {
		justify-self: start;
	}

	textarea,
	input[type='text'] {
		width: 100%;
		min-height: var(--pau-size-row-lg);
		padding: var(--pau-space-2);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-control);
		font: var(--pau-type-sm)/1.4 var(--pau-font-code);
		resize: vertical;
	}

	input[type='text'] {
		min-height: var(--pau-size-row-lg);
		resize: none;
	}

	textarea:focus-visible,
	input:focus-visible,
	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.sandbox__effective {
		display: grid;
		gap: var(--pau-space-3);
	}

	dl {
		display: grid;
		grid-template-columns: minmax(9rem, 0.3fr) 1fr;
		gap: var(--pau-space-2) var(--pau-space-4);
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
		color: var(--pau-text);
		font-size: var(--pau-type-xs);
	}

	.warning,
	.sandbox__error {
		color: var(--pau-danger);
	}

	.sandbox__brokered,
	.sandbox__brokered > ul,
	.sandbox__brokered > ul > li {
		display: grid;
		gap: var(--pau-space-1);
	}

	.sandbox__brokered > ul > li {
		padding-left: var(--pau-space-3);
		border-left: 2px solid var(--pau-border);
	}

	.sandbox__brokered > ul > li > ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-1) var(--pau-space-3);
	}

	.sandbox__gaps ul {
		padding-left: var(--pau-space-4);
		list-style: disc;
	}

	@media (max-width: 42rem) {
		dl {
			grid-template-columns: 1fr;
		}

		dd {
			margin-bottom: var(--pau-space-2);
		}

		.sandbox__actions {
			flex-direction: column-reverse;
			align-items: stretch;
		}
	}
</style>
