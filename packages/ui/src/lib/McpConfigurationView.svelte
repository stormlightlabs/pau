<script lang="ts">
	import type { McpConfigurationViewModel } from './types/mcp';

	let {
		configuration,
		onEnable,
		onResolve
	}: { configuration: McpConfigurationViewModel; onEnable?: () => void; onResolve?: () => void } = $props();

	let agentLabel = $derived(configuration.agent === 'pi' ? 'Pi' : 'Claude');
	let unavailable = $derived(configuration.availability.state !== 'ready');
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
	{/if}

	<div class="mcp__sources">
		<h3>Configuration sources</h3>
		{#if configuration.sources.length === 0}
			<p>No native MCP configuration found.</p>
		{:else}
			<ul>
				{#each configuration.sources as source (`${source.scope}:${source.path}`)}
					<li>
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
		width: min(46rem, calc(100vw - 2rem));
		color: var(--workbench-text);
		background: var(--workbench-surface);
		border: 1px solid var(--workbench-border);
	}

	.mcp__header,
	.mcp__summary,
	.mcp__unavailable,
	.mcp__sources {
		padding: 1rem 1.125rem;
	}

	.mcp__header,
	.mcp__unavailable,
	.mcp__summary,
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.mcp__header,
	.mcp__summary,
	.mcp__unavailable {
		border-bottom: 1px solid var(--workbench-border);
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2 {
		font-size: 1rem;
	}

	h3 {
		margin-bottom: 0.75rem;
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.03em;
	}

	p,
	li {
		color: var(--workbench-muted);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.mcp__managed-state {
		color: var(--workbench-available-text);
		font-size: 0.75rem;
		font-weight: 650;
	}

	.mcp__managed-state.off {
		color: var(--workbench-unavailable-text);
	}

	.mcp__unavailable {
		background: color-mix(in srgb, var(--workbench-unavailable-surface) 55%, transparent);
	}

	.mcp__unavailable strong {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.875rem;
	}

	button {
		flex: none;
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

	button:hover {
		background: var(--workbench-button-hover);
	}

	button:focus-visible {
		outline: 3px solid var(--workbench-focus);
		outline-offset: 2px;
	}

	ul {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		min-width: 0;
		padding: 0.625rem 0;
		border-top: 1px solid var(--workbench-border);
	}

	li:first-child {
		border-top: 0;
	}

	code {
		overflow: hidden;
		color: var(--workbench-text);
		font: inherit;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	li span {
		flex: none;
		text-transform: capitalize;
	}

	@media (max-width: 34rem) {
		.mcp__header,
		.mcp__summary,
		.mcp__unavailable {
			align-items: stretch;
			flex-direction: column;
		}

		button {
			width: 100%;
		}
	}
</style>
