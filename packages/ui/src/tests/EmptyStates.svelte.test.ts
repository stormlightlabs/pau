import { page } from 'vitest/browser';
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import ProcessesView from '../lib/ProcessesView.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';
import FilesDemo from '../stories/WorkspaceFilesDemo.svelte';
import TerminalDemo from '../stories/TerminalSurfaceDemo.svelte';

const viewportHeight = 900;

const left = (element: Element) => element.getBoundingClientRect().left;
const top = (element: Element) => element.getBoundingClientRect().top;

/** The heading sits near the top of a tall pane instead of at its vertical center. */
const expectTopAligned = (heading: Element) => expect(top(heading)).toBeLessThan(viewportHeight / 4);

const blankSession: SessionWorkspace[] = [
	{ id: 'pau', name: 'Pau', sessions: [{ ...sessionFixtures.idle[0]!.sessions[0]!, transcript: [] }] }
];

const startable = { onStartSession: async () => {} };

describe.each([1440, 900])('at %ipx', (width) => {
	beforeEach(async () => {
		await page.viewport(width, viewportHeight);
	});

	/** The transcript column's left edge for the same viewport, from a session that has a transcript. */
	async function transcriptLeft() {
		const { unmount } = await render(SessionView, {
			workspaces: sessionFixtures.running,
			activeSessionId: sessionFixtures.running[0]!.sessions[0]!.id
		});
		const edge = left(page.getByRole('region', { name: 'Transcript' }).element());
		unmount();
		return edge;
	}

	const sessionStates: [string, string, Record<string, unknown>][] = [
		['No session selected', 'No session selected', { workspaces: sessionFixtures.idle, ...startable }],
		['Loading sessions…', 'Loading sessions…', { workspaces: sessionFixtures.empty, loading: true }],
		[
			'first run',
			'Open a folder to start working',
			{ workspaces: sessionFixtures.empty, onOpenWorkspace: async () => 'pau' }
		],
		[
			'start prompt',
			'Start with a prompt',
			{ workspaces: blankSession, activeSessionId: blankSession[0]!.sessions[0]!.id }
		]
	];

	test.each(sessionStates)('starts the %s state at the transcript column, top-aligned', async (_name, title, props) => {
		const edge = await transcriptLeft();
		await render(SessionView, props);

		const heading = page.getByRole('heading', { name: title }).element();
		expect(left(heading)).toBe(edge);
		expectTopAligned(heading);
	});

	test('aligns the Files empty state with the header title, top-aligned', async () => {
		await render(FilesDemo, { state: 'default' });

		const heading = page.getByRole('heading', { name: 'No file selected' }).element();
		const title = page.getByRole('heading', { level: 1, name: 'pau' }).element();
		expect(left(heading)).toBe(left(title));
		expectTopAligned(heading);
	});

	test('aligns the Processes empty state with the header title, top-aligned', async () => {
		await render(ProcessesView, { workspaceName: 'Pau', processes: [] });

		const heading = page.getByRole('heading', { name: 'No managed processes' }).element();
		expect(left(heading)).toBe(left(page.getByRole('heading', { name: 'Processes', exact: true }).element()));
		expectTopAligned(heading);
	});

	test('top-aligns the terminal empty state with its action beneath', async () => {
		await render(TerminalDemo, {});

		const heading = page.getByRole('heading', { name: 'No terminals open' }).element();
		expectTopAligned(heading);
		expect(top(page.getByRole('button', { name: 'Open a terminal' }).element())).toBeGreaterThan(top(heading));
	});
});
