import { expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionStatus, SessionWorkspace, TranscriptEntry, TranscriptTool } from '../lib/types/session';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

function workspaces(transcript: TranscriptEntry[], status: SessionStatus): SessionWorkspace[] {
	return [{ ...base, sessions: [{ ...baseSession, status, transcript }] }];
}

function tool(id: string, status: TranscriptTool['status'], result = `${id} output`): TranscriptTool {
	return { id, kind: 'tool', name: 'grep', detail: id, status, result };
}

const prompt = (id: string): TranscriptEntry => ({ id, kind: 'message', role: 'user', body: `Prompt ${id}` });

const details = (id: string) => document.querySelector<HTMLDetailsElement>(`[data-entry-id="${CSS.escape(id)}"]`)!;

async function settled(): Promise<void> {
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

test('keeps finished blocks open while the turn runs and collapses them when it ends', async () => {
	const earlier = [prompt('p1'), tool('old', 'complete')];
	const running: TranscriptEntry[] = [
		...earlier,
		prompt('p2'),
		{ id: 'think', kind: 'thinking', body: 'Planning the search.', complete: true },
		tool('done', 'complete'),
		tool('busy', 'running')
	];
	const screen = await render(SessionView, {
		workspaces: workspaces(running, 'running'),
		activeSessionId: baseSession.id
	});

	expect(details('old').open).toBe(false);
	expect(details('think').open).toBe(true);
	expect(details('done').open).toBe(true);
	expect(details('busy').open).toBe(true);

	const finished = running.map((entry) => (entry.id === 'busy' ? tool('busy', 'complete') : entry));
	await screen.rerender({ workspaces: workspaces(finished, 'waiting'), activeSessionId: baseSession.id });
	expect(details('busy').open).toBe(true);

	await screen.rerender({ workspaces: workspaces(finished, 'idle'), activeSessionId: baseSession.id });
	await expect.poll(() => details('done').open).toBe(false);
	expect(details('busy').open).toBe(false);
	expect(details('think').open).toBe(false);
	expect(details('old').open).toBe(false);
});

test('leaves blocks the operator opened or closed as they left them', async () => {
	const running: TranscriptEntry[] = [
		prompt('p1'),
		tool('old', 'complete'),
		{ id: 'think', kind: 'thinking', body: 'Planning the search.', complete: false },
		prompt('p2'),
		tool('kept', 'complete'),
		tool('closed', 'running', 'first line')
	];
	const screen = await render(SessionView, {
		workspaces: workspaces(running, 'running'),
		activeSessionId: baseSession.id
	});

	await userEvent.click(page.getByText('old', { exact: true }));
	await userEvent.click(page.getByText('kept', { exact: true }));
	await userEvent.click(page.getByText('kept', { exact: true }));
	await userEvent.click(page.getByText('closed', { exact: true }));
	await userEvent.click(page.getByText('Thinking…'));
	await expect.poll(() => details('closed').open).toBe(false);
	await expect.poll(() => details('think').open).toBe(false);

	const streamed = running.map((entry) =>
		entry.id === 'closed'
			? tool('closed', 'running', 'first line\nsecond line')
			: entry.id === 'think'
				? { ...entry, body: 'Planning the search in detail.' }
				: entry
	);
	await screen.rerender({ workspaces: workspaces(streamed, 'running'), activeSessionId: baseSession.id });
	expect(details('closed').open).toBe(false);
	expect(details('think').open).toBe(false);

	const finished = streamed.map((entry) =>
		entry.id === 'closed'
			? tool('closed', 'complete')
			: entry.kind === 'thinking'
				? { ...entry, complete: true }
				: entry
	);
	await screen.rerender({ workspaces: workspaces(finished, 'idle'), activeSessionId: baseSession.id });
	await settled();
	expect(details('old').open).toBe(true);
	expect(details('kept').open).toBe(true);
	expect(details('closed').open).toBe(false);
	expect(details('think').open).toBe(false);

	await userEvent.click(page.getByText('Thinking', { exact: true }));
	await expect.poll(() => details('think').open).toBe(true);
	await screen.rerender({
		workspaces: workspaces([...finished, prompt('p3')], 'running'),
		activeSessionId: baseSession.id
	});
	expect(details('think').open).toBe(true);
});

test('toggles tool output with Ctrl+O after the turn ends', async () => {
	const transcript = [prompt('p1'), tool('first', 'complete'), tool('second', 'complete')];
	const screen = await render(SessionView, {
		workspaces: workspaces(transcript, 'running'),
		activeSessionId: baseSession.id
	});
	await screen.rerender({ workspaces: workspaces(transcript, 'idle'), activeSessionId: baseSession.id });
	await expect.poll(() => details('first').open).toBe(false);

	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.element(page.getByLabelText('grep output').first()).toHaveTextContent('first output');
	expect(details('second').open).toBe(true);

	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.poll(() => details('first').open).toBe(false);
	expect(details('second').open).toBe(false);
});

test.each([
	['finishes', 'running', 'complete'],
	['collapses', 'idle', 'complete']
] as const)('keeps the first visible entry in place when a block above it %s', async (_, status, toolStatus) => {
	const output = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
	const replies = Array.from({ length: 30 }, (_, index) => ({
		id: `reply-${index}`,
		kind: 'message' as const,
		role: 'assistant' as const,
		body: `Reply paragraph ${index}. `.repeat(12)
	}));
	const transcript = (current: TranscriptTool): TranscriptEntry[] => [prompt('p1'), current, ...replies];
	const streaming = transcript(tool('tall', 'running', output));
	const screen = await render(SessionView, {
		workspaces: workspaces(streaming, 'running'),
		activeSessionId: baseSession.id
	});
	await settled();
	const node = document.querySelector<HTMLElement>('.session-view__transcript')!;
	const reading = details('tall').getBoundingClientRect().bottom - node.getBoundingClientRect().top + node.scrollTop;
	node.scrollTop = reading + 200;
	await expect.poll(() => node.dataset.following).toBe('false');
	await settled();
	const entry = document.querySelector('[data-entry-id="reply-3"]')!;
	const before = entry.getBoundingClientRect().top;

	const done = tool('tall', toolStatus, `${output}\n${output}`);
	await screen.rerender({ workspaces: workspaces(transcript(done), status), activeSessionId: baseSession.id });
	await settled();

	expect(details('tall').open).toBe(status === 'running');
	expect(Math.abs(entry.getBoundingClientRect().top - before)).toBeLessThanOrEqual(1);
});

const group = () => document.querySelector<HTMLDetailsElement>('[data-group-id]');

test('collapses four finished calls behind one group row and keeps a failure out of it', async () => {
	const calls = ['a', 'b', 'c', 'd'].map((id) => tool(id, 'complete'));
	await render(SessionView, {
		workspaces: workspaces([prompt('p1'), ...calls, tool('broke', 'failed')], 'idle'),
		activeSessionId: baseSession.id
	});

	await expect.element(page.getByText('4 tool calls')).toBeVisible();
	expect(group()!.open).toBe(false);
	await expect.element(page.getByText('a', { exact: true })).not.toBeVisible();
	expect(group()!.contains(details('broke'))).toBe(false);
	expect(details('broke').querySelector('summary')!.textContent).toContain('Failed');

	await userEvent.click(page.getByText('4 tool calls'));
	await expect.element(page.getByText('a', { exact: true })).toBeVisible();
	expect(details('a').querySelector(':scope > summary small')!.textContent).toBe('a output');
	expect(details('a').open).toBe(false);
});

test('keeps three finished calls as rows and opens a group with Ctrl+O', async () => {
	const screen = await render(SessionView, {
		workspaces: workspaces([prompt('p1'), ...['a', 'b', 'c'].map((id) => tool(id, 'complete'))], 'idle'),
		activeSessionId: baseSession.id
	});
	expect(group()).toBeNull();

	const four = [prompt('p1'), ...['a', 'b', 'c', 'd'].map((id) => tool(id, 'complete'))];
	await screen.rerender({ workspaces: workspaces(four, 'idle'), activeSessionId: baseSession.id });
	await expect.poll(() => group()?.open).toBe(false);

	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.poll(() => group()?.open).toBe(true);
	expect(details('d').open).toBe(true);
	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.poll(() => group()?.open).toBe(false);
});

/** The left edge of an element's first line of text. */
function textLeft(element: Element): number {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
	});
	const range = document.createRange();
	range.selectNodeContents(walker.nextNode()!);
	return range.getClientRects()[0]!.left;
}

const contentLeft = (element: Element) =>
	element.getBoundingClientRect().left + Number(getComputedStyle(element).paddingLeft.replace('px', ''));

const turn = (summary: Element) => getComputedStyle(summary.querySelector('.pau-disclosure__chevron')!).rotate;

const disclosureTranscript: TranscriptEntry[] = [
	prompt('p1'),
	{ id: 'think', kind: 'thinking', body: 'Check the wrap tests first.', complete: true },
	{ id: 'squash', kind: 'compaction', reason: 'manual', summary: 'Earlier work.', tokensBefore: 900, tokensAfter: 90 },
	...['a', 'b', 'c', 'd'].map((id) => tool(id, 'complete')),
	tool('broke', 'failed')
];

test('puts message text, disclosure summaries, and tool bodies on one leading edge', async () => {
	await page.viewport(1440, 900);
	await render(SessionView, { workspaces: workspaces(disclosureTranscript, 'idle'), activeSessionId: baseSession.id });
	await userEvent.click(page.getByText('4 tool calls'));
	for (const id of ['think', 'a', 'broke']) {
		if (!details(id).open) await userEvent.click(details(id).querySelector('summary')!);
		await expect.poll(() => details(id).open).toBe(true);
	}

	const edge = textLeft(document.querySelector('.session-message--user p')!);
	const edges = {
		eyebrow: textLeft(document.querySelector('.session-message--user h2')!),
		thinking: textLeft(details('think').querySelector('summary')!),
		thinkingBody: textLeft(details('think').querySelector('p')!),
		compaction: textLeft(details('squash').querySelector('summary')!),
		group: textLeft(group()!.querySelector('summary')!),
		grouped: textLeft(details('a').querySelector('.tool-call__name')!),
		groupedBody: contentLeft(details('a').querySelector('.tool-call__body')!),
		tool: textLeft(details('broke').querySelector('.tool-call__name')!),
		toolBody: contentLeft(details('broke').querySelector('.tool-call__body')!)
	};
	for (const [name, left] of Object.entries(edges)) expect({ name, left }).toEqual({ name, left: edge });
	// The inset sits one gutter in from the transcript's left edge, where assistant prose starts.
	expect(edge - document.querySelector('.session-message--user')!.getBoundingClientRect().left).toBe(24);
});

test('marks every disclosure with a chevron that turns when it opens', async () => {
	await render(SessionView, { workspaces: workspaces(disclosureTranscript, 'idle'), activeSessionId: baseSession.id });
	await userEvent.click(page.getByText('4 tool calls'));

	const summaries = [...document.querySelectorAll('.session-view__transcript summary')];
	expect(summaries).toHaveLength(8);
	for (const summary of summaries) {
		await expect.element(summary.querySelector<HTMLElement>(':scope > .pau-disclosure__chevron')).toBeVisible();
		expect(getComputedStyle(summary).listStyleType).toBe('none');
	}
	await expect.poll(() => turn(group()!.querySelector('summary')!)).toBe('90deg');
	expect(turn(details('a').querySelector('summary')!)).toBe('none');
});

test('lifts a tool summary to the normal text color on hover', async () => {
	await render(SessionView, { workspaces: workspaces(disclosureTranscript, 'idle'), activeSessionId: baseSession.id });
	const summary = details('broke').querySelector('summary')!;
	const label = summary.querySelector('.tool-call__name')!;
	const rest = getComputedStyle(label).color;

	await userEvent.hover(summary);
	await expect.poll(() => getComputedStyle(label).color).not.toBe(rest);
	await expect.poll(() => getComputedStyle(label).color).toBe(getComputedStyle(summary.querySelector('code')!).color);
});
