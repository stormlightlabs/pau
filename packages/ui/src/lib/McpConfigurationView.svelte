<script lang="ts">
	import '../styles/tokens.css';
	import type { McpConfigurationViewModel } from './types/mcp';

	let {
		configuration,
		onEnable,
		onResolve,
		onCreate,
		onEdit,
		onRemove,
		onToggle,
		onAuthenticate,
		onTest
	}: {
		configuration: McpConfigurationViewModel;
		onEnable?: () => void;
		onResolve?: () => void;
		onCreate?: () => void;
		onEdit?: (name: string) => void;
		onRemove?: (name: string) => void;
		onToggle?: (name: string, enabled: boolean) => void;
		onAuthenticate?: (name: string) => void;
		onTest?: (name: string) => void;
	} = $props();

	let selectedName = $state<string>();
	let agentLabel = $derived(configuration.agent === 'pi' ? 'Pi' : 'Claude');
	let unavailable = $derived(configuration.availability.state !== 'ready');
	let selected = $derived(
		configuration.servers.find((server) => server.name === selectedName) ?? configuration.servers[0]
	);

	function statusLabel(status: string) {
		return status.replace('-', ' ');
	}
</script>

<section class="mcp" aria-labelledby="mcp-title">
	<header class="mcp__header">
		<div>
			<h2 id="mcp-title">{agentLabel} MCP</h2>
			<p>{configuration.serverCount} configured {configuration.serverCount === 1 ? 'server' : 'servers'}</p>
		</div>
		<span class:off={!configuration.managedEnabled} class="mcp__managed-state">
			Pau-managed MCP {configuration.managedEnabled ? 'on' : 'off'}
		</span>
	</header>

	{#if unavailable && configuration.availability.state !== 'ready'}
		<div class="mcp__unavailable" role="status">
			<div>
				<strong>MCP unavailable for {agentLabel}</strong>
				<p>{configuration.availability.message}</p>
			</div>
			<button type="button" onclick={() => onResolve?.()}>
				{configuration.availability.actionLabel}
			</button>
		</div>
	{:else}
		<div class="mcp__summary">
			<p>
				{#if configuration.nativeConfigurationActive}
					Native {agentLabel} MCP remains active. Pau does not change that configuration.
				{:else}
					No native {agentLabel} MCP server is active.
				{/if}
			</p>
			{#if !configuration.managedEnabled}
				<button type="button" onclick={() => onEnable?.()}>Enable for this workspace</button>
			{/if}
		</div>

		<div class="mcp__servers">
			<div class="mcp__section-heading">
				<h3>Servers</h3>
				<button class="quiet" type="button" onclick={() => onCreate?.()}>Add server</button>
			</div>
			{#if configuration.servers.length === 0}
				<p>No editable MCP servers found.</p>
			{:else}
				<div class="mcp__server-layout">
					<ul aria-label="MCP servers">
						{#each configuration.servers as server (server.name)}
							<li>
								<button
									class="mcp__server-row"
									class:selected={selected?.name === server.name}
									type="button"
									onclick={() => (selectedName = server.name)}>
									<span><strong>{server.name}</strong><small>{server.scope} · {server.transport}</small></span>
									<span class:failed={server.status === 'failed'}>{statusLabel(server.status)}</span>
								</button>
							</li>
						{/each}
					</ul>

					{#if selected}
						<div class="mcp__server-detail">
							<div>
								<strong>{selected.name}</strong>
								<p>{selected.diagnostic ?? 'This lazy server has not connected yet.'}</p>
							</div>
							<div>
								<h4>Configuration</h4>
								<code title={selected.sourcePath}>{selected.sourcePath}</code>
							</div>
							<div>
								<h4>Negotiated capabilities</h4>
								<p>
									{selected.negotiatedCapabilities.length > 0
										? selected.negotiatedCapabilities.join(', ')
										: 'Available after the first connection.'}
								</p>
							</div>
							<div class="mcp__actions">
								<button class="quiet" type="button" onclick={() => onEdit?.(selected.name)}>Edit</button>
								<button class="quiet" type="button" onclick={() => onToggle?.(selected.name, !selected.enabled)}>
									{selected.enabled ? 'Disable' : 'Enable'}
								</button>
								{#if selected.status === 'needs-auth'}
									<button type="button" onclick={() => onAuthenticate?.(selected.name)}>Authenticate</button>
								{/if}
								<button type="button" disabled={!selected.enabled} onclick={() => onTest?.(selected.name)}>
									Test connection
								</button>
								<button class="danger" type="button" onclick={() => onRemove?.(selected.name)}>Remove server</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<div class="mcp__sources">
		<h3>Configuration sources</h3>
		{#if configuration.sources.length === 0}
			<p>No native MCP configuration found.</p>
		{:else}
			<ul>
				{#each configuration.sources as source (`${source.scope}:${source.path}`)}
					<li class="mcp__source">
						<code title={source.path}>{source.path}</code>
						<span>{source.scope} · {source.serverCount}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.mcp {
		display: grid;
		width: min(54rem, calc(100vw - 2rem));
		color: var(--workbench-text);
		background: var(--workbench-surface);
		border: 1px solid var(--workbench-border);
	}

	.mcp__header,
	.mcp__summary,
	.mcp__unavailable,
	.mcp__servers,
	.mcp__sources {
		padding: var(--pau-space-4) var(--pau-space-4);
	}

	.mcp__header,
	.mcp__unavailable,
	.mcp__summary,
	.mcp__section-heading,
	.mcp__source {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
	}

	.mcp__header,
	.mcp__summary,
	.mcp__unavailable,
	.mcp__servers {
		border-bottom: 1px solid var(--workbench-border);
	}

	h2,
	h3,
	h4,
	p {
		margin: 0;
	}

	h2 {
		font-size: var(--pau-type-lg);
	}

	h3,
	h4 {
		font-size: var(--pau-type-xs);
		font-weight: 650;
		letter-spacing: 0.03em;
	}

	p,
	li,
	small {
		color: var(--workbench-muted);
		font-size: var(--pau-type-sm);
		line-height: 1.5;
	}

	.mcp__managed-state {
		color: var(--workbench-available-text);
		font-size: var(--pau-type-xs);
		font-weight: 650;
	}

	.mcp__managed-state.off,
	.failed {
		color: var(--workbench-unavailable-text);
	}

	.mcp__unavailable {
		background: color-mix(in srgb, var(--workbench-unavailable-surface) 55%, transparent);
	}

	.mcp__unavailable strong,
	.mcp__server-detail strong {
		display: block;
		margin-bottom: var(--pau-space-1);
		font-size: var(--pau-type-md);
	}

	.mcp__section-heading {
		margin-bottom: var(--pau-space-3);
	}

	.mcp__server-layout {
		display: grid;
		grid-template-columns: minmax(12rem, 0.8fr) minmax(18rem, 1.2fr);
		border: 1px solid var(--workbench-border);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mcp__server-layout > ul {
		border-right: 1px solid var(--workbench-border);
	}

	.mcp__server-layout li + li,
	.mcp__source + .mcp__source {
		border-top: 1px solid var(--workbench-border);
	}

	.mcp__server-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 3.25rem;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--workbench-muted);
		background: transparent;
		border: 0;
		border-left: 2px solid transparent;
		text-align: left;
	}

	.mcp__server-row.selected {
		color: var(--workbench-text);
		background: var(--workbench-selected-surface, var(--workbench-canvas));
		border-left-color: var(--workbench-focus);
	}

	.mcp__server-row strong,
	.mcp__server-row small {
		display: block;
	}

	.mcp__server-row > span:last-child {
		font-size: var(--pau-type-xs);
		text-transform: capitalize;
	}

	.mcp__server-detail {
		display: grid;
		align-content: start;
		gap: var(--pau-space-4);
		min-width: 0;
		padding: var(--pau-space-3);
	}

	.mcp__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2);
	}

	button {
		flex: none;
		min-height: var(--pau-size-row-lg);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--workbench-button-text);
		background: var(--workbench-button-surface);
		border: 1px solid transparent;
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-xs);
		font-weight: 650;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--workbench-button-hover);
	}

	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
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

	button.danger {
		color: var(--workbench-unavailable-text);
		background: transparent;
		border-color: var(--workbench-border);
	}

	.mcp__sources h3 {
		margin-bottom: var(--pau-space-3);
	}

	.mcp__source {
		min-width: 0;
		padding: var(--pau-space-2) 0;
	}

	code {
		overflow: hidden;
		color: var(--workbench-text);
		font: inherit;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mcp__source span {
		flex: none;
		text-transform: capitalize;
	}

	@media (max-width: 42rem) {
		.mcp__header,
		.mcp__summary,
		.mcp__unavailable {
			align-items: stretch;
			flex-direction: column;
		}

		.mcp__server-layout {
			grid-template-columns: 1fr;
		}

		.mcp__server-layout > ul {
			border-right: 0;
			border-bottom: 1px solid var(--workbench-border);
		}

		.mcp__summary button,
		.mcp__unavailable button {
			width: 100%;
		}
	}
</style>
