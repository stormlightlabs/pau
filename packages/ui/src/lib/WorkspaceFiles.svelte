<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import type { IconKind } from '../icons';
	import type {
		WorkspaceFileEntry,
		WorkspaceFileSource,
		WorkspaceSearchMatch,
		WorkspaceTraversalOptions
	} from './types/workspace-files';
	import ApplicationShell, { type ShellNavItem } from './ApplicationShell.svelte';
	import Icon from './Icon.svelte';

	type DirectoryState = { entries: WorkspaceFileEntry[]; error?: string; loading: boolean };

	type VisibleEntry = WorkspaceFileEntry & { depth: number };

	type Props = {
		workspaceId: string;
		workspaceName: string;
		source: WorkspaceFileSource;
		disconnected?: boolean;
		onOpenFile?: (path: string, line?: number) => void;
	};

	let { workspaceId, workspaceName, source, disconnected = false, onOpenFile }: Props = $props();

	const productItems: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents' },
		{ id: 'files', label: 'Files', icon: 'files', active: true },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	let directories = $state<Record<string, DirectoryState>>({});
	let expanded = new SvelteSet<string>();
	let activePath = $state('');
	let selectedPath = $state<string>();
	let includeHidden = $state(false);
	let includeIgnored = $state(false);
	let query = $state('');
	let submittedQuery = $state('');
	let searchResults = $state<WorkspaceSearchMatch[]>([]);
	let searchLoading = $state(false);
	let searchError = $state('');
	let requestVersion = 0;
	let tree = $state<HTMLElement>();

	let traversalOptions = $derived<WorkspaceTraversalOptions>({ includeHidden, includeIgnored });
	let root = $derived(directories['']);
	let visibleEntries = $derived.by(() => {
		const rows: VisibleEntry[] = [];
		const append = (directory: string, depth: number): void => {
			const entries = directories[directory]?.entries ?? [];
			for (const entry of entries) {
				rows.push({ ...entry, depth });
				if (entry.kind === 'directory' && expanded.has(entry.path)) append(entry.path, depth + 1);
			}
		};
		append('', 1);
		return rows;
	});

	onMount(() => {
		void reloadTree();
	});

	function errorCode(error: unknown): string | undefined {
		return typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code: unknown }).code)
			: undefined;
	}

	function errorMessage(error: unknown): string {
		if (errorCode(error) === 'permission_denied') {
			return 'Pau cannot read this folder. Check its file permissions and try again.';
		}
		return error instanceof Error ? error.message : 'Pau could not load this folder.';
	}

	async function loadDirectory(path: string, version = requestVersion): Promise<void> {
		directories[path] = { entries: directories[path]?.entries ?? [], loading: true };
		try {
			const entries = await source.listDirectory(path, traversalOptions);
			if (version !== requestVersion) return;
			directories[path] = { entries, loading: false };
			if (!activePath && entries[0]) activePath = entries[0].path;
		} catch (error) {
			if (version !== requestVersion) return;
			directories[path] = { entries: [], error: errorMessage(error), loading: false };
		}
	}

	async function reloadTree(): Promise<void> {
		requestVersion += 1;
		directories = {};
		expanded.clear();
		activePath = '';
		await loadDirectory('', requestVersion);
	}

	function setVisibility(option: 'hidden' | 'ignored', checked: boolean): void {
		if (option === 'hidden') includeHidden = checked;
		else includeIgnored = checked;
		void reloadTree();
		if (submittedQuery) void runSearch();
	}

	async function toggleDirectory(entry: WorkspaceFileEntry): Promise<void> {
		activePath = entry.path;
		if (expanded.has(entry.path)) {
			expanded.delete(entry.path);
			return;
		}
		expanded.add(entry.path);
		if (directories[entry.path] === undefined) await loadDirectory(entry.path);
	}

	function selectEntry(entry: WorkspaceFileEntry): void {
		activePath = entry.path;
		if (entry.kind === 'directory') {
			void toggleDirectory(entry);
		} else {
			selectedPath = entry.path;
			onOpenFile?.(entry.path);
		}
	}

	async function focusRow(index: number): Promise<void> {
		activePath = visibleEntries[index]?.path ?? activePath;
		await tick();
		tree?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus();
	}

	function parentPath(path: string): string {
		return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	}

	function handleTreeKeydown(event: KeyboardEvent, entry: WorkspaceFileEntry): void {
		const index = visibleEntries.findIndex((candidate) => candidate.path === entry.path);
		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				void focusRow(Math.min(index + 1, visibleEntries.length - 1));
				break;
			}
			case 'ArrowUp': {
				event.preventDefault();
				void focusRow(Math.max(index - 1, 0));
				break;
			}
			case 'Home': {
				event.preventDefault();
				void focusRow(0);
				break;
			}
			case 'End': {
				event.preventDefault();
				void focusRow(visibleEntries.length - 1);
				break;
			}
			case 'ArrowRight': {
				if (entry.kind !== 'directory') break;
				event.preventDefault();
				if (!expanded.has(entry.path)) void toggleDirectory(entry);
				else if (visibleEntries[index + 1]?.path.startsWith(`${entry.path}/`)) void focusRow(index + 1);
				break;
			}
			case 'ArrowLeft': {
				event.preventDefault();
				if (entry.kind === 'directory' && expanded.has(entry.path)) {
					expanded.delete(entry.path);
				} else {
					const parent = parentPath(entry.path);
					const parentIndex = visibleEntries.findIndex((candidate) => candidate.path === parent);
					if (parentIndex !== -1) void focusRow(parentIndex);
				}
				break;
			}
		}
	}

	async function runSearch(): Promise<void> {
		submittedQuery = query.trim();
		searchError = '';
		searchResults = [];
		if (!submittedQuery) return;
		searchLoading = true;
		try {
			searchResults = await source.search(submittedQuery, traversalOptions);
		} catch (error) {
			searchError = errorMessage(error);
		} finally {
			searchLoading = false;
		}
	}

	function fileIcon(entry: WorkspaceFileEntry): IconKind {
		if (entry.kind === 'directory') return expanded.has(entry.path) ? 'folderOpen' : 'files';
		if (entry.kind === 'symlink') return 'symlink';
		const extension = entry.path.split('.').at(-1)?.toLowerCase();
		if (extension === 'ts' || extension === 'tsx') return 'fileTypeScript';
		if (extension === 'js' || extension === 'jsx') return 'fileJavaScript';
		if (extension === 'svelte') return 'fileSvelte';
		if (extension === 'css') return 'fileCss';
		if (extension === 'html') return 'fileHtml';
		if (extension === 'json') return 'fileJson';
		if (extension === 'md' || extension === 'mdx') return 'fileMarkdown';
		if (extension === 'rs') return 'fileRust';
		if (extension === 'toml') return 'fileToml';
		if (extension === 'yaml' || extension === 'yml') return 'fileYaml';
		if (['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension ?? '')) return 'fileImage';
		return 'file';
	}

	function basename(path: string): string {
		return path.split('/').at(-1) ?? path;
	}
</script>

<ApplicationShell
	{workspaceName}
	contextLabel="Files"
	{productItems}
	contextItems={[]}
	{disconnected}
	inspectorOpen={false}>
	{#snippet context()}
		<section class="workspace-files__browser" aria-label="Workspace files">
			<form
				class="workspace-files__search"
				role="search"
				onsubmit={(event) => {
					event.preventDefault();
					void runSearch();
				}}>
				<label for={`workspace-search-${workspaceId}`}>Search files</label>
				<div>
					<Icon name="search" size={16} />
					<input id={`workspace-search-${workspaceId}`} type="search" bind:value={query} placeholder="Text in files" />
				</div>
			</form>

			<fieldset class="workspace-files__visibility">
				<legend>File visibility</legend>
				<label>
					<input
						type="checkbox"
						checked={includeHidden}
						onchange={(event) => setVisibility('hidden', event.currentTarget.checked)} />
					Show hidden files
				</label>
				<label>
					<input
						type="checkbox"
						checked={includeIgnored}
						onchange={(event) => setVisibility('ignored', event.currentTarget.checked)} />
					Show ignored files
				</label>
			</fieldset>

			<div class="workspace-files__tree-header">
				<span>Workspace</span>
				{#if root && !root.loading}<small>{root.entries.length}</small>{/if}
			</div>

			{#if !root || root.loading}
				<p class="workspace-files__state" role="status">Loading workspace files…</p>
			{:else if root.error}
				<div class="workspace-files__state workspace-files__state--error" role="alert">
					<p>{root.error}</p>
					<button type="button" onclick={() => reloadTree()}>Try again</button>
				</div>
			{:else if root.entries.length === 0}
				<p class="workspace-files__state">No visible files in this workspace.</p>
			{:else}
				<div class="workspace-files__tree" role="tree" aria-label={`${workspaceName} files`} bind:this={tree}>
					{#each visibleEntries as entry (entry.path)}
						<button
							type="button"
							role="treeitem"
							aria-level={entry.depth}
							aria-expanded={entry.kind === 'directory' ? expanded.has(entry.path) : undefined}
							aria-selected={selectedPath === entry.path}
							tabindex={activePath === entry.path ? 0 : -1}
							title={entry.path}
							class="workspace-files__tree-row"
							class:workspace-files__tree-row--selected={selectedPath === entry.path}
							style:--tree-depth={entry.depth - 1}
							onfocus={() => (activePath = entry.path)}
							onkeydown={(event) => handleTreeKeydown(event, entry)}
							onclick={() => selectEntry(entry)}>
							<span class="workspace-files__disclosure">
								{#if entry.kind === 'directory'}
									<Icon name={expanded.has(entry.path) ? 'chevronDown' : 'chevronRight'} size={14} />
								{/if}
							</span>
							<Icon name={fileIcon(entry)} size={16} />
							<span class="workspace-files__name">{basename(entry.path)}</span>
						</button>
						{#if directories[entry.path]?.loading}
							<p class="workspace-files__branch-state" role="status">Loading {basename(entry.path)}…</p>
						{:else if directories[entry.path]?.error}
							<p class="workspace-files__branch-state workspace-files__branch-state--error" role="alert">
								{directories[entry.path]?.error}
							</p>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{/snippet}

	<section class="workspace-files__surface" aria-labelledby="workspace-files-title">
		<header>
			<div>
				<p>Workspace files</p>
				<h1 id="workspace-files-title">{submittedQuery ? `Search: ${submittedQuery}` : workspaceName}</h1>
			</div>
			{#if submittedQuery && !searchLoading && !searchError}
				<span>{searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}</span>
			{/if}
		</header>

		{#if searchLoading}
			<p class="workspace-files__surface-state" role="status">Searching workspace files…</p>
		{:else if searchError}
			<p class="workspace-files__surface-state workspace-files__surface-state--error" role="alert">{searchError}</p>
		{:else if submittedQuery && searchResults.length === 0}
			<p class="workspace-files__surface-state">No matches for “{submittedQuery}”.</p>
		{:else if submittedQuery}
			<ol class="workspace-files__results" aria-label="File search results">
				{#each searchResults as result (`${result.path}:${result.line}`)}
					<li>
						<button
							type="button"
							title={`${result.path}:${result.line}`}
							onclick={() => onOpenFile?.(result.path, result.line)}>
							<span class="workspace-files__result-location">
								<Icon name={fileIcon({ path: result.path, kind: 'file', size: null })} size={16} />
								<strong>{result.path}</strong><small>:{result.line}</small>
							</span>
							<code>{result.preview || 'Matching line is empty'}</code>
						</button>
					</li>
				{/each}
			</ol>
		{:else if selectedPath}
			<div class="workspace-files__surface-state">
				<Icon name="file" size={28} />
				<p>{selectedPath}</p>
				<small>File editing arrives in the next editor update.</small>
			</div>
		{:else}
			<div class="workspace-files__surface-state">
				<Icon name="files" size={28} />
				<p>Choose a file from the tree or search its contents.</p>
				<small>Hidden and ignored files stay excluded until you include them.</small>
			</div>
		{/if}
	</section>
</ApplicationShell>

<style>
	.workspace-files__browser {
		min-width: 0;
		font-size: 0.75rem;
	}

	.workspace-files__search {
		display: grid;
		gap: 0.35rem;
		padding: 0 0.75rem 0.75rem;
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__search label,
	.workspace-files__visibility legend,
	.workspace-files__tree-header {
		color: var(--shell-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.04em;
	}

	.workspace-files__search > div {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		height: 2rem;
		padding-inline: 0.55rem;
		border: 1px solid var(--shell-border);
		background: var(--shell-surface);
	}

	.workspace-files__search > div:focus-within {
		border-color: var(--shell-focus);
		box-shadow: 0 0 0 1px var(--shell-focus);
	}

	.workspace-files__search input {
		min-width: 0;
		width: 100%;
		color: var(--shell-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
	}

	.workspace-files__search input::placeholder {
		color: var(--shell-muted);
	}

	.workspace-files__visibility {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 0;
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__visibility legend {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}

	.workspace-files__visibility label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 1.75rem;
		color: var(--shell-muted);
		white-space: nowrap;
	}

	.workspace-files__visibility input {
		accent-color: var(--shell-accent);
	}

	.workspace-files__tree-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 2rem;
		padding-inline: 0.75rem;
		text-transform: uppercase;
	}

	.workspace-files__tree-header small {
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	.workspace-files__tree {
		display: grid;
		min-width: 0;
		padding-bottom: 0.75rem;
	}

	.workspace-files__tree-row {
		display: grid;
		grid-template-columns: 0.875rem 1rem minmax(0, 1fr);
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		min-height: 2rem;
		padding: 0.25rem 0.65rem 0.25rem min(calc(0.65rem + var(--tree-depth) * 0.8rem), 4rem);
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		text-align: start;
		font: inherit;
		cursor: pointer;
	}

	.workspace-files__tree-row:hover,
	.workspace-files__tree-row:focus-visible,
	.workspace-files__tree-row--selected {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	.workspace-files__tree-row--selected {
		box-shadow: inset 2px 0 0 var(--shell-accent);
	}

	.workspace-files__disclosure {
		display: grid;
		place-items: center;
	}

	.workspace-files__name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: ui-monospace, 'Cascadia Code', monospace;
	}

	.workspace-files__state,
	.workspace-files__branch-state {
		margin: 0;
		padding: 0.75rem;
		color: var(--shell-muted);
	}

	.workspace-files__state--error,
	.workspace-files__branch-state--error {
		color: var(--shell-danger);
	}

	.workspace-files__state p {
		margin: 0 0 0.6rem;
	}

	.workspace-files__state button {
		min-height: 2rem;
		padding-inline: 0.65rem;
		color: var(--shell-text);
		background: var(--shell-surface-raised);
		border: 1px solid var(--shell-border);
		font: inherit;
	}

	.workspace-files__branch-state {
		padding-inline-start: 2rem;
		font-size: 0.6875rem;
	}

	.workspace-files__surface {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-height: 100%;
		margin: calc(-1 * clamp(1rem, 3vw, 2.5rem));
	}

	.workspace-files__surface > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 3.5rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__surface header p,
	.workspace-files__surface header h1 {
		margin: 0;
	}

	.workspace-files__surface header p,
	.workspace-files__surface header span {
		color: var(--shell-muted);
		font-size: 0.6875rem;
	}

	.workspace-files__surface header h1 {
		margin-top: 0.1rem;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.workspace-files__surface-state {
		align-self: center;
		justify-self: center;
		max-width: 34rem;
		padding: 2rem;
		color: var(--shell-muted);
		text-align: center;
	}

	.workspace-files__surface-state p {
		margin: 0.7rem 0 0.25rem;
		color: var(--shell-text);
	}

	.workspace-files__surface-state small {
		display: block;
	}

	.workspace-files__surface-state--error {
		color: var(--shell-danger);
	}

	.workspace-files__results {
		min-width: 0;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.workspace-files__results li {
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__results button {
		display: grid;
		gap: 0.4rem;
		width: 100%;
		min-width: 0;
		padding: 0.75rem 1rem;
		color: var(--shell-text);
		background: transparent;
		border: 0;
		text-align: start;
		cursor: pointer;
	}

	.workspace-files__results button:hover,
	.workspace-files__results button:focus-visible {
		background: var(--shell-surface-raised);
	}

	.workspace-files__result-location {
		display: grid;
		grid-template-columns: 1rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.workspace-files__result-location strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.workspace-files__result-location small {
		color: var(--shell-muted);
	}

	.workspace-files__results code {
		overflow: hidden;
		color: var(--shell-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
	}

	@media (pointer: coarse) {
		.workspace-files__tree-row,
		.workspace-files__visibility label,
		.workspace-files__results button {
			min-height: 2.75rem;
		}
	}
</style>
