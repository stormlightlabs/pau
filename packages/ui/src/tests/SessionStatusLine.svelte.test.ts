import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { usageFixtures } from '../fixtures/usage';
import SessionStatusLine from '../lib/SessionStatusLine.svelte';

const line = () => page.getByRole('group', { name: 'Session status' });
const usage = {
	tokens: { input: 182_000, output: 24_100, cacheRead: 1_200_000, cacheWrite: 96_000, total: 1_502_100 },
	cost: 3.42
};

test('shows the folder, branch, token figures, and cost', async () => {
	await render(SessionStatusLine, {
		path: '/Users/operator/projects/pau',
		branch: 'main',
		usage,
		usageSupported: true
	});

	await expect.element(line()).toHaveTextContent('Working directory /Users/operator/projects/pau');
	await expect.element(line()).toHaveTextContent('Branch main');
	await expect.element(line()).toHaveTextContent('Input tokens 182k');
	await expect.element(line()).toHaveTextContent('Output tokens 24.1k');
	await expect.element(line()).toHaveTextContent('Cache read 1.2M');
	await expect.element(line()).toHaveTextContent('Cache write 96k');
	await expect.element(line()).toHaveTextContent('Cost $3.42');
});

test('leaves out zero figures before the first reply', async () => {
	await render(SessionStatusLine, {
		path: '/Users/operator/projects/pau',
		usage: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
		usageSupported: true
	});

	await expect.element(line()).toHaveTextContent('/Users/operator/projects/pau');
	await expect.element(line()).not.toHaveTextContent(/tokens|Cache|Cost/);
});

test('shows the folder without figures when stats are missing or unsupported', async () => {
	const missing = await render(SessionStatusLine, { path: '/Users/operator/projects/pau', usageSupported: true });
	await expect.element(line()).not.toHaveTextContent(/tokens|Cost/);
	missing.unmount();

	await render(SessionStatusLine, {
		path: '/Users/operator/projects/pau',
		usage: usageFixtures.normal,
		usageSupported: false
	});
	await expect.element(line()).not.toHaveTextContent(/tokens|Cost/);
});

test('renders nothing when it has nothing to show', async () => {
	await render(SessionStatusLine, {});
	await expect.element(line()).not.toBeInTheDocument();
});

test('orders extension statuses by key and flattens them to one line', async () => {
	await render(SessionStatusLine, {
		statuses: [
			{ key: 'todos', text: '2/5' },
			{ key: 'mode', text: 'plan mode\noff' },
			{ key: 'empty', text: '  ' }
		]
	});

	await expect.element(line()).toHaveTextContent(/^plan mode off\W*2\/5$/);
});

test('truncates a long path from the start before any figure shrinks', async () => {
	const target = document.createElement('div');
	target.style.width = '36rem';
	document.body.append(target);
	const path = '/Users/operator/projects/a-very-long-folder-name/with/many/nested/levels/that/keep/going/packages/ui';
	await render(SessionStatusLine, {
		target,
		props: { path, branch: 'design-file-rebuild', usage, usageSupported: true }
	});

	const text = target.querySelector<HTMLElement>('.status-line__path-text');
	const figures = target.querySelector<HTMLElement>('.status-line__figures');
	expect(text && text.scrollWidth > text.clientWidth).toBe(true);
	expect(figures?.scrollWidth).toBe(figures?.clientWidth);
	expect(target.scrollWidth).toBe(target.clientWidth);
	// Right-to-left overflow keeps the end of the path, where the folder name is, in view.
	const visible = text!.getBoundingClientRect();
	const range = document.createRange();
	range.selectNodeContents(text!);
	const last = [...range.getClientRects()].at(-1)!;
	expect(last.right).toBeLessThanOrEqual(visible.right + 1);
	await expect.element(line()).toHaveTextContent('Cost $3.42');
	target.remove();
});

test('wraps extension statuses under the session details in a narrow line', async () => {
	const target = document.createElement('div');
	target.style.width = '30rem';
	document.body.append(target);
	await render(SessionStatusLine, {
		target,
		props: {
			path: '/Users/operator/projects/pau',
			usage,
			usageSupported: true,
			statuses: [
				{ key: 'todos', text: 'todos 2/5' },
				{ key: 'plan', text: 'plan mode off' },
				{ key: 'mcp', text: 'MCP: 3 servers connected' }
			]
		}
	});

	const session = target.querySelector<HTMLElement>('.status-line__session')!.getBoundingClientRect();
	const extensions = target.querySelector<HTMLElement>('.status-line__extensions')!.getBoundingClientRect();
	expect(extensions.top).toBeGreaterThanOrEqual(session.bottom);
	expect(target.scrollWidth).toBe(target.clientWidth);
	target.remove();
});
