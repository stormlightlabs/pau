import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { modelFixtures } from '../fixtures/models';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import ThinkingLevelPicker from '../lib/ThinkingLevelPicker.svelte';
import { thinkingLevels, type ModelOption, type SessionWorkspace, type ThinkingLevel } from '../lib/types/session';

const picker = () => page.getByRole('combobox', { name: 'Thinking level' });

const labels: [ThinkingLevel, string][] = [
	['off', 'Off'],
	['minimal', 'Minimal'],
	['low', 'Low'],
	['medium', 'Medium'],
	['high', 'High'],
	['xhigh', 'Extra high'],
	['max', 'Max']
];

async function choose(label: string): Promise<void> {
	await userEvent.click(picker());
	await userEvent.click(page.getByRole('option', { name: label, exact: true }));
}

function withThinking(workspaces: SessionWorkspace[]): SessionWorkspace[] {
	return workspaces.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({
			...session,
			thinkingLevel: 'medium' as const,
			capabilities: { ...session.capabilities, modelSelection: true, thinkingLevel: true }
		}))
	}));
}

function composerProps(models: ModelOption[] = modelFixtures.populated) {
	return { onLoadModels: async () => models, onSelectModel: vi.fn(), onSelectThinkingLevel: vi.fn() };
}

test('lists every level by its display name', async () => {
	expect(labels.map(([level]) => level)).toEqual([...thinkingLevels]);
	await render(ThinkingLevelPicker, { level: 'medium', reasoning: true, onSelect: vi.fn() });

	await userEvent.click(picker());

	const options = page
		.getByRole('option')
		.elements()
		.map((option) => option.textContent?.trim());
	expect(options).toEqual(labels.map(([, label]) => label));
	await expect.element(page.getByRole('option', { name: 'Medium' })).toHaveAttribute('aria-selected', 'true');
});

test.each(labels)('shows %s as %s', async (level, label) => {
	await render(ThinkingLevelPicker, { level, reasoning: true, onSelect: vi.fn() });

	await expect.element(picker()).toHaveTextContent(label);
	await expect.element(picker()).toBeEnabled();
});

test.each(labels)('selects %s from %s', async (level, label) => {
	const onSelect = vi.fn();
	await render(ThinkingLevelPicker, { level: level === 'off' ? 'low' : 'off', reasoning: true, onSelect });

	await choose(label);

	expect(onSelect).toHaveBeenCalledWith(level);
});

test('shows a prompt until the agent reports a level', async () => {
	await render(ThinkingLevelPicker, { reasoning: true, onSelect: vi.fn() });

	await expect.element(picker()).toHaveTextContent('Choose a level');
});

test('keeps the previous level and explains a rejection', async () => {
	const onSelect = vi.fn().mockRejectedValue(new Error('Pi rejected the request: Level not supported'));
	await render(ThinkingLevelPicker, { level: 'low', reasoning: true, onSelect });

	await choose('Max');

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: Level not supported');
	await expect.element(picker()).toHaveTextContent('Low');
});

test('is disabled and explained for a model without thinking levels', async () => {
	await render(ThinkingLevelPicker, { reasoning: false, onSelect: vi.fn() });

	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/does not offer thinking levels/);
});

test('is disabled and explained when the agent cannot change the level', async () => {
	await render(ThinkingLevelPicker, { supported: false, onSelect: vi.fn() });

	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/does not support changing the thinking level/);
});

test('the composer enables the control for an idle session on a reasoning model', async () => {
	await render(SessionView, {
		workspaces: withThinking(sessionFixtures.idle),
		activeSessionId: 'session-idle',
		...composerProps()
	});

	await expect.element(picker()).toHaveTextContent('Medium');
	await expect.element(picker()).toBeEnabled();
});

test('the composer disables the control for a model without reasoning', async () => {
	const models = modelFixtures.populated.map((model) => ({ ...model, current: model.id === 'claude-haiku-4-5' }));
	await render(SessionView, {
		workspaces: withThinking(sessionFixtures.idle),
		activeSessionId: 'session-idle',
		...composerProps(models)
	});

	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/does not offer thinking levels/);
});

test('the composer disables the control while a run is in progress', async () => {
	await render(SessionView, {
		workspaces: withThinking(sessionFixtures.running),
		activeSessionId: 'session-running',
		...composerProps()
	});

	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/Wait for this run/);
});
