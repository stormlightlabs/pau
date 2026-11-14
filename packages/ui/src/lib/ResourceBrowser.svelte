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
	let queryInput = $state<HTMLInputElement>();

	/** Clearing unmounts the Clear filters button, so focus moves to the query field. */
	function clearFilters() {
		filter = { ...NO_RESOURCE_FILTER };
		queryInput?.focus();
	}

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
		<header class="resource-detail__header">
			<h2 id="resource-detail-title">{resource.name}</h2>
			<p class="resource-detail__kind">
				<MetaText text={`${SCOPE_LABELS[resource.scope]} ${resource.kind}`} />
				{#if attention}
					<span class={['resource-detail__attention', `resource-detail__attention--${attention.tone}`]}>
						{attention.label}
					</span>
				{/if}
			</p>
		</header>
		<section class="resource-detail__section" aria-labelledby="resource-detail-about">
			<h3 id="resource-detail-about" class="pau-section-label">About</h3>
			{#if resource.description}<p class="resource-detail__description">{resource.description}</p>{/if}
			<p class="resource-detail__note">{KIND_NOTES[resource.kind]}</p>
		</section>
		<section class="resource-detail__section" aria-labelledby="resource-detail-facts">
			<h3 id="resource-detail-facts" class="pau-section-label">Details</h3>
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
		</section>
		{#if resource.warnings.length > 0}
			<section class="resource-notice" aria-labelledby="resource-detail-warnings">
				<Icon name="warning" size={16} />
				<h3 id="resource-detail-warnings" class="resource-notice__title">Warnings</h3>
				<ul class="resource-notice__body">
					{#each resource.warnings as warning, position (position)}
						<li>{warning}</li>
					{/each}
				</ul>
			</section>
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
					<section class="resource-notice resources__trust" role="status" aria-labelledby="resources-trust-title">
						<Icon name="warning" size={16} />
						<h2 id="resources-trust-title" class="resource-notice__title">
							<span class="resources__sr-only">Warning:</span>
							{index.project_trust === 'untrusted' ? 'Workspace not trusted' : 'Workspace not trusted yet'}
						</h2>
						<p class="resource-notice__body">
							{index.project_trust === 'untrusted'
								? "You declined to trust this workspace, so Pi skips its project resources. They're listed here so you can review them."
								: "Pi skips this workspace's project resources until you trust it with /trust in Pi. Review them here first."}
						</p>
					</section>
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
								bind:this={queryInput}
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
						<button type="button" class="pau-button pau-button--secondary" onclick={clearFilters}>Clear filters</button>
					</EmptyState>
				{:else}
					<div class="resources__columns pau-section-label" aria-hidden="true">
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
					<section class="resource-notice resources__warnings" aria-labelledby="resources-warnings-title">
						<Icon name="warning" size={16} />
						<h2 id="resources-warnings-title" class="resource-notice__title">Discovery warnings</h2>
						<ul class="resource-notice__body">
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
	/*
	 * Vertical rhythm: the view header ends `space/5` above the first group.
	 * The trust notice is its own group, `space/5` above the filters. The filter
	 * bar sits `space/4` above the list it narrows, and the discovery warnings
	 * start `space/6` below the list as a separate task. Everything shares the
	 * header's `space/3` inset.
	 */
	.resources {
		--row-name-line: 1.25rem;
		--row-meta-line: 1.125rem;
		container-type: inline-size;
		min-width: 0;
		padding-bottom: var(--pau-space-6);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		--empty-state-inset: var(--pau-space-3);
	}

	.resources__count {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
		font-variant-numeric: tabular-nums;
	}

	/*
	 * A warning notice follows the agent readiness notice: a bordered surface
	 * with a warning leading edge. The icon centers on the title's line and the
	 * body starts under the title, so the text keeps one leading edge.
	 */
	.resource-notice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		column-gap: var(--pau-space-2);
		row-gap: var(--pau-space-1);
		padding: var(--pau-space-3) var(--pau-space-4);
		border: var(--pau-border-thin) solid var(--pau-border);
		border-inline-start: 2px solid var(--pau-warning);
		border-radius: var(--pau-radius-surface);
		background: var(--pau-surface);
	}

	.resource-notice > :global(.pau-icon) {
		color: var(--pau-warning);
	}

	.resource-notice__title {
		margin: 0;
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-semibold);
		line-height: var(--row-name-line);
	}

	.resource-notice__body {
		grid-column: 2;
		margin: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
		line-height: 1.5;
	}

	ul.resource-notice__body {
		display: grid;
		gap: var(--pau-space-2);
		padding: 0;
		list-style: none;
	}

	.resources__trust,
	.resources__warnings {
		margin-inline: var(--pau-space-3);
	}

	.resources__trust {
		margin-bottom: var(--pau-space-5);
	}

	.resources__warnings {
		margin-top: var(--pau-space-6);
	}

	.resources__warnings li {
		display: grid;
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
		min-height: var(--pau-size-row-md);
		border-bottom: 1px solid var(--pau-border);
	}

	/*
	 * Every row is as tall as a name over a description, so rows keep one
	 * rhythm and a row without a description centers its name. A button is
	 * border-box, so the height also counts the row's bottom rule.
	 */
	.resource-row {
		width: 100%;
		min-height: calc(var(--row-name-line) + var(--row-meta-line) + 2 * var(--pau-space-2) + 1px);
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
		line-height: var(--row-meta-line);
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
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-medium);
		line-height: var(--row-name-line);
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

	code {
		overflow-wrap: anywhere;
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
	}

	.resources__warnings code {
		color: var(--pau-text);
	}

	/*
	 * The detail stacks a header and labelled sections. Sections sit `space/4`
	 * apart behind a rule, a label sits `space/2` above its content, and each
	 * fact keeps its value `space/1` under its name.
	 */
	.resource-detail {
		display: grid;
		align-content: start;
		gap: var(--pau-space-4);
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

	.resource-detail__header {
		display: grid;
		gap: var(--pau-space-1);
	}

	.resource-detail h2 {
		margin: 0;
		font-size: var(--pau-type-lg);
		font-weight: var(--pau-weight-semibold);
		overflow-wrap: anywhere;
	}

	.resource-detail p {
		margin: 0;
		line-height: 1.5;
	}

	.resource-detail__kind {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.resource-detail__attention {
		font-weight: var(--pau-weight-semibold);
	}

	.resource-detail__section {
		display: grid;
		gap: var(--pau-space-2);
		padding-top: var(--pau-space-4);
		border-top: 1px solid var(--pau-border);
	}

	.resource-detail__section h3 {
		margin: 0;
	}

	.resource-detail__note,
	.resource-detail dt {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.resource-detail dl {
		display: grid;
		gap: var(--pau-space-3);
		margin: 0;
	}

	.resource-detail dd {
		display: grid;
		gap: var(--pau-space-1);
		margin: var(--pau-space-1) 0 0;
		font-size: var(--pau-type-sm);
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

		/* Rows keep the described height, and a row without a description centers its content. */
		.resource-row {
			grid-template-columns: auto minmax(0, 1fr) auto;
			align-content: center;
			row-gap: var(--pau-space-1);
			min-height: calc(
				var(--row-name-line) + 2 * var(--row-meta-line) + var(--pau-space-1) + 2 * var(--pau-space-2) + 1px
			);
		}

		.resource-row__name {
			grid-column: 1 / -1;
		}
	}
</style>
