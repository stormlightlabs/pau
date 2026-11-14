<script lang="ts">
	import '../styles/tokens.css';
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	import type { ThemeName, UiFontName } from '../theme';
	import ApplicationShell, { type ShellNavItem, type ShellPaneWidths } from './ApplicationShell.svelte';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';
	import MetaText from './MetaText.svelte';
	import {
		NO_RESOURCE_FILTER,
		RESOURCE_KIND_LABELS,
		RESOURCE_KINDS,
		TRUST_LABELS,
		countByKind,
		filterResources,
		resourceAttention,
		type ResourceFilter
	} from './resource-browser';
	import Select, { type SelectOption } from './Select.svelte';
	import type { ResourceEntry, ResourceIndex, ResourceKind, ResourceScope, ResourceTrust } from './types/resources';
	import ViewHeader from './ViewHeader.svelte';

	type Props = {
		workspaceName: string;
		/** The view: which kind of resource the list shows. */
		kind: ResourceKind;
		/** Where each view's rail item links. */
		kindHref: (kind: ResourceKind) => string;
		/** The loaded index. Absent while loading or after an error. */
		index?: ResourceIndex;
		/** Why the index could not be loaded. */
		error?: string;
		onRetry?: () => void;
		productItems?: ShellNavItem[];
		disconnected?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		paneWidths?: ShellPaneWidths;
		onPaneResize?: (widths: ShellPaneWidths) => void;
	};

	let {
		workspaceName,
		kind,
		kindHref,
		index,
		error,
		onRetry,
		productItems = [],
		disconnected = false,
		theme,
		uiFont,
		paneWidths,
		onPaneResize
	}: Props = $props();

	const SCOPE_LABELS: Record<ResourceScope, string> = { user: 'User', project: 'Project' };
	const SOURCE_LABELS: Record<ResourceEntry['source_kind'], string> = {
		directory: 'Folder',
		setting: 'Settings',
		package: 'Package'
	};
	/** What each kind can do once Pi loads it. */
	const KIND_NOTES: Record<ResourceKind, string> = {
		skill: 'Instructions Pi reads when a task matches the description. A skill folder can also hold scripts.',
		prompt: 'A prompt template you run as a slash command in a session.',
		extension: "Code that runs inside Pi with your account's permissions.",
		theme: "Colors for Pi's terminal interface. Pau's own theme is set in Settings.",
		package: "A bundle of skills, prompts, extensions, or themes. Its extensions run with your account's permissions."
	};
	const scopeOptions: SelectOption<ResourceScope | 'all'>[] = [
		{ value: 'all', label: 'All scopes' },
		{ value: 'user', label: 'User' },
		{ value: 'project', label: 'Project' }
	];
	const trustOptions: SelectOption<ResourceTrust | 'all'>[] = [
		{ value: 'all', label: 'Any trust' },
		...(Object.entries(TRUST_LABELS) as [ResourceTrust, string][]).map(([value, label]) => ({ value, label }))
	];

	/** Below the shell's docking width the detail replaces the list instead of filling the inspector. */
	const narrow = new MediaQuery('max-width: 74rem');

	let filter = $state<ResourceFilter>({ ...NO_RESOURCE_FILTER });
	let selectedId = $state<string>();
	/** The resource whose detail fills the main surface on narrow windows. */
	let openedId = $state<string>();
	let list = $state<HTMLElement>();

	let label = $derived(RESOURCE_KIND_LABELS[kind]);
	let noun = $derived(label.toLowerCase());
	let counts = $derived(countByKind(index?.resources ?? []));
	let visible = $derived(index ? filterResources(index.resources, kind, filter) : []);
	let filtered = $derived(filter.query.trim() !== '' || filter.scope !== 'all' || filter.trust !== 'all');
	let selected = $derived(visible.find((resource) => resource.id === selectedId) ?? visible[0]);
	let opened = $derived(narrow.current ? visible.find((resource) => resource.id === openedId) : undefined);
	let untrustedProject = $derived(
		index !== undefined &&
			index.project_trust !== 'trusted' &&
			index.resources.some((resource) => resource.kind === kind && resource.scope === 'project')
	);

	let contextItems = $derived<ShellNavItem[]>(
		RESOURCE_KINDS.map((candidate) => ({
			id: candidate,
			label: RESOURCE_KIND_LABELS[candidate],
			href: kindHref(candidate),
			count: index ? counts[candidate] : undefined,
			active: candidate === kind
		}))
	);

	function rowId(resource: ResourceEntry): string {
		return `resource-${encodeURIComponent(resource.id)}`;
	}

	function focusRow(resource: ResourceEntry | undefined): void {
		if (resource) list?.querySelector<HTMLElement>(`#${CSS.escape(rowId(resource))}`)?.focus();
	}

	function choose(resource: ResourceEntry): void {
		selectedId = resource.id;
		if (narrow.current) void open(resource);
	}

	async function open(resource: ResourceEntry): Promise<void> {
		openedId = resource.id;
		await tick();
		document.getElementById('resource-detail-back')?.focus();
	}

	async function closeDetail(): Promise<void> {
		const returning = opened;
		openedId = undefined;
		await tick();
		focusRow(returning);
	}

	/** Arrow keys, Home, and End move the selection; Enter and Space choose through the button's click. */
	function moveSelection(event: KeyboardEvent, current: ResourceEntry): void {
		const position = visible.indexOf(current);
		const target = {
			ArrowDown: Math.min(position + 1, visible.length - 1),
			ArrowUp: Math.max(position - 1, 0),
			Home: 0,
			End: visible.length - 1
		}[event.key];
		if (target === undefined) return;
		event.preventDefault();
		selectedId = visible[target]!.id;
		focusRow(visible[target]);
	}

	function statusText(resource: ResourceEntry): string {
		if (resource.status === 'duplicate')
			return `Not loaded. Another ${resource.kind} named ${resource.name} loads first.`;
		if (resource.status === 'invalid') return 'Not loaded. The file has errors listed under Warnings.';
		if (resource.status === 'missing') return "Not installed, so Pi can't load anything from it.";
		if (resource.kind === 'package') return 'Installed';
		return resource.trust === 'trusted' ? 'Loads' : 'Not loaded until you trust the workspace.';
	}

	/** Describes the scope's trust only; whether the resource loads is the status line's job. */
	function trustText(resource: ResourceEntry): string {
		if (resource.scope === 'user') return 'Trusted. Your own resources need no trust decision.';
		if (resource.trust === 'trusted') return "Trusted. Pi reads this workspace's project resources.";
		if (resource.trust === 'untrusted')
			return 'Not trusted. You declined this workspace, so Pi skips its project resources.';
		return 'Not decided. Pi skips project resources until you trust the workspace with /trust in Pi.';
	}
</script>

{#snippet detail(resource: ResourceEntry)}
	{@const attention = resourceAttention(resource)}
	<!-- Escape returns from the narrow detail view to the list. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		class="resource-detail"
		aria-labelledby="resource-detail-title"
		onkeydown={(event) => {
			if (!opened || event.key !== 'Escape' || event.defaultPrevented) return;
			event.preventDefault();
			void closeDetail();
		}}>
		{#if opened}
			<button
				id="resource-detail-back"
				type="button"
				class="resource-detail__back pau-button pau-button--quiet"
				onclick={() => void closeDetail()}>
				<Icon name="chevronLeft" size={16} />Back to {label}
			</button>
		{/if}
		<header>
			<h2 id="resource-detail-title">{resource.name}</h2>
			<p><MetaText text={`${SCOPE_LABELS[resource.scope]} ${resource.kind}`} /></p>
		</header>
		{#if attention}
			<p class={['resource-detail__attention', `resource-detail__attention--${attention.tone}`]}>
				{attention.label}
			</p>
		{/if}
		{#if resource.description}<p class="resource-detail__description">{resource.description}</p>{/if}
		<p class="resource-detail__note">{KIND_NOTES[resource.kind]}</p>
		<dl>
			<div>
				<dt>Status</dt>
				<dd>{statusText(resource)}</dd>
			</div>
			<div>
				<dt>Trust</dt>
				<dd>{trustText(resource)}</dd>
			</div>
			<div>
				<dt>Source</dt>
				<dd>
					{SOURCE_LABELS[resource.source_kind]}
					<code>{resource.source}</code>
				</dd>
			</div>
			{#if resource.path}
				<div>
					<dt>{resource.kind === 'package' ? 'Installed in' : 'File'}</dt>
					<dd><code>{resource.path}</code></dd>
				</div>
			{/if}
			{#if resource.winner}
				<div>
					<dt>Loads instead</dt>
					<dd><code>{resource.winner}</code></dd>
				</div>
			{/if}
		</dl>
		{#if resource.warnings.length > 0}
			<h3>Warnings</h3>
			<ul class="resource-detail__warnings">
				{#each resource.warnings as warning, position (position)}
					<li>{warning}</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#snippet inspectorDetail()}
	{#if selected}{@render detail(selected)}{/if}
{/snippet}

<ApplicationShell
	{workspaceName}
	contextLabel="Resources"
	{productItems}
	{contextItems}
	{disconnected}
	{theme}
	{uiFont}
	{paneWidths}
	onResize={onPaneResize}
	inspector={selected && !narrow.current ? inspectorDetail : undefined}>
	<section class="resources" aria-labelledby="resources-title">
		{#if opened}
			{@render detail(opened)}
		{:else}
			<ViewHeader eyebrow={workspaceName} title={label} titleId="resources-title">
				{#snippet meta()}
					{#if index}
						<span class="resources__count" aria-live="polite">
							{filtered ? `${visible.length} of ${counts[kind]}` : counts[kind]}
							{counts[kind] === 1 ? noun.slice(0, -1) : noun}
						</span>
					{/if}
				{/snippet}
			</ViewHeader>

			{#if error}
				<EmptyState title="Resources couldn't be loaded" role="alert">
					<p>{error}</p>
					<button type="button" class="pau-button pau-button--secondary" onclick={() => onRetry?.()}>Try again</button>
				</EmptyState>
			{:else if !index}
				<EmptyState title="Loading resources" role="status">
					<p>Reading Pi's user and project folders.</p>
				</EmptyState>
			{:else}
				{#if untrustedProject}
					<p class="resources__trust" role="status">
						{index.project_trust === 'untrusted'
							? "You declined to trust this workspace, so Pi skips its project resources. They're listed here so you can review them."
							: "Pi skips this workspace's project resources until you trust it with /trust in Pi. Review them here first."}
					</p>
				{/if}

				{#if counts[kind] > 0}
					<div class="resources__filters" role="search" aria-label={`Filter ${noun}`}>
						<label class="resources__query">
							<span class="resources__sr-only">Filter by name</span>
							<Icon name="search" size={16} />
							<input
								type="search"
								placeholder="Filter by name"
								bind:value={filter.query}
								onkeydown={(event) => {
									if (!selected || event.key !== 'ArrowDown') return;
									event.preventDefault();
									selectedId = selected.id;
									focusRow(selected);
								}} />
						</label>
						<Select label="Scope" options={scopeOptions} bind:value={filter.scope} />
						<Select label="Trust" options={trustOptions} bind:value={filter.trust} />
					</div>
				{/if}

				{#if counts[kind] === 0}
					<EmptyState title={`No ${noun} found`}>
						<p>
							{kind === 'package'
								? "Pi's user and project settings list no packages."
								: `Pi looks for ${noun} in its user and project folders, in paths its settings list, and in installed packages.`}
						</p>
					</EmptyState>
				{:else if visible.length === 0}
					<EmptyState title={`No ${noun} match these filters`}>
						<button
							type="button"
							class="pau-button pau-button--secondary"
							onclick={() => (filter = { ...NO_RESOURCE_FILTER })}>Clear filters</button>
					</EmptyState>
				{:else}
					<div class="resources__columns" aria-hidden="true">
						<span>Name</span><span>Scope</span><span>Source</span><span>State</span>
					</div>
					<div class="resources__list" role="listbox" aria-label={label} bind:this={list}>
						{#each visible as resource (resource.id)}
							{@const attention = resourceAttention(resource)}
							{@const isSelected = resource.id === selected?.id}
							<button
								id={rowId(resource)}
								type="button"
								role="option"
								aria-selected={isSelected}
								tabindex={isSelected ? 0 : -1}
								class="resource-row pau-row"
								class:resource-row--selected={isSelected}
								onkeydown={(event) => moveSelection(event, resource)}
								onclick={() => choose(resource)}>
								<span class="resource-row__name">
									<strong>{resource.name}</strong>
									{#if resource.description}<small>{resource.description}</small>{/if}
								</span>
								<span class="resource-row__scope">{SCOPE_LABELS[resource.scope]}</span>
								<!-- Paths lose their useful end when truncated, so the row names the source kind and the detail shows the path. -->
								<span class="resource-row__source" title={resource.source}>
									{#if resource.source_kind === 'package'}
										<MetaText text={`Package · ${resource.source}`} />
									{:else}
										{SOURCE_LABELS[resource.source_kind]}
									{/if}
								</span>
								<span class={['resource-row__state', attention && `resource-row__state--${attention.tone}`]}>
									{attention?.label ?? 'Loads'}
								</span>
							</button>
						{/each}
					</div>
				{/if}

				{#if index.warnings.length > 0}
					<section class="resources__warnings" aria-labelledby="resources-warnings-title">
						<h2 id="resources-warnings-title">Discovery warnings</h2>
						<ul>
							{#each index.warnings as warning, position (position)}
								<li><code>{warning.path}</code><span>{warning.message}</span></li>
							{/each}
						</ul>
					</section>
				{/if}
			{/if}
		{/if}
	</section>
</ApplicationShell>

<style>
	.resources {
		container-type: inline-size;
		min-width: 0;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		--empty-state-inset: var(--pau-space-3);
	}

	.resources__count {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
		font-variant-numeric: tabular-nums;
	}

	.resources__trust {
		margin: 0 var(--pau-space-3) var(--pau-space-4);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text);
		border-left: 3px solid var(--pau-warning);
		background: var(--pau-surface-raised);
		line-height: 1.5;
	}

	.resources__filters {
		display: grid;
		grid-template-columns: minmax(12rem, 1fr) minmax(9rem, auto) minmax(9rem, auto);
		align-items: center;
		gap: var(--pau-space-2);
		margin-bottom: var(--pau-space-4);
		padding-inline: var(--pau-space-3);
	}

	.resources__query {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		color: var(--pau-text-muted);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control, 3px);
	}

	.resources__query:focus-within {
		border-color: var(--pau-focus);
		box-shadow: 0 0 0 1px var(--pau-focus);
	}

	.resources__query input {
		width: 100%;
		min-width: 0;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
	}

	.resources__query input::placeholder {
		color: var(--pau-text-muted);
	}

	.resources__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.resources__columns,
	.resource-row {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) 5rem minmax(0, 1fr) 8.5rem;
		align-items: center;
		gap: var(--pau-space-3);
		padding-inline: var(--pau-space-3);
	}

	.resources__columns {
		min-height: var(--pau-size-row-lg);
		color: var(--pau-text-muted);
		border-bottom: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	.resource-row {
		width: 100%;
		min-height: 3.25rem;
		padding-block: var(--pau-space-2);
		color: var(--pau-text);
		border: 0;
		border-bottom: 1px solid var(--pau-border);
		box-shadow: inset 2px 0 transparent;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}

	.resource-row--selected {
		background-color: var(--pau-surface-raised);
		box-shadow: inset 2px 0 var(--pau-focus);
	}

	.resource-row:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: calc(var(--pau-focus-width) * -1);
	}

	.resource-row > span {
		min-width: 0;
	}

	.resource-row__name {
		display: grid;
	}

	.resource-row__name strong,
	.resource-row__name small,
	.resource-row__source {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.resource-row__name strong {
		font-weight: var(--pau-weight-semibold);
	}

	.resource-row small,
	.resource-row__scope,
	.resource-row__source,
	.resource-row__state {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.resource-row__state--warning,
	.resource-detail__attention--warning {
		color: var(--pau-warning) !important;
	}

	.resource-row__state--danger,
	.resource-detail__attention--danger {
		color: var(--pau-danger) !important;
	}

	.resources__warnings {
		margin-top: var(--pau-space-5);
		padding-inline: var(--pau-space-3);
	}

	.resources__warnings h2,
	.resource-detail h3 {
		margin: 0 0 var(--pau-space-2);
		font-size: var(--pau-type-sm);
		font-weight: var(--pau-weight-semibold);
	}

	.resources__warnings ul,
	.resource-detail__warnings {
		display: grid;
		gap: var(--pau-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--pau-type-sm);
	}

	.resources__warnings li {
		display: grid;
		color: var(--pau-text-muted);
	}

	code {
		overflow-wrap: anywhere;
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
	}

	.resources__warnings code {
		color: var(--pau-text);
	}

	.resource-detail {
		display: grid;
		align-content: start;
		gap: var(--pau-space-3);
		min-width: 0;
		/* The inspector already insets its content by the rail inset. */
		padding: var(--pau-space-1) 0 var(--pau-space-4);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	.resource-detail__back {
		justify-self: start;
		gap: var(--pau-space-1);
		/* The icon starts on the content edge, under the title. */
		margin-left: calc(var(--pau-space-3) * -1);
	}

	.resource-detail header {
		display: grid;
		gap: var(--pau-space-1);
	}

	.resource-detail h2 {
		margin: 0;
		font-size: var(--pau-type-lg);
		overflow-wrap: anywhere;
	}

	.resource-detail p {
		margin: 0;
		line-height: 1.5;
	}

	.resource-detail header p,
	.resource-detail__note,
	.resource-detail dt {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.resource-detail__attention {
		font-size: var(--pau-type-sm);
		font-weight: var(--pau-weight-semibold);
	}

	.resource-detail dl {
		display: grid;
		gap: var(--pau-space-3);
		margin: var(--pau-space-1) 0 0;
	}

	.resource-detail dd {
		display: grid;
		gap: var(--pau-space-1);
		margin: var(--pau-space-1) 0 0;
		font-size: var(--pau-type-sm);
		line-height: 1.5;
	}

	.resource-detail__warnings li {
		padding-left: var(--pau-space-2);
		border-left: 2px solid var(--pau-warning);
		line-height: 1.5;
	}

	/* The main-surface detail keeps a readable measure on narrow windows. */
	.resources > .resource-detail {
		max-width: 44rem;
		padding-inline: var(--pau-space-3);
	}

	/* Below the width four columns need, each row stacks its facts under the name. */
	@container (max-width: 40rem) {
		.resources__filters {
			grid-template-columns: 1fr 1fr;
		}

		.resources__query {
			grid-column: 1 / -1;
		}

		.resources__columns {
			display: none;
		}

		.resource-row {
			grid-template-columns: auto minmax(0, 1fr) auto;
			row-gap: var(--pau-space-1);
		}

		.resource-row__name {
			grid-column: 1 / -1;
		}
	}
</style>
