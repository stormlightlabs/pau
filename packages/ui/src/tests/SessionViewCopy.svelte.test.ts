import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { markdownFixtures } from '../fixtures/markdown';
import { sessionFixtures } from '../fixtures/sessions';
import Markdown from '../lib/Markdown.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';
import { stubClipboard } from './clipboard-stub';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

function props(transcript: SessionViewModel['transcript']) {
	const workspaces: SessionWorkspace[] = [{ ...base, sessions: [{ ...baseSession, transcript }] }];
	return { workspaces, activeSessionId: baseSession.id };
}

const markdown = '**Done.** Run `pnpm test`.\n\n```ts\nconst a = 1;\n```';
const entries = [
	{ id: 'u1', kind: 'message' as const, role: 'user' as const, body: 'Use **raw** text' },
	{ id: 'a1', kind: 'message' as const, role: 'assistant' as const, body: markdown }
];

const announcer = () => document.querySelector('.session-view__announcer')!.textContent;

test('copies an assistant message as Markdown and a user message as typed', async () => {
	const writeText = stubClipboard();
	await render(SessionView, props(entries));

	await page.getByRole('button', { name: 'Copy reply' }).click();
	expect(writeText).toHaveBeenLastCalledWith(markdown);
	await expect.element(page.getByRole('button', { name: 'Copy reply' })).toHaveTextContent('Copied');
	await expect.poll(announcer).toBe('Copied');

	await page.getByRole('button', { name: 'Copy your message' }).click();
	expect(writeText).toHaveBeenLastCalledWith('Use **raw** text');
});

test('copies only the code of a code block', async () => {
	const writeText = stubClipboard();
	await render(Markdown, { text: markdownFixtures.code });

	await page.getByRole('button', { name: 'Copy code' }).first().click();
	expect(writeText).toHaveBeenLastCalledWith(
		'export function width(rows: number): number {\n\treturn Math.max(rows.toString().length, 2);\n}'
	);
});

test('copies a streaming message as it stands at the click', async () => {
	const writeText = stubClipboard();
	const screen = await render(SessionView, props([{ ...entries[1]!, body: 'Reading the' }]));
	await screen.rerender(props([{ ...entries[1]!, body: 'Reading the files' }]));

	await page.getByRole('button', { name: 'Copy reply' }).click();
	expect(writeText).toHaveBeenLastCalledWith('Reading the files');
});

test('shows and announces a clipboard failure', async () => {
	stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
	await render(SessionView, props(entries));

	await page.getByRole('button', { name: 'Copy reply' }).click();
	await expect.element(page.getByRole('button', { name: 'Copy reply' })).toHaveTextContent('Copy failed');
	await expect.poll(announcer).toBe('The clipboard refused the copy.');
});

test('copyMessage and copyLastReply copy for other callers', async () => {
	const writeText = stubClipboard();
	const screen = await render(SessionView, props(entries));
	const view = screen.component as unknown as {
		copyMessage: (id: string) => Promise<unknown>;
		copyLastReply: () => Promise<unknown>;
	};

	expect(await view.copyMessage('u1')).toEqual({ ok: true });
	expect(writeText).toHaveBeenLastCalledWith('Use **raw** text');
	expect(await view.copyLastReply()).toEqual({ ok: true });
	expect(writeText).toHaveBeenLastCalledWith(markdown);
	expect(await view.copyMessage('missing')).toBeUndefined();
});
