import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { commandFixtures } from '../fixtures/commands';
import { sessionFixtures } from '../fixtures/sessions';
import { TERMINAL_ONLY_REASON } from '../lib/builtin-commands';
import { Keymap, keymapContext } from '../lib/keymap.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

const models = [
	{ provider: 'anthropic', id: 'sonnet', name: 'Sonnet', reasoning: true, current: true },
	{ provider: 'openai', id: 'gpt', name: 'GPT', reasoning: true, current: false }
];

/** An idle Pi session that supports every control the built-ins map to. */
function workspaces(): SessionWorkspace[] {
	const [workspace] = sessionFixtures.idle;
	const [session] = workspace!.sessions;
	return [
		{
			...workspace!,
			sessions: [
				{
					...session!,
					thinkingLevel: 'low',
					capabilities: {
						...session!.capabilities,
						commandDiscovery: true,
						modelSelection: true,
						thinkingLevel: true,
						compaction: true,
						rename: true
					}
				}
			]
		}
	];
}

async function setup() {
	const handlers = {
		onSend: vi.fn(),
		onSelectThinkingLevel: vi.fn(),
		onLoadModels: vi.fn().mockResolvedValue(models),
		onSelectModel: vi.fn(),
		onCompact: vi.fn(),
		onRenameSession: vi.fn(),
		onOpenPiTerminal: vi.fn(),
		onLoadCommands: vi.fn().mockResolvedValue(commandFixtures.populated)
	};
	await render(SessionView, {
		props: { workspaces: workspaces(), activeSessionId: 'session-idle', ...handlers },
		context: new Map([[keymapContext, new Keymap({ platform: 'other' })]])
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);
	return { ...handlers, prompt };
}

/** Types a command and submits it with Enter once completion has closed. */
async function run(prompt: ReturnType<typeof page.getByRole>, text: string) {
	await userEvent.type(prompt, text);
	await userEvent.keyboard('{Escape}{Enter}');
}

test('completes built-ins after the session commands, with their arguments', async () => {
	const { prompt } = await setup();
	await userEvent.type(prompt, '/thin');

	const option = page.getByRole('listbox', { name: 'Commands' }).getByRole('option');
	await expect.element(option).toHaveLength(1);
	await expect.element(option).toHaveTextContent('/thinking [level]');
	await expect.element(option).toHaveTextContent('Pi');
	await userEvent.keyboard('{Tab}');
	await expect.element(prompt).toHaveValue('/thinking ');
});

test('renames the session with /name instead of sending it', async () => {
	const { prompt, onRenameSession, onSend } = await setup();
	await run(prompt, '/name Release prep');

	expect(onRenameSession).toHaveBeenCalledWith('session-idle', 'Release prep');
	expect(onSend).not.toHaveBeenCalled();
	await expect.element(prompt).toHaveValue('');
});

test('selects a model with /model and explains a model that does not match', async () => {
	const { prompt, onSelectModel, onSend } = await setup();
	await run(prompt, '/model openai/gpt');
	await expect.poll(() => onSelectModel).toHaveBeenCalledWith('session-idle', models[1]);

	await run(prompt, '/model nope');
	await expect.element(page.getByRole('alert')).toHaveTextContent('No model matches nope.');
	await expect.element(prompt).toHaveValue('');
	expect(onSend).not.toHaveBeenCalled();
});

test('sets the thinking level with /thinking and keeps an unknown level in the draft', async () => {
	const { prompt, onSelectThinkingLevel } = await setup();
	await run(prompt, '/thinking high');
	expect(onSelectThinkingLevel).toHaveBeenCalledWith('session-idle', 'high');

	await run(prompt, '/thinking extreme');
	await expect.element(page.getByRole('alert')).toHaveTextContent('Choose a thinking level: off, minimal');
	await expect.element(prompt).toHaveValue('/thinking extreme');
	expect(onSelectThinkingLevel).toHaveBeenCalledTimes(1);
});

test('compacts with /compact and passes its instructions', async () => {
	const { prompt, onCompact, onSend } = await setup();
	await run(prompt, '/compact Keep the API notes');

	expect(onCompact).toHaveBeenCalledWith('session-idle', 'Keep the API notes');
	expect(onSend).not.toHaveBeenCalled();
});

test('lists a terminal-only built-in as unavailable with its reason', async () => {
	const { prompt, onSend, onOpenPiTerminal } = await setup();
	await userEvent.type(prompt, '/login');

	const option = page.getByRole('option', { name: /\/login/ });
	await expect.element(option).toHaveAttribute('aria-disabled', 'true');
	await expect.element(option).toHaveTextContent(TERMINAL_ONLY_REASON);
	await userEvent.keyboard('{Enter}');
	await expect.element(prompt).toHaveValue('/login');

	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByText(`/login: ${TERMINAL_ONLY_REASON}`)).toBeVisible();
	await userEvent.keyboard('{Enter}');
	await expect.element(page.getByRole('alert')).toHaveTextContent(TERMINAL_ONLY_REASON);
	expect(onSend).not.toHaveBeenCalled();

	await page.getByRole('button', { name: 'Open Pi in terminal' }).click();
	expect(onOpenPiTerminal).toHaveBeenCalledWith('session-idle');
});
