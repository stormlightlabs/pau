<script lang="ts">
	import '../styles/tokens.css';

	import { anchorBox, placeAgainst } from './anchored-placement';
	import { formatCost, formatTokens } from './context-usage';
	import { dismissible } from './dismissal';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { formatBytes, formatCpu } from './resource-format';
	import { sessionStatusLabel } from './session-bay';
	import SessionStatusMark from './SessionStatusMark.svelte';
	import type { ProcessResourceNode, ProcessResourceSnapshot, ProcessUsage } from './types/resource-monitoring';
	import type { SessionViewModel, SessionWorkspace } from './types/session';

	type Props = {
		/** Pau's version. */
		version?: string;
		/** The workspace in view. Absent before any workspace opens. */
		workspace?: SessionWorkspace;
		/** The session in view, which belongs to `workspace`. */
		session?: SessionViewModel;
		/** The version the session's agent reports, such as Pi's. */
		agentVersion?: string;
		/** The latest resource sample. Absent until Pau has measured one. */
		usage?: ProcessUsage;
	};

	let { version, workspace, session, agentVersion, usage }: Props = $props();

	/** Changed files, when the workspace is a Git repository and its status is read. */
	const changes = $derived(workspace?.git?.repository ? workspace.git.files.length : undefined);
	const sessionTree = $derived(
		session ? usage?.sessions.find((snapshot) => snapshot.sessionId === session.id) : undefined
	);
	const context = $derived(session?.capabilities.usage ? session.usage?.context?.percent : undefined);
	const tokens = $derived(session?.capabilities.usage ? (session.usage?.tokens.total ?? 0) : 0);
	const cost = $derived(session?.capabilities.usage ? (session.usage?.cost ?? 0) : 0);

	function processes(count: number): string {
		return `${count} ${count === 1 ? 'process' : 'processes'}`;
	}

	/** The agent process first, then its children by memory, largest first. */
	function byMemory(tree: ProcessResourceSnapshot): ProcessResourceNode[] {
		const root = tree.processes.find((node) => tree.processes.every((other) => other.pid !== node.parentPid));
		return tree.processes.toSorted((left, right) =>
			left === root ? -1 : right === root ? 1 : right.residentMemoryBytes - left.residentMemoryBytes
		);
	}

	let open = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let panel = $state<HTMLElement>();
	let left = $state(0);
	let top = $state(0);
	let maxHeight = $state<number>();
	const focusReturn = createFocusReturn();

	function place(): void {
		if (!trigger || !panel) return;
		const placement = placeAgainst(anchorBox(trigger), panel.offsetWidth, panel.scrollHeight, 'above');
		({ left, top } = placement);
		maxHeight = placement.room;
	}

	// The panel joins the top layer and follows each new sample's height.
	$effect(() => {
		void usage;
		if (!open || !panel) return;
		if (!panel.matches(':popover-open')) {
			panel.showPopover();
			panel.focus({ preventScroll: true });
		}
		place();
	});

	function toggle(): void {
		if (open) close();
		else {
			focusReturn.capture(trigger);
			open = true;
		}
	}

	function close(restoreFocus = true): void {
		if (!open) return;
		open = false;
		if (restoreFocus) focusReturn.restore();
	}
</script>

<svelte:window onresize={place} />

<footer class="status-bar" aria-label="Status">
	<div class="status-bar__context">
		{#if workspace}
			<span class="status-bar__item status-bar__branch" title={workspace.branch ?? workspace.path ?? workspace.name}>
				<Icon name={workspace.branch ? 'gitBranch' : 'files'} size={14} />
				<span class="pau-visually-hidden">{workspace.branch ? 'Branch' : 'Workspace'}</span>
				<span class="pau-cap pau-cap--truncate">{workspace.branch ?? workspace.name}</span>
			</span>
			{#if changes !== undefined}
				<span class="status-bar__item"
					><span class="pau-cap">{changes === 0 ? 'No changes' : `${changes} changed`}</span></span>
			{/if}
			{#if workspace.sandbox}
				<span class="status-bar__item" title={workspace.sandbox.label}>
					<Icon name="sandbox" size={14} />
					<span class="pau-cap status-bar__collapse">{workspace.sandbox.sandboxed ? 'Sandboxed' : 'No sandbox'}</span>
				</span>
			{/if}
			<span class="status-bar__rule" aria-hidden="true"></span>
			{#if session}
				<span class="status-bar__item"
					><span class="pau-cap"
						>{session.agent}{#if agentVersion}<span class="status-bar__wide">&nbsp;{agentVersion}</span>{/if}</span
					></span>
				{#if context !== undefined}
					<span class="status-bar__item" title="Context window used"
						><span class="pau-cap"><span class="status-bar__collapse">Context&nbsp;</span>{Math.round(context)}%</span
						></span>
				{/if}
				{#if tokens > 0}
					<span class="status-bar__item status-bar__wide"
						><span class="pau-cap">{formatTokens(tokens)} tokens</span></span>
				{/if}
				{#if cost > 0}
					<span class="status-bar__item status-bar__wide" title="Session cost"
						><span class="pau-cap">{formatCost(cost)}</span></span>
				{/if}
				{#if sessionTree}
					<span class="status-bar__item" title="Agent and the processes it started">
						<span class="pau-cap"
							><span class="pau-visually-hidden">Session&nbsp;</span><span class="status-bar__collapse">CPU&nbsp;</span
							>{formatCpu(sessionTree.cpuPercent)} · {formatBytes(sessionTree.residentMemoryBytes)}<span
								class="status-bar__wide">&nbsp;· {processes(sessionTree.processCount)}</span
							></span>
					</span>
				{/if}
			{:else}
				<span class="status-bar__item"><span class="pau-cap">No session</span></span>
			{/if}
		{:else}
			<span class="status-bar__item"><span class="pau-cap">No workspace open</span></span>
		{/if}
	</div>

	<div
		class="status-bar__pau"
		{@attach open && dismissible({ close: () => close(false), restoreFocus: () => focusReturn.restore() })}>
		<button
			bind:this={trigger}
			type="button"
			class="status-bar__trigger pau-button pau-button--quiet"
			aria-haspopup="true"
			aria-expanded={open}
			onclick={toggle}>
			<span
				>Pau{#if version}<span class="status-bar__wide">&nbsp;{version}</span>{/if}</span>
			{#if usage}
				<span>
					<span class="status-bar__collapse">CPU&nbsp;</span>{formatCpu(usage.pau.cpuPercent)} · {formatBytes(
						usage.pau.residentMemoryBytes
					)}<span class="status-bar__wide">&nbsp;· {processes(usage.pau.processCount)}</span>
				</span>
			{/if}
			<Icon name="chevronDown" size={12} />
		</button>

		{#if open}
			<div
				bind:this={panel}
				popover="manual"
				class="status-bar__panel"
				style:left={`${left}px`}
				style:top={`${top}px`}
				style:max-height={maxHeight === undefined ? undefined : `${maxHeight}px`}
				role="group"
				aria-labelledby="status-bar-panel-title"
				tabindex="-1">
				<h2 class="pau-bay-heading"><span id="status-bar-panel-title" class="pau-section-label">Resource use</span></h2>
				{#if usage}
					<div class="pau-strip">
						<span></span>
						<span class="pau-strip__line"
							><span class="pau-strip__name">Pau</span>
							{#if version}<span class="pau-strip__agent">{version}</span>{/if}</span>
						<span class="pau-strip__meta">{processes(usage.pau.processCount)}</span>
						<span></span>
						<span class="pau-strip__state pau-mono"
							>CPU {formatCpu(usage.pau.cpuPercent)} · {formatBytes(usage.pau.residentMemoryBytes)}</span>
						<span class="pau-strip__figure pau-mono">peak {formatBytes(usage.pau.peakResidentMemoryBytes)}</span>
					</div>
					<h3 class="pau-bay-heading">
						<span class="pau-section-label">Sessions</span><span class="pau-count">{usage.sessions.length}</span>
					</h3>
					{#if usage.sessions.length === 0}
						<p class="status-bar__note">No sessions are running.</p>
					{:else}
						<ul class="status-bar__sessions">
							{#each usage.sessions as tree (tree.processId)}
								<li>
									<div class="pau-strip">
										<SessionStatusMark status={tree.status} label={sessionStatusLabel(tree.status)} />
										<span class="pau-strip__line"
											><span class="pau-strip__name pau-cap--truncate">{tree.label}</span><span class="pau-strip__agent"
												>{tree.kind}</span
											></span>
										<span class="pau-strip__meta">{processes(tree.processCount)}</span>
										<span></span>
										<span class="pau-strip__state pau-mono"
											>CPU {formatCpu(tree.cpuPercent)} · {formatBytes(tree.residentMemoryBytes)}</span>
										<span class="pau-strip__figure pau-mono">peak {formatBytes(tree.peakResidentMemoryBytes)}</span>
									</div>
									<ul aria-label={`Processes of ${tree.label}`}>
										{#each byMemory(tree) as node (node.pid)}
											<li class="pau-strip pau-strip--row status-bar__process">
												<span></span>
												<span class="pau-strip__name pau-mono pau-cap--truncate" title={`PID ${node.pid}`}
													>{node.name ?? `PID ${node.pid}`}</span>
												<span class="pau-strip__figure pau-mono"
													>{formatCpu(node.cpuPercent)} · {formatBytes(node.residentMemoryBytes)}</span>
											</li>
										{/each}
										{#if tree.processCount > tree.processes.length}
											<li class="pau-strip pau-strip--row status-bar__process">
												<span></span>
												<span class="pau-strip__agent">and {tree.processCount - tree.processes.length} more</span>
												<span></span>
											</li>
										{/if}
									</ul>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="status-bar__note">Resource use isn't measured.</p>
				{/if}
			</div>
		{/if}
	</div>
</footer>

<style>
	/*
	 * One 32px row across the foot of the window. The workspace and session
	 * figures start at the bay's leading edge, and the Pau button ends at the
	 * window's trailing edge. The button fills the bar's height, so the bar
	 * keeps the 32px control height without an inset.
	 */
	.status-bar {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: var(--pau-space-4);
		min-width: 0;
		/* The rule sits outside the 32px row, so the Pau button keeps its full height. */
		height: calc(var(--pau-size-row-md) + 1px);
		padding-inline: var(--pau-space-4) 0;
		color: var(--pau-text-muted);
		background-color: var(--pau-surface);
		border-top: 1px solid var(--pau-border);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		font-variant-ligatures: none;
		font-variant-numeric: tabular-nums;
		line-height: var(--pau-leading-tight);
	}

	.status-bar__context {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--pau-space-4);
		min-width: 0;
		overflow: hidden;
	}

	.status-bar__item {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: var(--pau-space-1);
		white-space: nowrap;
	}

	.status-bar__item > :global(.pau-icon) {
		flex: none;
	}

	/* The branch gives up its width first, and keeps its full name up to a cap. */
	.status-bar__branch {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 28ch;
	}

	.status-bar__rule {
		flex: none;
		width: 1px;
		height: var(--pau-space-4);
		background-color: var(--pau-border);
	}

	.status-bar__pau {
		flex: none;
		height: 100%;
	}

	.status-bar__trigger {
		height: 100%;
		border-radius: 0;
		font-family: inherit;
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-regular);
	}

	.status-bar__panel {
		position: fixed;
		inset: auto;
		box-sizing: border-box;
		width: 22.5rem;
		margin: 0;
		padding: 0 0 var(--pau-space-2);
		overflow-y: auto;
		overscroll-behavior: contain;
		color: var(--pau-text);
		background-color: var(--pau-surface-overlay);
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-overlay);
		box-shadow: var(--pau-shadow-overlay);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		font-variant-numeric: normal;
		line-height: var(--pau-leading-row);
	}

	.status-bar__panel:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.status-bar__panel ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* A child process sits under its session's name, in the strip's main column. */
	.status-bar__process {
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		column-gap: var(--pau-space-3);
	}

	.status-bar__note {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-4);
		color: var(--pau-text-muted);
	}

	/*
	 * Below 1200px the bar keeps every item but drops words: labels such as
	 * CPU and Context leave the screen but stay in the accessible name, and
	 * versions, token and cost totals and process counts move to the panel or
	 * the composer's status line.
	 */
	@media (max-width: 1199.98px) {
		.status-bar__wide {
			display: none;
		}

		.status-bar__collapse {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
