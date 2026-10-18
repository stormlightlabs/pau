import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { workspaceFileFixtures } from '../fixtures/workspace-files';
import WorkspaceFiles from '../lib/WorkspaceFiles.svelte';
import type { WorkspaceFileSource, WorkspaceSearchMatch } from '../lib/types/workspace-files';

function source(overrides: Partial<WorkspaceFileSource> = {}): WorkspaceFileSource {
	return {
		listDirectory: async (path) => structuredClone(workspaceFileFixtures.tree[path] ?? []),
		search: async () => structuredClone(workspaceFileFixtures.searchResults),
		gitStatus: async () => structuredClone(workspaceFileFixtures.gitStatus),
		gitDiff: async (path) =>
			structuredClone(
				workspaceFileFixtures.diffs[path] ?? {
					path,
					previous_path: null,
					old_content: 'before\n',
					new_content: 'after\n',
					binary: false,
					too_large: false
				}
			),
		...overrides
	};
}

async function openNavigation(): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
}

async function renderFiles(fileSource: WorkspaceFileSource = source()): Promise<void> {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: fileSource });
	await openNavigation();
}

test('shows loading, empty, and permission-error states', async () => {
	const pending = new Promise<never>(() => {});
	const view = await render(WorkspaceFiles, {
		workspaceId: 'pau',
		workspaceName: 'pau',
		source: source({ listDirectory: async () => pending })
	});
	await openNavigation();
	await expect.element(page.getByRole('status')).toHaveTextContent('Loading workspace files');
	view.unmount();

	const emptyView = await render(WorkspaceFiles, {
		workspaceId: 'pau',
		workspaceName: 'pau',
		source: source({ listDirectory: async () => [] })
	});
	await openNavigation();
	await expect.element(page.getByText('No visible files in this workspace.')).toBeInTheDocument();
	emptyView.unmount();

	await renderFiles(
		source({
			listDirectory: async () => {
				throw Object.assign(new Error('denied'), { code: 'permission_denied' });
			}
		})
	);
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Pau cannot read this folder. Check its file permissions and try again.');
});

test('shows branch and changed-file states with text labels', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source() });
	await openNavigation();

	await expect.element(page.getByText('feature/git-status')).toBeInTheDocument();
	const changes = page.getByRole('list', { name: 'Changed files' });
	await expect.element(changes.getByText('Modified')).toBeInTheDocument();
	await expect.element(changes.getByText('Staged renamed')).toBeInTheDocument();
	await expect.element(changes.getByText('Untracked')).toBeInTheDocument();
	await expect.element(changes.getByText('Staged added')).toBeInTheDocument();
	await expect.element(changes.getByText('Deleted')).toBeInTheDocument();
	await expect.element(changes.getByText('Conflicted')).toBeInTheDocument();
	await userEvent.click(changes.getByRole('button').first());
	await expect
		.element(page.getByRole('region', { name: 'Diff for packages/ui/src/lib/WorkspaceFiles.svelte' }))
		.toBeInTheDocument();
});

test('keeps the file name visible when a long changed path truncates', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source() });
	await openNavigation();

	const row = page.getByRole('list', { name: 'Changed files' }).getByRole('button').first();
	await expect.element(row).toBeInTheDocument();
	const path = row.element().querySelector<HTMLElement>('.workspace-files__git-path')!;
	const dir = path.querySelector<HTMLElement>('.workspace-files__git-dir')!;
	const file = path.querySelector<HTMLElement>('.workspace-files__git-file')!;
	expect(file.textContent).toBe('WorkspaceFiles.svelte');
	expect(dir.textContent).toBe('packages/ui/src/lib/');

	// A narrow row clips the directory from its start and leaves the file name whole.
	row.element().style.width = '20rem';
	expect(dir.scrollWidth).toBeGreaterThan(dir.clientWidth);
	expect(file.scrollWidth).toBeLessThanOrEqual(file.clientWidth);
	expect(getComputedStyle(dir).direction).toBe('rtl');
	expect(getComputedStyle(dir).color).not.toBe(getComputedStyle(file).color);
});

test('sets changed-file rows in the same weight as tree rows', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source() });
	await openNavigation();

	const changeRow = page.getByRole('list', { name: 'Changed files' }).getByRole('button').first();
	const treeItem = page.getByRole('treeitem').first();
	await expect.element(changeRow).toBeInTheDocument();
	await expect.element(treeItem).toBeInTheDocument();
	const change = changeRow.element();
	const treeRow = treeItem.element();
	expect(getComputedStyle(change.querySelector('.workspace-files__git-file')!).fontWeight).toBe(
		getComputedStyle(treeRow.querySelector('.workspace-files__name')!).fontWeight
	);
});

test('labels file search as a section label', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source() });
	await openNavigation();

	const label = page.getByText('Search files').element();
	expect(getComputedStyle(label).textTransform).toBe('uppercase');
});

test('navigates changed files with pointer and keyboard', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source() });
	await userEvent.click(page.getByRole('button', { name: 'Show inspector' }));
	const files = page.getByRole('list', { name: 'Files to review' });
	const first = files.getByRole('button').first();
	await userEvent.click(first);
	await expect
		.element(page.getByRole('region', { name: 'Diff for packages/ui/src/lib/WorkspaceFiles.svelte' }))
		.toBeInTheDocument();

	await userEvent.keyboard('{ArrowDown}');
	await expect
		.element(page.getByRole('region', { name: 'Diff for apps/web/src/lib/old-route.ts' }))
		.toBeInTheDocument();
	await userEvent.click(page.getByRole('button', { name: 'Next changed file' }));
	await expect.element(page.getByRole('region', { name: 'Diff for notes.txt' })).toBeInTheDocument();
});

test('shows detached HEAD and non-repository states', async () => {
	const detached = structuredClone(workspaceFileFixtures.gitStatus);
	detached.branch = null;
	detached.detached = true;
	const view = await render(WorkspaceFiles, {
		workspaceId: 'pau',
		workspaceName: 'pau',
		source: source({ gitStatus: async () => detached })
	});
	await openNavigation();
	await expect.element(page.getByText('Detached at 1234567')).toBeInTheDocument();
	view.unmount();

	await renderFiles(
		source({ gitStatus: async () => ({ repository: false, branch: null, head: null, detached: false, files: [] }) })
	);
	await expect.element(page.getByText('Not a Git repository')).toBeInTheDocument();
});

test('expands a deep tree and follows tree keyboard navigation', async () => {
	await renderFiles();
	const tree = page.getByRole('tree', { name: 'pau files' });
	const packages = tree.getByRole('treeitem', { name: /packages/ });

	await userEvent.click(packages);
	const ui = tree.getByRole('treeitem', { name: /ui/ });
	await expect.element(ui).toBeInTheDocument();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(ui).toHaveFocus();

	for (const name of [/ui/, /src/, /lib/]) {
		await userEvent.click(tree.getByRole('treeitem', { name }));
	}
	const longFile = tree.getByTitle(/WorkspaceFileTreeWithAnIntentionallyLongName/);
	await expect.element(longFile).toHaveAttribute('aria-level', '5');
	const name = longFile.element().querySelector<HTMLElement>('.workspace-files__name');
	expect(name).not.toBeNull();
	expect(getComputedStyle(name!).textOverflow).toBe('ellipsis');
	expect(longFile.element().scrollWidth).toBeLessThanOrEqual(tree.element().clientWidth);

	await userEvent.click(longFile);
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(tree.getByRole('treeitem', { name: /lib/ })).toHaveFocus();
});

test('reloads listings and searches with hidden and ignored-file controls', async () => {
	const listDirectory = vi.fn<WorkspaceFileSource['listDirectory']>(async () => []);
	const search = vi.fn<WorkspaceFileSource['search']>(async () => []);
	await renderFiles(source({ listDirectory, search }));

	await userEvent.click(page.getByRole('checkbox', { name: 'Show hidden files' }));
	await expect.poll(() => listDirectory.mock.calls.at(-1)?.[1]).toEqual({ includeHidden: true, includeIgnored: false });
	await userEvent.click(page.getByRole('checkbox', { name: 'Show ignored files' }));
	await expect.poll(() => listDirectory.mock.calls.at(-1)?.[1]).toEqual({ includeHidden: true, includeIgnored: true });

	await userEvent.type(page.getByRole('searchbox', { name: 'Search files' }), 'needle');
	await userEvent.keyboard('{Enter}');
	await expect.poll(() => search.mock.calls.at(-1)).toEqual(['needle', { includeHidden: true, includeIgnored: true }]);
	await expect.element(page.getByText('No matches for “needle”.')).toBeInTheDocument();
});

test('renders and opens a large search result set', async () => {
	const matches: WorkspaceSearchMatch[] = Array.from({ length: 250 }, (_, index) => ({
		path: `packages/example-${index}/src/file-with-a-long-name-${index}.ts`,
		line: index + 1,
		preview: `const needle${index} = true;`
	}));
	const onOpenFile = vi.fn();
	await render(WorkspaceFiles, {
		workspaceId: 'pau',
		workspaceName: 'pau',
		source: source({ search: async () => matches }),
		onOpenFile
	});
	await openNavigation();

	await userEvent.type(page.getByRole('searchbox', { name: 'Search files' }), 'needle');
	await userEvent.keyboard('{Enter}');
	await expect.element(page.getByText('250 matches')).toBeInTheDocument();
	const results = page.getByRole('list', { name: 'File search results' });
	await expect.element(results.getByRole('button')).toHaveLength(250);
	await userEvent.click(page.getByRole('button', { name: 'Close navigation' }));
	await userEvent.click(results.getByRole('button').first());
	expect(onOpenFile).toHaveBeenCalledWith('packages/example-0/src/file-with-a-long-name-0.ts', 1);
});

test('opens a file menu from the keyboard and runs its path actions', async () => {
	const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
	const revealPath = vi.fn().mockResolvedValue(undefined);
	const onOpenFile = vi.fn();
	await render(WorkspaceFiles, {
		workspaceId: 'pau',
		workspaceName: 'pau',
		source: source(),
		workspacePath: '/Users/operator/projects/pau/',
		revealPath,
		onOpenFile
	});
	await openNavigation();
	const readme = page.getByRole('treeitem', { name: /README\.md/ });
	await expect.element(readme).toBeVisible();
	const openMenu = async () => {
		(readme.element() as HTMLElement).focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	};

	await openMenu();
	await expect
		.element(page.getByRole('menu', { name: 'README.md actions' }))
		.toHaveTextContent(/Open.*(Reveal in Finder|Show in folder).*Copy path.*Copy relative path/);
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy relative path' }));
	expect(writeText).toHaveBeenLastCalledWith('README.md');
	await expect.element(readme).toHaveFocus();

	await openMenu();
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy path' }));
	expect(writeText).toHaveBeenLastCalledWith('/Users/operator/projects/pau/README.md');

	await openMenu();
	await userEvent.click(page.getByRole('menuitem', { name: /Reveal in Finder|Show in folder/ }));
	expect(revealPath).toHaveBeenCalledWith('/Users/operator/projects/pau/README.md');

	await openMenu();
	await userEvent.click(page.getByRole('menuitem', { name: 'Open', exact: true }));
	expect(onOpenFile).toHaveBeenCalledWith('README.md');
	writeText.mockRestore();
});

test('offers only path actions for a folder and reports a failed action', async () => {
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source(), revealPath: vi.fn() });
	await openNavigation();
	const writeText = vi
		.spyOn(navigator.clipboard, 'writeText')
		.mockRejectedValue(new Error('Clipboard is unavailable.'));

	const dev = page.getByRole('treeitem', { name: /dev/ });
	await expect.element(dev).toBeVisible();
	dev.element().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 120 }));
	await expect.element(page.getByRole('menu', { name: 'dev actions' })).toHaveTextContent('Copy relative path');
	await expect.element(page.getByRole('menuitem', { name: 'Open', exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByRole('menuitem', { name: 'Copy path' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy relative path' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Clipboard is unavailable.');
	writeText.mockRestore();
});
