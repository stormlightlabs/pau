import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { commandFixtures } from '../fixtures/commands';
import { sessionFixtures } from '../fixtures/sessions';
import { Keymap, keymapContext, type PiKeyBinding } from '../lib/keymap.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

const models = [
	{ provider: 'anthropic', id: 'sonnet', name: 'Sonnet', reasoning: true, current: true },
	{ provider: 'openai', id: 'gpt', name: 'GPT', reasoning: true, current: false }
];

/** A session that can switch models and thinking levels, with a queue while it runs. */
function workspaces(status: 'idle' | 'running'): SessionWorkspace[] {
	const [workspace] = status === 'running' ? sessionFixtures.queued : sessionFixtures.idle;
	const [session] = workspace!.sessions;
	return [
		{
			...workspace!,
			sessions: [
				{
					...session!,
					thinkingLevel: 'low',
					capabilities: { ...session!.capabilities, modelSelection: true, thinkingLevel: true }
				}
			]
		}
	];
}

async function setup(status: 'idle' | 'running', piBindings?: PiKeyBinding[]) {
	const handlers = {
		onSend: vi.fn(),
		onInterrupt: vi.fn(),
		onClearQueue: vi.fn().mockResolvedValue({ steering: ['Keep the public API unchanged.'], followUp: [] }),
		onSelectThinkingLevel: vi.fn(),
		onLoadModels: vi.fn().mockResolvedValue(models),
		onSelectModel: vi.fn(),
		onLoadCommands: vi.fn().mockResolvedValue(commandFixtures.populated)
	};
	const keymap = new Keymap({ platform: 'other' });
	if (piBindings) keymap.setPiBindings(piBindings);
	await render(SessionView, {
		props: { workspaces: workspaces(status), activeSessionId: `session-${status}`, ...handlers },
		context: new Map([[keymapContext, keymap]])
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);
	return { ...handlers, prompt };
}

test('follows Pi default composer keys while idle', async () => {
	const { onSend, onInterrupt, onSelectThinkingLevel, prompt } = await setup('idle');

	await userEvent.type(prompt, 'First line');
	await userEvent.keyboard('{Shift>}{Enter}{/Shift}second{Control>}j{/Control}third');
	await expect.element(prompt).toHaveValue('First line\nsecond\nthird');
	expect(onSend).not.toHaveBeenCalled();

	await userEvent.keyboard('{Enter}');
	expect(onSend).toHaveBeenCalledWith('session-idle', 'First line\nsecond\nthird', undefined);

	await userEvent.type(prompt, 'Queue nothing while idle');
	await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
	expect(onSend).toHaveBeenLastCalledWith('session-idle', 'Queue nothing while idle', undefined);

	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).not.toHaveBeenCalled();

	await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
	expect(onSelectThinkingLevel).toHaveBeenCalledWith('session-idle', 'medium');
	await expect.element(prompt).toHaveFocus();

	await userEvent.keyboard('{Control>}l{/Control}');
	const list = page.getByRole('group', { name: 'Models' });
	await expect.element(list.getByRole('button', { name: /Sonnet/ })).toHaveFocus();
});

test('follows Pi default composer keys while running', async () => {
	const { onSend, onInterrupt, onClearQueue, onSelectThinkingLevel, prompt } = await setup('running');

	await userEvent.type(prompt, 'Use the existing helper.');
	await userEvent.keyboard('{Enter}');
	expect(onSend).toHaveBeenLastCalledWith('session-running', 'Use the existing helper.', 'steer');

	await userEvent.type(prompt, 'Then update the changelog.');
	await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
	expect(onSend).toHaveBeenLastCalledWith('session-running', 'Then update the changelog.', 'follow-up');

	await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
	expect(onClearQueue).toHaveBeenCalledWith('session-running');
	await expect.element(prompt).toHaveValue('Keep the public API unchanged.');

	await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
	expect(onSelectThinkingLevel).not.toHaveBeenCalled();
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Wait for this run to finish before changing the thinking level.');

	await userEvent.keyboard('{Control>}l{/Control}');
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Wait for this run to finish before switching models.');
	await expect.element(page.getByRole('group', { name: 'Models' })).not.toBeInTheDocument();

	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).toHaveBeenCalledWith('session-running');
});

test("uses the operator's keybindings over Pi's defaults", async () => {
	const { onSend, onInterrupt, prompt } = await setup('running', [
		{ action: 'tui.input.submit', keys: ['ctrl+s'] },
		{ action: 'tui.input.newLine', keys: ['enter'] },
		{ action: 'app.interrupt', keys: ['ctrl+c'] }
	]);
	await expect.element(page.getByRole('button', { name: /Send prompt/ })).toHaveTextContent('Ctrl+S');
	await expect.element(page.getByRole('button', { name: /Interrupt/ })).toHaveTextContent('Ctrl+C');

	await userEvent.type(prompt, 'One');
	await userEvent.keyboard('{Enter}two');
	await expect.element(prompt).toHaveValue('One\ntwo');
	expect(onSend).not.toHaveBeenCalled();

	await userEvent.keyboard('{Control>}s{/Control}');
	expect(onSend).toHaveBeenCalledWith('session-running', 'One\ntwo', 'steer');

	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).not.toHaveBeenCalled();
	await userEvent.keyboard('{Control>}c{/Control}');
	expect(onInterrupt).toHaveBeenCalledWith('session-running');
});

test('Escape closes command completion before it interrupts the run', async () => {
	const { onInterrupt, prompt } = await setup('running');

	await userEvent.type(prompt, '/');
	await expect.element(page.getByRole('listbox')).toBeVisible();
	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	expect(onInterrupt).not.toHaveBeenCalled();

	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).toHaveBeenCalledWith('session-running');
});
