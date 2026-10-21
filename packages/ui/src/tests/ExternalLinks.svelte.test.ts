import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { externalLinkContext, type ExternalLinkOpener } from '../lib/external-links';
import Markdown from '../lib/Markdown.svelte';
import { safeHref } from '../lib/markdown';
import SessionView from '../lib/SessionView.svelte';
import TerminalView from '../lib/TerminalView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';
import type { TerminalConnection, TerminalConnectionEvents } from '../lib/types/terminal';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

function sessionProps(body: string) {
	const transcript: SessionViewModel['transcript'] = [{ id: 'a1', kind: 'message', role: 'assistant', body }];
	const workspaces: SessionWorkspace[] = [{ ...base, sessions: [{ ...baseSession, transcript }] }];
	return { workspaces, activeSessionId: baseSession.id };
}

/** Records whether the app cancelled each link click, then cancels it so the test page stays put. */
function watchClicks(): boolean[] {
	const cancelled: boolean[] = [];
	const record = (event: MouseEvent) => {
		cancelled.push(event.defaultPrevented);
		event.preventDefault();
	};
	addEventListener('click', record);
	stops.push(() => removeEventListener('click', record));
	return cancelled;
}

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

test('a transcript link asks the desktop shell to open it by mouse and keyboard', async () => {
	const open = vi.fn<ExternalLinkOpener>().mockResolvedValue(undefined);
	const cancelled = watchClicks();
	await render(SessionView, {
		props: sessionProps('See [the docs](https://example.com/docs).'),
		context: new Map([[externalLinkContext, open]])
	});
	const link = page.getByRole('link', { name: 'the docs' });

	await link.click();
	expect(open).toHaveBeenLastCalledWith('https://example.com/docs');

	(link.element() as HTMLElement).focus();
	await userEvent.keyboard('{Enter}');
	expect(open).toHaveBeenCalledTimes(2);
	expect(cancelled).toEqual([true, true]);
});

test('unsafe schemes never become links or reach the shell', async () => {
	const open = vi.fn<ExternalLinkOpener>().mockResolvedValue(undefined);
	const text = [
		'[script](javascript:alert(1))',
		'[file](file:///etc/passwd)',
		'[data](data:text/html,hi)',
		'[custom](pau-test://open)',
		'[mail](mailto:a@example.com)'
	].join(' ');
	const { container } = await render(Markdown, { props: { text }, context: new Map([[externalLinkContext, open]]) });

	expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
		'mailto:a@example.com'
	]);
	await page.getByText('script').click();
	expect(open).not.toHaveBeenCalled();
	for (const href of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'pau-test://open']) {
		expect(safeHref(href)).toBeUndefined();
	}
});

test('without a desktop shell a link keeps the browser new-tab behavior', async () => {
	const cancelled = watchClicks();
	await render(Markdown, { text: 'See [the docs](https://example.com/docs).' });
	const link = page.getByRole('link', { name: 'the docs' });

	await expect.element(link).toHaveAttribute('target', '_blank');
	await link.click();
	expect(cancelled).toEqual([false]);
});

test('a terminal hyperlink opens through the shell and an unsafe one does not', async () => {
	const open = vi.fn<ExternalLinkOpener>().mockResolvedValue(undefined);
	const output =
		'\u{1B}]8;;https://example.com/docs\u{7}docs\u{1B}]8;;\u{7}\r\n\u{1B}]8;;javascript:alert(1)\u{7}trap\u{1B}]8;;\u{7}';
	const connect = (events: TerminalConnectionEvents): TerminalConnection => {
		events.output(new TextEncoder().encode(output));
		return { write: () => {}, resize: () => {}, close: () => {} };
	};
	await render(TerminalView, { props: { label: 'Links', connect }, context: new Map([[externalLinkContext, open]]) });
	await expect.poll(() => document.querySelector('.xterm-rows')?.textContent ?? '').toContain('trap');
	const rows = document.querySelectorAll<HTMLElement>('.xterm-rows > div');
	const screen = document.querySelector<HTMLElement>('.xterm-screen')!;

	for (const row of [rows[1]!, rows[0]!]) {
		const box = row.getBoundingClientRect();
		const position = { x: 6, y: box.top - screen.getBoundingClientRect().top + box.height / 2 };
		await userEvent.hover(screen, { position });
		await userEvent.click(screen, { position });
	}

	await expect.poll(() => open.mock.calls).toEqual([['https://example.com/docs']]);
});
