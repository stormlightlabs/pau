<script lang="ts">
	import type { DiagnosticBundleView, DiagnosticLevel } from './types/diagnostics';

	let {
		bundle,
		onSettingsChange,
		onStartPayloadTracing,
		onExport
	}: {
		bundle: DiagnosticBundleView;
		onSettingsChange?: (enabled: boolean, level: DiagnosticLevel) => void;
		onStartPayloadTracing?: (durationSeconds: number) => void;
		onExport?: (destination: string, reviewedRevision: number) => void;
	} = $props();

	let destination = $state('pau-diagnostics.json');
	let reviewOpen = $state(false);

	function changeLevel(event: Event): void {
		const level = (event.currentTarget as HTMLSelectElement).value as DiagnosticLevel;
		onSettingsChange?.(bundle.settings.enabled, level);
	}

	function recordDetail(record: DiagnosticBundleView['records'][number]): string {
		return (
			[
				...[record.processId, record.sessionId].filter((value): value is string => value !== undefined),
				...Object.entries(record.metadata).map(([key, value]) => `${key}=${value}`)
			].join(' · ') || 'No process correlation or metadata'
		);
	}
</script>

<section class="diagnostics-view" aria-labelledby="diagnostics-title">
	<header>
		<div>
			<p>Support and troubleshooting</p>
			<h1 id="diagnostics-title">Diagnostics</h1>
		</div>
		<span class:diagnostics-view__mode--active={bundle.settings.enabled} class="diagnostics-view__mode">
			{bundle.settings.enabled ? 'Diagnostics mode on' : 'Diagnostics mode off'}
		</span>
	</header>

	<section class="diagnostics-view__settings" aria-labelledby="diagnostic-settings-title">
		<div>
			<h2 id="diagnostic-settings-title">Release diagnostics</h2>
			<p>
				Keep redacted versions, lifecycle state, queue pressure, and recent metadata in memory. This does not change
				process supervision, permissions, retries, or limits.
			</p>
		</div>
		<label>
			<input
				type="checkbox"
				checked={bundle.settings.enabled}
				onchange={(event) =>
					onSettingsChange?.((event.currentTarget as HTMLInputElement).checked, bundle.settings.minLevel)} />
			<span>Enable diagnostics</span>
		</label>
		<label>
			<span>Minimum log level</span>
			<select value={bundle.settings.minLevel} disabled={!bundle.settings.enabled} onchange={changeLevel}>
				<option value="debug">Debug</option>
				<option value="info">Info</option>
				<option value="warn">Warning</option>
				<option value="error">Error</option>
			</select>
		</label>
	</section>

	{#if !bundle.settings.enabled}
		<div class="diagnostics-view__empty">
			<h2>Collection is off</h2>
			<p>Enable diagnostics here or start Pau with <code>--diagnostics</code>.</p>
		</div>
	{:else}
		<div class="diagnostics-view__versions" aria-label="Build versions">
			<div><span>Frontend</span><strong>{bundle.frontendVersion}</strong></div>
			<div><span>Backend</span><strong>{bundle.backendVersion}</strong></div>
			{#each Object.entries(bundle.dependencies) as [name, version] (name)}
				<div><span>{name}</span><strong>{version}</strong></div>
			{/each}
		</div>

		<section class="diagnostics-view__section" aria-labelledby="adapter-title">
			<div class="diagnostics-view__section-heading">
				<div>
					<h2 id="adapter-title">Adapters</h2>
					<p>Reported versions, handshakes, and capabilities.</p>
				</div>
				<span>{bundle.adapters.length}</span>
			</div>
			{#if bundle.adapters.length === 0}
				<p class="diagnostics-view__section-empty">No adapter handshake has been recorded.</p>
			{:else}
				<ul class="diagnostics-view__rows">
					{#each bundle.adapters as adapter (adapter.name)}
						<li>
							<div><strong>{adapter.name}</strong><small>{adapter.version ?? 'Version unavailable'}</small></div>
							<span>{adapter.handshake}</span>
							<p>{adapter.capabilities.join(' · ') || 'No capabilities reported'}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="diagnostics-view__section" aria-labelledby="transport-title">
			<div class="diagnostics-view__section-heading">
				<div>
					<h2 id="transport-title">Transport and replay</h2>
					<p>Reconnect, queue, replay, and delivery state.</p>
				</div>
				<span>{bundle.transports.length}</span>
			</div>
			{#if bundle.transports.length === 0}
				<p class="diagnostics-view__section-empty">No transport state has been recorded.</p>
			{:else}
				<div class="diagnostics-view__transport" role="table" aria-label="Transport diagnostics">
					<div role="row" class="diagnostics-view__transport-heading">
						<span role="columnheader">Transport</span><span role="columnheader">State</span><span role="columnheader"
							>Sequence</span
						><span role="columnheader">Reconnects</span><span role="columnheader">Queue</span><span role="columnheader"
							>Gaps / dropped</span>
					</div>
					{#each bundle.transports as transport (transport.name)}
						<div role="row">
							<div role="cell"><strong>{transport.name}</strong></div>
							<span role="cell" data-label="State">{transport.state}</span><span role="cell" data-label="Sequence"
								>{transport.lastSequence ?? '—'}</span
							><span role="cell" data-label="Reconnects">{transport.reconnects}</span><span
								role="cell"
								data-label="Queue">{transport.queueDepth}</span
							><span role="cell" data-label="Gaps / dropped">{transport.replayGaps} / {transport.droppedUpdates}</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="diagnostics-view__section" aria-labelledby="records-title">
			<div class="diagnostics-view__section-heading">
				<div>
					<h2 id="records-title">Recent records</h2>
					<p>Redacted metadata retained in memory.</p>
				</div>
				<span>{bundle.records.length} shown · {bundle.droppedRecords} expired</span>
			</div>
			<div class="diagnostics-view__trace">
				<div>
					<strong>Temporary payload tracing</strong>
					<p>Records payload shapes, not prompts, file contents, tool arguments, credentials, or environment values.</p>
				</div>
				<button type="button" disabled={bundle.settings.payloadTracing} onclick={() => onStartPayloadTracing?.(300)}>
					{bundle.settings.payloadTracing ? 'Tracing active' : 'Trace for 5 minutes'}
				</button>
			</div>
			{#if bundle.records.length === 0}
				<p class="diagnostics-view__section-empty">No records match the current log level.</p>
			{:else}
				<ul class="diagnostics-view__records">
					{#each bundle.records as record, index (`${record.timestamp}-${record.operation}-${index}`)}
						<li>
							<time datetime={record.timestamp}>{record.timestamp}</time>
							<span class={`diagnostics-view__level diagnostics-view__level--${record.level}`}>{record.level}</span>
							<code>{record.component}</code>
							<strong>{record.operation}</strong>
							<small>{recordDetail(record)}</small>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="diagnostics-view__section diagnostics-view__export" aria-labelledby="export-title">
			<div class="diagnostics-view__section-heading">
				<div>
					<h2 id="export-title">Export bundle</h2>
					<p>Review the current redacted bundle before writing it.</p>
				</div>
			</div>
			<label
				><span>Destination</span><input bind:value={destination} aria-label="Diagnostic bundle destination" /></label>
			<div class="diagnostics-view__export-actions">
				<button type="button" onclick={() => (reviewOpen = !reviewOpen)}>
					{reviewOpen ? 'Close review' : 'Review bundle'}
				</button>
				<button
					type="button"
					disabled={!reviewOpen || destination.trim().length === 0}
					onclick={() => onExport?.(destination, bundle.revision)}>Export reviewed bundle</button>
			</div>
			{#if reviewOpen}
				<div class="diagnostics-view__review" role="status">
					<strong>Bundle revision {bundle.revision}</strong>
					<p>
						Includes versions, capabilities, transport state, process and session identifiers, and {bundle.records
							.length}
						recent records.
					</p>
					<p>
						Excludes credentials, environment values, prompts, file contents, tool arguments, transcript content,
						outside-workspace paths, and sensitive URL parts.
					</p>
				</div>
			{/if}
		</section>
	{/if}
</section>

<style>
	.diagnostics-view {
		min-width: 0;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	header,
	.diagnostics-view__section-heading,
	.diagnostics-view__trace,
	.diagnostics-view__export-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	header {
		align-items: end;
		margin-bottom: 1.5rem;
	}

	header p,
	header h1,
	.diagnostics-view h2,
	.diagnostics-view p {
		margin: 0;
	}

	header p,
	.diagnostics-view__section-heading p,
	.diagnostics-view__settings p,
	.diagnostics-view__trace p,
	.diagnostics-view__section-empty,
	.diagnostics-view__review p,
	small {
		color: var(--pau-text-muted);
	}

	header p,
	small {
		font-size: 0.72rem;
	}

	h1 {
		font-size: 1.35rem;
	}

	h2 {
		font-size: 0.9rem;
	}

	.diagnostics-view__mode {
		padding: 0.25rem 0.45rem;
		color: var(--pau-text-muted);
		border: 1px solid var(--pau-border);
		font-size: 0.72rem;
	}

	.diagnostics-view__mode--active {
		color: var(--pau-accent);
		border-color: var(--pau-accent);
	}

	.diagnostics-view__settings {
		display: grid;
		grid-template-columns: minmax(16rem, 1fr) auto auto;
		align-items: center;
		gap: 1.5rem;
		padding: 1rem;
		border-block: 1px solid var(--pau-border);
	}

	.diagnostics-view__settings p {
		max-width: 48rem;
		margin-top: 0.25rem;
	}

	.diagnostics-view label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.diagnostics-view select,
	.diagnostics-view__export input {
		min-height: 2.2rem;
		padding-inline: 0.55rem;
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: inherit;
	}

	.diagnostics-view button {
		min-height: 2.2rem;
		padding-inline: 0.7rem;
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: 3px;
		font: inherit;
		cursor: pointer;
	}

	.diagnostics-view button:hover:not(:disabled) {
		border-color: var(--pau-accent);
	}

	.diagnostics-view button:disabled,
	.diagnostics-view select:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.diagnostics-view button:focus-visible,
	.diagnostics-view input:focus-visible,
	.diagnostics-view select:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 2px;
	}

	.diagnostics-view__empty {
		padding: 3rem 1rem;
		text-align: center;
		border-bottom: 1px solid var(--pau-border);
	}

	.diagnostics-view__empty p {
		margin-top: 0.35rem;
		color: var(--pau-text-muted);
	}

	.diagnostics-view__versions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		border-bottom: 1px solid var(--pau-border);
	}

	.diagnostics-view__versions div {
		display: grid;
		gap: 0.2rem;
		padding: 0.8rem 1rem;
		border-right: 1px solid var(--pau-border);
	}

	.diagnostics-view__versions span,
	.diagnostics-view__section-heading p,
	.diagnostics-view__trace p,
	.diagnostics-view__review p {
		font-size: 0.72rem;
	}

	.diagnostics-view__versions span {
		color: var(--pau-text-muted);
	}

	.diagnostics-view__versions strong,
	.diagnostics-view__transport,
	.diagnostics-view__records,
	.diagnostics-view__review strong {
		font-family: ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}

	.diagnostics-view__section {
		padding-block: 1.25rem;
		border-bottom: 1px solid var(--pau-border);
	}

	.diagnostics-view__section-heading {
		padding-inline: 0.75rem;
	}

	.diagnostics-view__section-heading > span {
		color: var(--pau-text-muted);
		font-size: 0.72rem;
	}

	.diagnostics-view__section-empty {
		padding: 1rem 0.75rem 0;
	}

	.diagnostics-view__rows,
	.diagnostics-view__records {
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}

	.diagnostics-view__rows li {
		display: grid;
		grid-template-columns: minmax(10rem, 0.8fr) auto minmax(14rem, 1.5fr);
		align-items: center;
		gap: 1rem;
		min-height: 3rem;
		padding-inline: 0.75rem;
		border-top: 1px solid var(--pau-border);
	}

	.diagnostics-view__rows li div {
		display: grid;
	}

	.diagnostics-view__rows li > span {
		color: var(--pau-accent);
	}

	.diagnostics-view__rows li p {
		color: var(--pau-text-muted);
		font-size: 0.72rem;
	}

	.diagnostics-view__transport {
		margin-top: 0.75rem;
		font-size: 0.75rem;
	}

	.diagnostics-view__transport > div {
		display: grid;
		grid-template-columns: minmax(8rem, 1.5fr) repeat(5, minmax(5rem, 1fr));
		gap: 0.75rem;
		padding: 0.65rem 0.75rem;
		border-top: 1px solid var(--pau-border);
	}

	.diagnostics-view__transport-heading {
		color: var(--pau-text-muted);
	}

	.diagnostics-view__trace {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: var(--pau-surface-raised);
	}

	.diagnostics-view__trace p {
		max-width: 48rem;
		margin-top: 0.2rem;
	}

	.diagnostics-view__records li {
		display: grid;
		grid-template-columns: 11rem 3.5rem 7rem minmax(10rem, 1fr) minmax(8rem, 1fr);
		align-items: center;
		gap: 0.75rem;
		padding: 0.55rem 0.75rem;
		border-top: 1px solid var(--pau-border);
		font-size: 0.72rem;
	}

	.diagnostics-view__records time,
	.diagnostics-view__records code,
	.diagnostics-view__records small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diagnostics-view__level {
		color: var(--pau-info);
	}

	.diagnostics-view__level--warn {
		color: var(--pau-warning);
	}

	.diagnostics-view__level--error {
		color: var(--pau-danger);
	}

	.diagnostics-view__export {
		display: grid;
		gap: 0.75rem;
	}

	.diagnostics-view__export > label,
	.diagnostics-view__export-actions,
	.diagnostics-view__review {
		margin-inline: 0.75rem;
	}

	.diagnostics-view__export > label {
		display: grid;
		grid-template-columns: 7rem minmax(12rem, 1fr);
	}

	.diagnostics-view__export-actions {
		justify-content: flex-start;
	}

	.diagnostics-view__review {
		padding: 0.75rem;
		border-left: 3px solid var(--pau-accent);
		background: var(--pau-surface-raised);
	}

	.diagnostics-view__review p {
		margin-top: 0.35rem;
	}

	@media (max-width: 50rem) {
		.diagnostics-view__settings {
			grid-template-columns: 1fr;
		}

		.diagnostics-view__transport-heading {
			display: none !important;
		}

		.diagnostics-view__transport > div:not(.diagnostics-view__transport-heading) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.diagnostics-view__transport [role='cell']::before {
			display: block;
			color: var(--pau-text-muted);
			font-size: 0.65rem;
			content: attr(data-label);
		}

		.diagnostics-view__rows li,
		.diagnostics-view__records li {
			grid-template-columns: 1fr;
			gap: 0.2rem;
			padding-block: 0.75rem;
		}

		.diagnostics-view__trace,
		header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
