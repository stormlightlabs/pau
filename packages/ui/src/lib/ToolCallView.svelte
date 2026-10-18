<script lang="ts">
	import MetaText from './MetaText.svelte';
	import '../styles/tokens.css';
	import { formatDuration, outputLines, readRange, resultSummary, truncationNotice } from './tool-call-format';
	import ToolOutput from './ToolOutput.svelte';
	import type { TranscriptTool } from './types/session';

	type Props = {
		tool: TranscriptTool;
		/** Whether the row shows its body. The host owns this so it survives re-renders and Ctrl+O. */
		open: boolean;
		/** Reports a disclosure change the operator made on this row. */
		onToggle: (open: boolean) => void;
		/** Marks the row a transcript search just scrolled to. */
		found?: boolean;
	};

	let { tool, open, onToggle, found = false }: Props = $props();
	let call = $derived(tool.call);
	let resultLines = $derived(outputLines(tool.result ?? ''));
	let summary = $derived.by(() => {
		if (!call) return tool.detail;
		if (call.tool === 'bash') return call.command;
		if (call.tool === 'read') {
			const range = readRange(call);
			return range ? `${call.path} · ${range}` : call.path;
		}
		return call.path;
	});
	// A finished call shows what it returned. Running and failed calls name their status so they stand out.
	let outcome = $derived(
		tool.status === 'running' ? 'In progress' : tool.status === 'failed' ? 'Failed' : resultSummary(tool)
	);

	function handleToggle(event: Event): void {
		const next = (event.currentTarget as HTMLDetailsElement).open;
		// Svelte also fires `toggle` when the host changes `open`. Report only operator changes.
		if (next !== open) onToggle(next);
	}
</script>

<details
	class={`tool-call tool-call--${tool.status}`}
	{open}
	ontoggle={handleToggle}
	data-entry-id={tool.id}
	data-found={found || undefined}>
	<summary>
		<span class="tool-call__name">{tool.name}</span><code><MetaText text={summary} /></code><small title={outcome}
			>{outcome}</small>
	</summary>
	{#if open}
		<div class="tool-call__body">
			{#if call?.tool === 'bash'}
				<pre class="tool-call__command" aria-label="Command"><span aria-hidden="true">$ </span>{call.command}</pre>
				{#if resultLines.length > 0}
					<ToolOutput lines={resultLines} label="Command output" from="tail" />
				{:else if tool.status === 'running'}
					<p class="tool-call__note">Waiting for output…</p>
				{/if}
				{#if call.truncation}
					<p class="tool-call__note">
						{truncationNotice(call.truncation, 'last')}
						{#if call.fullOutputPath}Full output: <code>{call.fullOutputPath}</code>{/if}
					</p>
				{/if}
				{#if call.exitCode !== undefined || call.durationMs !== undefined}
					<p class="tool-call__meta">
						{#if call.exitCode !== undefined}<span class:tool-call__exit--failed={call.exitCode !== 0}
								>Exit {call.exitCode}</span
							>{/if}
						{#if call.durationMs !== undefined}<span>{formatDuration(call.durationMs)}</span>{/if}
					</p>
				{/if}
			{:else if call?.tool === 'read'}
				{#if tool.status === 'failed'}
					<ToolOutput lines={resultLines} label="Error" />
				{:else if resultLines.length > 0}
					<ToolOutput lines={resultLines} label={`Contents of ${call.path}`} />
				{/if}
				{#if call.truncation}<p class="tool-call__note">{truncationNotice(call.truncation, 'first')}</p>{/if}
			{:else if call?.tool === 'edit'}
				{#if tool.status === 'failed'}
					<ToolOutput lines={resultLines} label="Error" />
				{:else if call.diff}
					<ToolOutput lines={outputLines(call.diff)} label={`Diff for ${call.path}`} diff />
				{:else}
					<ToolOutput
						lines={call.edits.flatMap((edit) => [
							...outputLines(edit.oldText).map((line) => `-${line}`),
							...outputLines(edit.newText).map((line) => `+${line}`)
						])}
						label={`Requested edits for ${call.path}`}
						diff />
				{/if}
			{:else if call?.tool === 'write'}
				{#if tool.status === 'failed'}
					<ToolOutput lines={resultLines} label="Error" />
				{/if}
				<ToolOutput lines={outputLines(call.content)} label={`New contents of ${call.path}`} />
			{:else if resultLines.length > 0}
				<ToolOutput lines={resultLines} label={`${tool.name} output`} />
			{/if}
		</div>
	{/if}
</details>

<style>
	.tool-call {
		border-left: 1px solid var(--pau-border);
	}

	/*
	 * Consecutive tool calls read as one compact block under a shared rule.
	 * The previous row is another component instance, or a group of finished
	 * calls, so it is matched globally.
	 */
	:global(.tool-call) + .tool-call,
	:global(.tool-group) + .tool-call {
		margin-top: calc(-1 * var(--pau-space-5));
	}

	.tool-call summary {
		display: grid;
		grid-template-columns: 4rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3);
		color: var(--pau-text-muted);
		list-style-position: outside;
		cursor: pointer;
	}

	.tool-call summary::marker {
		color: var(--pau-info);
	}

	.tool-call--failed summary::marker,
	.tool-call--failed small {
		color: var(--pau-danger);
	}

	.tool-call code,
	.tool-call__command {
		color: var(--pau-text);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		font-variant-ligatures: none;
	}

	.tool-call summary code {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-call small {
		max-inline-size: 20rem;
		overflow: hidden;
		font-size: var(--pau-type-xs);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-call__body {
		display: grid;
		gap: var(--pau-space-2);
		padding: var(--pau-space-1) var(--pau-space-4) var(--pau-space-3);
	}

	.tool-call__command {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.tool-call__command span {
		color: var(--pau-text-muted);
	}

	.tool-call__note,
	.tool-call__meta {
		margin: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.tool-call__meta {
		display: flex;
		gap: var(--pau-space-3);
		font-variant-numeric: tabular-nums;
	}

	.tool-call__exit--failed {
		color: var(--pau-danger);
	}

	@media (max-width: 40rem) {
		.tool-call summary {
			grid-template-columns: 3.5rem minmax(0, 1fr);
		}

		.tool-call small {
			grid-column: 2;
		}
	}

	@media (pointer: coarse) {
		.tool-call summary {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
