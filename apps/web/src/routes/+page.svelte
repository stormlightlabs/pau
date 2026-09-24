<script lang="ts">
	import { ApplicationShell, shellNavigationFixtures } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { getBackendVersion } from '$lib/api';

	let connectionState = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
	let backendVersion = $state<string>();

	onMount(() => {
		void getBackendVersion(location.search)
			.then((response) => {
				backendVersion = response.version;
				connectionState = 'connected';
			})
			.catch(() => {
				connectionState = 'disconnected';
			});
	});
</script>

<svelte:head><title>fix-diff-gutter · Pau</title></svelte:head>

<ApplicationShell
	workspaceName="fix-diff-gutter"
	contextLabel="Workspaces"
	productItems={shellNavigationFixtures.productItems}
	contextItems={shellNavigationFixtures.contextItems}
	disconnected={connectionState !== 'connected'}>
	<section class="session" aria-labelledby="session-title">
		<header>
			<p>pi · task</p>
			<h1 id="session-title">Fix diff gutter markers under line wrapping</h1>
			<p class="backend-version" aria-live="polite">
				{connectionState === 'connecting'
					? 'Connecting to local backend'
					: connectionState === 'connected'
						? `Pau backend ${backendVersion}`
						: 'Local backend unavailable'}
			</p>
		</header>
		<div class="activity" aria-label="Recent tool activity">
			<p><span>read</span><code>src/diff/gutter.ts</code><small>212 lines</small></p>
			<p><span>grep</span><code>wrapWidth</code><small>6 matches</small></p>
			<p><span>edit</span><code>src/diff/gutter.ts</code><small>+24 −9</small></p>
			<p><span>bash</span><code>pnpm test diff</code><small>38 passed</small></p>
		</div>
		<h2>pi · sonnet</h2>
		<p class="response">
			Gutter rows now follow visual line offsets, so wrapped lines keep their markers. Two wrap tests cover folded and
			unfolded ranges.
		</p>
	</section>

	{#snippet inspector()}
		<section class="inspection">
			<h2>Plan · v0.3</h2>
			<ul>
				<li><span class="complete"></span>Theme tokens → CSS vars</li>
				<li><span class="current"></span>Gutter markers under wrap</li>
				<li><span></span>MCP registry browser</li>
			</ul>
			<h2>Checks</h2>
			<dl>
				<div>
					<dt>typecheck</dt>
					<dd>passed</dd>
				</div>
				<div>
					<dt>tests</dt>
					<dd>38 passed</dd>
				</div>
				<div>
					<dt>lint</dt>
					<dd>running</dd>
				</div>
			</dl>
		</section>
	{/snippet}
</ApplicationShell>

<style>
	.session {
		max-width: 54rem;
		margin-inline: auto;
	}

	.session header {
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--pau-border);
	}

	h1,
	h2,
	p {
		margin-block: 0;
	}

	h1 {
		margin-top: 0.4rem;
		font-size: 1rem;
		font-weight: 550;
	}

	h2,
	header p {
		color: var(--pau-text-muted);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.backend-version {
		margin-top: 0.5rem;
		color: var(--pau-text-muted);
		font-size: 0.75rem;
	}

	.activity {
		display: grid;
		gap: 0.7rem;
		margin-block: 1.5rem;
		padding-left: 1rem;
		border-left: 1px solid var(--pau-border);
	}

	.activity p {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr) auto;
		gap: 0.75rem;
	}

	.activity span,
	.activity small {
		color: var(--pau-text-muted);
	}

	code {
		font: inherit;
	}

	.response {
		margin-top: 0.55rem;
		line-height: 1.65;
	}

	.inspection h2 {
		margin: 1rem 0 0.75rem;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.inspection ul,
	dl {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.inspection li {
		display: grid;
		grid-template-columns: 0.5rem 1fr;
		gap: 0.55rem;
	}

	.inspection li span {
		width: 0.4rem;
		height: 0.4rem;
		margin-top: 0.35rem;
		background: var(--pau-info);
		border-radius: 50%;
	}

	.inspection li span.complete {
		background: var(--pau-success);
	}

	.inspection li span.current {
		background: var(--pau-warning);
	}

	dl div {
		display: flex;
		justify-content: space-between;
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		color: var(--pau-text-muted);
	}
</style>
