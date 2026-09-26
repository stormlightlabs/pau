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
	const onOpenFile = vi.fn();
	await render(WorkspaceFiles, { workspaceId: 'pau', workspaceName: 'pau', source: source(), onOpenFile });
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
	expect(onOpenFile).toHaveBeenCalledWith('packages/ui/src/lib/WorkspaceFiles.svelte');
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
