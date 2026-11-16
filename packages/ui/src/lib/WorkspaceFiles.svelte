<script lang="ts">
	import MetaText from './MetaText.svelte';
	import '../styles/tokens.css';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import type { IconKind } from '../icons';
	import type { ThemeName, UiFontName } from '../theme';
	import type {
		WorkspaceFileChanges,
		WorkspaceFileEntry,
		WorkspaceFileSource,
		WorkspaceGitDiff,
		WorkspaceGitFileState,
		WorkspaceGitFileStatus,
		WorkspaceGitStatus,
		WorkspaceSearchMatch,
		WorkspaceTraversalOptions
	} from './types/workspace-files';
	import ApplicationShell, { type ShellNavItem, type ShellPaneWidths } from './ApplicationShell.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import {
		contextMenuRequest,
		isContextMenuKey,
		revealLabel,
		type ContextMenuItem,
		type ContextMenuRequest
	} from './context-menu';
	import { BusyIndicator } from './busy-indicator.svelte';
	import DiffReview from './DiffReview.svelte';
	import EmptyState from './EmptyState.svelte';
	import FileEditor from './FileEditor.svelte';
	import Icon from './Icon.svelte';
	import type { FileEditorSource } from './types/file-editor';

	type DirectoryState = { entries: WorkspaceFileEntry[]; error?: string; loading: boolean };

	type VisibleEntry = WorkspaceFileEntry & { depth: number };

	type Props = {
		workspaceId: string;
		workspaceName: string;
		source: WorkspaceFileSource;
		disconnected?: boolean;
		editorSource?: FileEditorSource;
		onOpenFile?: (path: string, line?: number) => void;
		/** A file to show when the view opens, such as one linked from terminal output. */
		openPath?: string;
		/** The line of `openPath` to show. */
		openLine?: number;
		/** The workspace folder. Copying a full path and revealing an entry need it. */
		workspacePath?: string;
		/**
		 * Shows a path in the system file manager. The desktop app supplies it.
		 * With it and `workspacePath`, the file tree's context menu offers it.
		 */
		revealPath?: (path: string) => Promise<void>;
		/** Product rail destinations, supplied by the app that owns the routes. */
		productItems?: ShellNavItem[];
		/** Saved widths for the resizable panes. */
		/** Color theme the shell applies. Defaults to the shell's own default. */
		theme?: ThemeName;
		/** UI font the shell applies. Defaults to the shell's own default. */
		uiFont?: UiFontName;
		paneWidths?: ShellPaneWidths;
		/** Called with the new widths after the operator resizes a pane. */
		onPaneResize?: (widths: ShellPaneWidths) => void;
	};

	const defaultProductItems: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents' },
		{ id: 'files', label: 'Files', icon: 'files', active: true },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	let {
		workspaceId,
		workspaceName,
		source,
		disconnected = false,
		editorSource,
		onOpenFile,
		openPath,
		openLine,
		workspacePath,
		revealPath,
		productItems = defaultProductItems,
		theme,
		uiFont,
		paneWidths,
		onPaneResize
	}: Props = $props();

	let directories = $state<Record<string, DirectoryState>>({});
	let expanded = new SvelteSet<string>();
	let activePath = $state('');
	let selectedPath = $state<string>();
	let selectedLine = $state<number>();
	let includeHidden = $state(false);
	let includeIgnored = $state(false);
	let query = $state('');
	let submittedQuery = $state('');
	let searchResults = $state<WorkspaceSearchMatch[]>([]);
	let searchLoading = $state(false);
	let searchError = $state('');
	let gitStatus = $state<WorkspaceGitStatus>();
	let gitLoading = $state(true);
	let gitError = $state('');
	let selectedDiffPath = $state<string>();
	let selectedDiff = $state<WorkspaceGitDiff>();
	let diffLoading = $state(false);
	let diffError = $state('');
	let reviewedHunks = $state<Record<string, number[]>>({});
	let diffRequestVersion = 0;
	let requestVersion = 0;
	let tree = $state<HTMLElement>();
	let contextMenu = $state<ContextMenuRequest>();
	/** Why the last file tree action from a context menu failed. */
	let treeActionError = $state('');
	/** Changes on disk to the open file, counted for the editor to follow. */
	let openFileDiskChanges = $state(0);

	let traversalOptions = $derived<WorkspaceTraversalOptions>({ includeHidden, includeIgnored });
	let root = $derived(directories['']);
	const treeLoading = new BusyIndicator(() => !root || root.loading);
	const gitStatusLoading = new BusyIndicator(() => gitLoading);
	const searching = new BusyIndicator(() => searchLoading);
	const diffOpening = new BusyIndicator(() => diffLoading);
	let showsEditor = $derived(
		!searching.active &&
			!searchError &&
			!submittedQuery &&
			!diffOpening.active &&
			!diffError &&
			!selectedDiff &&
			!!selectedPath &&
			!!editorSource
	);
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
		void loadGitStatus();
		return source.watch?.(followDiskChanges);
	});

	/**
	 * Brings the tree, Git status, and open file up to date after a change on
	 * disk. Listings refresh in place, so expanded folders and focus stay put.
	 * A changed folder may have been replaced by another under the same name,
	 * so its loaded subfolders refresh too, and those that are gone collapse.
	 */
	function followDiskChanges(changes: WorkspaceFileChanges): void {
		void loadGitStatus(true);
		const loaded = Object.keys(directories);
		const stale = changes.truncated
			? loaded
			: loaded.filter((directory) =>
					changes.paths.some(
						(path) => path === directory || parentPath(path) === directory || directory.startsWith(`${path}/`)
					)
				);
		for (const directory of stale) void refreshDirectory(directory);
		if (selectedPath && (changes.truncated || changes.paths.includes(selectedPath))) openFileDiskChanges += 1;
	}

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

	/** Reads Git status. A quiet refresh keeps the current status on screen until the new one arrives. */
	async function loadGitStatus(quiet = false): Promise<void> {
		if (!quiet) gitLoading = true;
		try {
			gitStatus = await source.gitStatus();
			gitError = '';
		} catch {
			gitError = 'Pau could not read Git status.';
		} finally {
			gitLoading = false;
		}
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

	/**
	 * Replaces a loaded listing without a loading state. A folder that is gone
	 * collapses and forgets its subfolders, so a folder that later reappears
	 * under the same name does not show their old listings.
	 */
	async function refreshDirectory(path: string): Promise<void> {
		const version = requestVersion;
		try {
			const entries = await source.listDirectory(path, traversalOptions);
			if (version === requestVersion && Object.hasOwn(directories, path))
				directories[path] = { entries, loading: false };
		} catch (error) {
			if (version !== requestVersion) return;
			if (path && errorCode(error) === 'not_found') {
				const gone = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`);
				for (const directory of Object.keys(directories)) if (gone(directory)) delete directories[directory];
				for (const directory of expanded) if (gone(directory)) expanded.delete(directory);
			} else {
				directories[path] = { entries: [], error: errorMessage(error), loading: false };
			}
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

	function openFile(path: string, line?: number): void {
		selectedDiffPath = undefined;
		selectedDiff = undefined;
		selectedPath = path;
		selectedLine = line;
		submittedQuery = '';
		if (line === undefined) onOpenFile?.(path);
		else onOpenFile?.(path, line);
	}

	$effect(() => {
		if (!openPath) return;
		const [path, line] = [openPath, openLine];
		untrack(() => openFile(path, line));
	});

	async function openDiff(path: string): Promise<void> {
		const version = ++diffRequestVersion;
		selectedDiffPath = path;
		selectedPath = undefined;
		selectedDiff = undefined;
		diffLoading = true;
		diffError = '';
		try {
			const loaded = await source.gitDiff(path);
			if (version === diffRequestVersion) selectedDiff = loaded;
		} catch {
			if (version === diffRequestVersion) diffError = 'Pau could not load this diff.';
		} finally {
			if (version === diffRequestVersion) diffLoading = false;
		}
	}

	function moveChangedFile(offset: number): void {
		const files = gitStatus?.files ?? [];
		if (files.length === 0) return;
		const current = Math.max(
			0,
			files.findIndex((file) => file.path === selectedDiffPath)
		);
		const file = files[(current + offset + files.length) % files.length];
		if (file) void openDiff(file.path);
	}

	function handleChangedFileKeydown(event: KeyboardEvent, index: number): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const files = gitStatus?.files ?? [];
		const next = event.key === 'ArrowDown' ? Math.min(index + 1, files.length - 1) : Math.max(index - 1, 0);
		const button = event.currentTarget as HTMLButtonElement;
		const buttons = button.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('button');
		buttons?.[next]?.focus();
		const file = files[next];
		if (file) void openDiff(file.path);
	}

	function reviewLabel(file: WorkspaceGitFileStatus): string {
		const count = reviewedHunks[file.path]?.length ?? 0;
		return count > 0 ? `${count} reviewed` : gitFileLabel(file);
	}

	function selectEntry(entry: WorkspaceFileEntry): void {
		activePath = entry.path;
		if (entry.kind === 'directory') {
			void toggleDirectory(entry);
		} else {
			openFile(entry.path);
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

	/** Joins a workspace-relative path to the workspace folder with the folder's own separator. */
	function absolutePath(path: string): string | undefined {
		if (!workspacePath) return undefined;
		const separator = workspacePath.includes('\\') && !workspacePath.includes('/') ? '\\' : '/';
		const root = workspacePath.replace(/[\\/]+$/, '');
		return `${root}${separator}${path.split('/').join(separator)}`;
	}

	function entryMenuItems(entry: WorkspaceFileEntry): ContextMenuItem[] {
		const items: ContextMenuItem[] = [];
		const full = absolutePath(entry.path);
		if (entry.kind !== 'directory') items.push({ id: 'open', label: 'Open' });
		if (revealPath && full) items.push({ id: 'reveal', label: revealLabel(), separatorBefore: true });
		if (full) items.push({ id: 'copy-path', label: 'Copy path', separatorBefore: !revealPath });
		items.push({ id: 'copy-relative-path', label: 'Copy relative path', separatorBefore: !full });
		return items;
	}

	async function runEntryAction(entry: WorkspaceFileEntry, id: string): Promise<void> {
		const full = absolutePath(entry.path) ?? '';
		treeActionError = '';
		try {
			switch (id) {
				case 'open': {
					activePath = entry.path;
					openFile(entry.path);
					break;
				}
				case 'reveal': {
					await revealPath?.(full);
					break;
				}
				case 'copy-path': {
					await navigator.clipboard.writeText(full);
					break;
				}
				case 'copy-relative-path': {
					await navigator.clipboard.writeText(entry.path);
					break;
				}
			}
		} catch (error) {
			treeActionError =
				error instanceof Error ? error.message : `Pau could not finish that action on ${basename(entry.path)}.`;
		}
	}

	function openEntryMenu(event: MouseEvent | KeyboardEvent, entry: WorkspaceFileEntry): void {
		contextMenu = contextMenuRequest(event, `${basename(entry.path)} actions`, entryMenuItems(entry), (id) => {
			void runEntryAction(entry, id);
		});
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

	/** Directory part of a path including its trailing slash, or an empty string. */
	function dirname(path: string): string {
		return path.slice(0, path.length - basename(path).length);
	}

	function gitStateLabel(state: WorkspaceGitFileState): string {
		return state === 'type_changed' ? 'Type changed' : `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
	}

	function gitFileLabel(file: WorkspaceGitFileStatus): string {
		if (file.conflicted) return 'Conflicted';
		const labels = [];
		if (file.staged) labels.push(`Staged ${gitStateLabel(file.staged).toLowerCase()}`);
		if (file.worktree) labels.push(gitStateLabel(file.worktree));
		return labels.join(' · ');
	}

	function gitFileIcon(file: WorkspaceGitFileStatus): IconKind {
		if (file.conflicted) return 'gitMerge';
		switch (file.worktree ?? file.staged) {
			case 'added':
			case 'untracked': {
				return 'diffAdded';
			}
			case 'deleted': {
				return 'diffRemoved';
			}
			case 'renamed': {
				return 'diffRenamed';
			}
			default: {
				return 'diffModified';
			}
		}
	}

	function gitHeadLabel(status: WorkspaceGitStatus): string {
		if (status.detached) return `Detached at ${status.head?.slice(0, 7) ?? 'unknown'}`;
		return status.branch ?? 'Unborn branch';
	}
</script>

<ApplicationShell
	{workspaceName}
	contextLabel="Files"
	{productItems}
	contextItems={[]}
	{disconnected}
	inspectorOpen={false}
	{theme}
	{uiFont}
	{paneWidths}
	onResize={onPaneResize}>
	{#snippet context()}
		<section class="workspace-files__browser" aria-label="Workspace files">
			<section class="workspace-files__git" aria-label="Git status" aria-live="polite">
				{#if gitStatusLoading.active}
					{#if gitStatusLoading.visible}<p>Reading Git status…</p>{/if}
				{:else if gitError}
					<p class="workspace-files__git-error">{gitError}</p>
				{:else if gitStatus && !gitStatus.repository}
					<p><Icon name="gitBranch" size={14} /> Not a Git repository</p>
				{:else if gitStatus}
					<div class="workspace-files__git-branch" title={gitHeadLabel(gitStatus)}>
						<Icon name={gitStatus.detached ? 'gitCommit' : 'gitBranch'} size={14} />
						<strong>{gitHeadLabel(gitStatus)}</strong>
						<small>{gitStatus.files.length}</small>
					</div>
					{#if gitStatus.files.length === 0}
						<p>Working tree clean</p>
					{:else}
						<ul aria-label="Changed files">
							{#each gitStatus.files as file (file.path)}
								<li>
									<button type="button" class="pau-row" title={file.path} onclick={() => void openDiff(file.path)}>
										<Icon name={gitFileIcon(file)} size={14} />
										<span class="workspace-files__git-path">
											{#if dirname(file.path)}<span class="workspace-files__git-dir"
													><bdo dir="ltr">{dirname(file.path)}</bdo></span
												>{/if}
											<span class="workspace-files__git-file">{basename(file.path)}</span>
										</span>
										<small><MetaText text={gitFileLabel(file)} /></small>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>

			<form
				class="workspace-files__search"
				role="search"
				onsubmit={(event) => {
					event.preventDefault();
					void runSearch();
				}}>
				<label class="pau-section-label" for={`workspace-search-${workspaceId}`}>Search files</label>
				<div class="pau-field">
					<Icon name="search" size={16} />
					<input id={`workspace-search-${workspaceId}`} type="search" bind:value={query} placeholder="Text in files" />
				</div>
			</form>

			<fieldset class="workspace-files__visibility">
				<legend class="pau-visually-hidden">File visibility</legend>
				<label class="pau-choice">
					<input
						type="checkbox"
						checked={includeHidden}
						onchange={(event) => setVisibility('hidden', event.currentTarget.checked)} />
					<span>Show hidden files</span>
				</label>
				<label class="pau-choice">
					<input
						type="checkbox"
						checked={includeIgnored}
						onchange={(event) => setVisibility('ignored', event.currentTarget.checked)} />
					<span>Show ignored files</span>
				</label>
			</fieldset>

			<div class="workspace-files__tree-header pau-section-label">
				<span>Workspace</span>
				{#if root && !root.loading}<small>{root.entries.length}</small>{/if}
			</div>

			{#if !root || treeLoading.active}
				{#if treeLoading.visible}<p class="workspace-files__state" role="status">Loading workspace files…</p>{/if}
			{:else if root.error}
				<div class="workspace-files__state workspace-files__state--error" role="alert">
					<p>{root.error}</p>
					<button type="button" class="pau-button pau-button--secondary" onclick={() => reloadTree()}>Try again</button>
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
							class="workspace-files__tree-row pau-row"
							class:workspace-files__tree-row--selected={selectedPath === entry.path}
							style:--tree-depth={entry.depth - 1}
							onfocus={() => (activePath = entry.path)}
							onkeydown={(event) => {
								if (isContextMenuKey(event)) openEntryMenu(event, entry);
								else handleTreeKeydown(event, entry);
							}}
							oncontextmenu={(event) => {
								activePath = entry.path;
								openEntryMenu(event, entry);
							}}
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
			{#if treeActionError}
				<p class="workspace-files__branch-state workspace-files__branch-state--error" role="alert">
					{treeActionError}
				</p>
			{/if}
		</section>
	{/snippet}

	{#snippet inspector()}
		<section class="workspace-files__review" aria-label="Review changes">
			<header>
				<div>
					<strong>Review changes</strong>
					<small>{gitStatus?.files.length ?? 0} changed {gitStatus?.files.length === 1 ? 'file' : 'files'}</small>
				</div>
				<div>
					<button
						type="button"
						class="pau-utility-button"
						aria-label="Previous changed file"
						onclick={() => moveChangedFile(-1)}>↑</button>
					<button
						type="button"
						class="pau-utility-button"
						aria-label="Next changed file"
						onclick={() => moveChangedFile(1)}>↓</button>
				</div>
			</header>
			{#if gitStatusLoading.active}
				{#if gitStatusLoading.visible}<p role="status">Reading changed files…</p>{/if}
			{:else if gitError}
				<p class="workspace-files__review-error" role="alert">{gitError}</p>
			{:else if !gitStatus?.repository}
				<p>Diff review needs a Git repository.</p>
			{:else if gitStatus.files.length === 0}
				<p>Working tree clean.</p>
			{:else}
				<ul aria-label="Files to review">
					{#each gitStatus.files as file, index (file.path)}
						<li>
							<button
								type="button"
								class="pau-row"
								aria-pressed={selectedDiffPath === file.path}
								title={file.path}
								onkeydown={(event) => handleChangedFileKeydown(event, index)}
								onclick={() => void openDiff(file.path)}>
								<Icon name={gitFileIcon(file)} size={14} />
								<span>{file.path}</span>
								<small><MetaText text={reviewLabel(file)} /></small>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/snippet}

	<!-- The menu renders in the main surface, which stays visible when the rails collapse. -->
	{#if contextMenu}
		{#key contextMenu}
			<ContextMenu request={contextMenu} onClose={() => (contextMenu = undefined)} />
		{/key}
	{/if}

	<section
		class="workspace-files__surface"
		class:workspace-files__surface--editing={showsEditor}
		aria-labelledby="workspace-files-title">
		<header>
			<p>Workspace files</p>
			<h1 class="pau-view-title" id="workspace-files-title">
				{submittedQuery ? `Search: ${submittedQuery}` : workspaceName}
			</h1>
			{#if submittedQuery && !searching.active && !searchError}
				<span>{searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}</span>
			{/if}
		</header>

		{#if searching.active}
			{#if searching.visible}
				<p class="workspace-files__surface-state" role="status">Searching workspace files…</p>
			{/if}
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
							class="pau-row"
							title={`${result.path}:${result.line}`}
							onclick={() => openFile(result.path, result.line)}>
							<span class="workspace-files__result-location">
								<Icon name={fileIcon({ path: result.path, kind: 'file', size: null })} size={16} />
								<strong>{result.path}</strong><small>:{result.line}</small>
							</span>
							<code>{result.preview || 'Matching line is empty'}</code>
						</button>
					</li>
				{/each}
			</ol>
		{:else if diffOpening.active}
			{#if diffOpening.visible}
				<p class="workspace-files__surface-state" role="status">Loading diff for {selectedDiffPath}…</p>
			{/if}
		{:else if diffError}
			<p class="workspace-files__surface-state workspace-files__surface-state--error" role="alert">{diffError}</p>
		{:else if selectedDiff}
			{#key selectedDiff.path}
				<DiffReview
					diff={selectedDiff}
					reviewedHunks={reviewedHunks[selectedDiff.path] ?? []}
					onReviewedHunksChange={(hunks) => (reviewedHunks[selectedDiff!.path] = hunks)} />
			{/key}
		{:else if selectedPath && editorSource}
			{#key selectedPath}
				{@const fullPath = absolutePath(selectedPath)}
				<FileEditor
					path={selectedPath}
					source={editorSource}
					line={selectedLine}
					diskChanges={openFileDiskChanges}
					onReveal={revealPath && fullPath ? () => revealPath(fullPath) : undefined} />
			{/key}
		{:else if selectedPath}
			<div class="workspace-files__surface-state">
				<Icon name="file" size={28} />
				<p>{selectedPath}</p>
			</div>
		{:else}
			<EmptyState title="No file selected">
				<p>Choose a file from the tree or search its contents.</p>
				<p>Hidden and ignored files stay excluded until you include them.</p>
			</EmptyState>
		{/if}
	</section>
</ApplicationShell>

<style>
	.workspace-files__browser {
		min-width: 0;
		font-size: var(--pau-type-sm);
	}

	.workspace-files__git {
		display: grid;
		gap: var(--pau-space-1);
		padding: 0 var(--shell-inset) var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__git p {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		margin: 0;
		color: var(--shell-muted);
	}

	.workspace-files__git-error {
		color: var(--shell-danger) !important;
	}

	.workspace-files__git-branch {
		display: grid;
		grid-template-columns: 0.875rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-sm);
	}

	.workspace-files__git-branch strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-weight: var(--pau-weight-medium);
	}

	/* Same regular weight as tree rows. The directory shrinks first and is
	   clipped at its start (rtl) so the file name stays visible. */
	.workspace-files__git-path {
		display: flex;
		min-width: 0;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
	}

	.workspace-files__git-dir {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		color: var(--shell-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
	}

	.workspace-files__git-file {
		flex: 0 0 auto;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-files__git-branch small,
	.workspace-files__git li small {
		color: var(--shell-muted);
		font-size: var(--pau-type-xs);
		white-space: nowrap;
	}

	.workspace-files__git ul {
		display: grid;
		max-height: 10rem;
		margin: 0 calc(-1 * var(--shell-inset));
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.workspace-files__git li button {
		display: grid;
		grid-template-columns: 0.875rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-row-sm);
		padding: var(--pau-space-1) var(--shell-inset);
		color: var(--shell-text);
		border: 0;
		text-align: start;
		font: inherit;
		cursor: pointer;
	}

	.workspace-files__git li button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.workspace-files__review {
		display: grid;
		gap: var(--pau-space-2);
		font-size: var(--pau-type-sm);
	}

	.workspace-files__review header,
	.workspace-files__review header > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-2);
	}

	.workspace-files__review header > div:first-child {
		align-items: flex-start;
		flex-direction: column;
	}

	.workspace-files__review header small,
	.workspace-files__review > p,
	.workspace-files__review li small {
		color: var(--shell-muted);
	}

	.workspace-files__review header button {
		width: 1.75rem;
		height: var(--pau-size-row-sm);
		color: var(--shell-text);
		background-color: var(--shell-surface-raised);
		border: 1px solid var(--shell-border);
		cursor: pointer;
	}

	.workspace-files__review ul {
		display: grid;
		margin: 0 calc(-1 * var(--pau-space-4));
		padding: 0;
		list-style: none;
	}

	.workspace-files__review li button {
		display: grid;
		grid-template-columns: 0.875rem minmax(0, 1fr);
		gap: 0 var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-row-lg);
		padding: var(--pau-space-1) var(--pau-space-4);
		color: var(--shell-text);
		border: 0;
		border-left: 2px solid transparent;
		text-align: start;
		cursor: pointer;
	}

	.workspace-files__review li button[aria-pressed='true'] {
		border-left-color: var(--shell-accent);
		background-color: var(--shell-surface-raised);
	}

	.workspace-files__review li span,
	.workspace-files__review li small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-files__review li small {
		grid-column: 2;
		font-size: var(--pau-type-xs);
	}

	.workspace-files__review-error {
		color: var(--shell-danger) !important;
	}

	.workspace-files__search {
		display: grid;
		gap: var(--pau-space-1);
		padding: var(--pau-space-3) var(--shell-inset);
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__visibility {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: var(--pau-space-1) var(--pau-space-3);
		margin: 0;
		padding: var(--pau-space-3) var(--shell-inset);
		border: 0;
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__visibility label {
		display: flex;
		align-items: center;
		min-height: 1.5rem;
		color: var(--shell-muted);
		white-space: nowrap;
	}

	.workspace-files__tree-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-3) var(--shell-inset) var(--pau-space-1);
	}

	.workspace-files__tree-header small {
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	/* Each level puts its chevron under the parent's icon, up to three levels deep. */
	.workspace-files__tree {
		--tree-indent: calc(0.875rem + var(--pau-space-1));
		display: grid;
		min-width: 0;
		padding-bottom: var(--pau-space-3);
	}

	.workspace-files__tree-row {
		display: grid;
		grid-template-columns: 0.875rem 1rem minmax(0, 1fr);
		align-items: center;
		gap: var(--pau-space-1);
		min-width: 0;
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--shell-inset) var(--pau-space-1)
			calc(var(--shell-inset) + min(var(--tree-depth), 3) * var(--tree-indent));
		border: 0;
		text-align: start;
		font: inherit;
		cursor: pointer;
	}

	.workspace-files__tree-row--selected {
		color: var(--shell-text);
		background-color: var(--shell-surface-raised);
	}

	.workspace-files__tree-row:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
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
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
	}

	.workspace-files__state,
	.workspace-files__branch-state {
		margin: 0;
		padding: var(--pau-space-3) var(--shell-inset);
		color: var(--shell-muted);
	}

	.workspace-files__state--error,
	.workspace-files__branch-state--error {
		color: var(--shell-danger);
	}

	.workspace-files__state p {
		margin: 0 0 var(--pau-space-2);
	}

	.workspace-files__branch-state {
		padding-inline-start: var(--pau-space-6);
		font-size: var(--pau-type-xs);
	}

	.workspace-files__surface {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-height: 100%;
		margin: calc(-1 * var(--shell-main-padding));
	}

	/* The editor scrolls inside itself, so the surface takes the pane height instead of the content height. */
	.workspace-files__surface--editing {
		height: calc(100% + 2 * var(--shell-main-padding));
		min-height: 0;
		overflow: hidden;
	}

	/* Line the empty state up with the header's title. */
	.workspace-files__surface {
		--empty-state-inset: var(--shell-inset);
	}

	/* The match count centers on the title line, as in the shared view header. */
	.workspace-files__surface > header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--pau-space-4);
		min-height: 3.5rem;
		padding: var(--pau-space-3) var(--shell-inset);
		border-bottom: 1px solid var(--shell-border);
	}

	.workspace-files__surface header p,
	.workspace-files__surface header h1 {
		margin: 0;
	}

	.workspace-files__surface header p,
	.workspace-files__surface header span {
		color: var(--shell-muted);
		font-size: var(--pau-type-xs);
	}

	.workspace-files__surface header :is(p, h1) {
		grid-column: 1;
	}

	.workspace-files__surface header span {
		grid-area: 2 / 2;
	}

	.workspace-files__surface-state {
		align-self: center;
		justify-self: center;
		max-width: 34rem;
		padding: var(--pau-space-6);
		color: var(--shell-muted);
		text-align: center;
	}

	.workspace-files__surface-state p {
		margin: var(--pau-space-3) 0 var(--pau-space-1);
		color: var(--shell-text);
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
		gap: var(--pau-space-2);
		width: 100%;
		min-width: 0;
		padding: var(--pau-space-3) var(--shell-inset);
		color: var(--shell-text);
		border: 0;
		text-align: start;
		cursor: pointer;
	}

	.workspace-files__results button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.workspace-files__result-location {
		display: grid;
		grid-template-columns: 1rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-1);
		min-width: 0;
	}

	.workspace-files__result-location strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-medium);
	}

	.workspace-files__result-location small {
		color: var(--shell-muted);
	}

	.workspace-files__results code {
		overflow: hidden;
		color: var(--shell-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--pau-type-xs);
	}

	@media (pointer: coarse) {
		.workspace-files__tree-row,
		.workspace-files__visibility label,
		.workspace-files__results button {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
