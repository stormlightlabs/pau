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

function withThinking(
	workspaces: SessionWorkspace[],
	thinkingLevel: ThinkingLevel = 'medium',
	thinkingLevels?: ThinkingLevel[]
): SessionWorkspace[] {
	return workspaces.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({
			...session,
			thinkingLevel,
			thinkingLevels,
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

test.each([600, 1440])('keeps a rejection message inside a %ipx window', async (width) => {
	await page.viewport(width, 400);
	const onSelect = vi.fn().mockRejectedValue(new Error('Pi rejected the request: Level not supported'));
	await render(ThinkingLevelPicker, { level: 'low', reasoning: true, onSelect });

	await choose('Max');

	const alert = page.getByRole('alert');
	await expect.element(alert).toBeVisible();
	const box = alert.element().getBoundingClientRect();
	expect(box.left).toBeGreaterThanOrEqual(0);
	expect(box.left).toBe(picker().element().getBoundingClientRect().left);
	expect(box.right).toBeLessThanOrEqual(innerWidth);
});

test('is disabled and explained for a model without thinking levels', async () => {
	await render(ThinkingLevelPicker, { reasoning: false, onSelect: vi.fn() });

	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/does not offer thinking levels/);
});

const optionLabels = () =>
	page
		.getByRole('option')
		.elements()
		.map((option) => option.textContent?.trim());

test('lists only the levels the model offers', async () => {
	await render(ThinkingLevelPicker, { level: 'low', levels: ['off', 'low', 'high'], onSelect: vi.fn() });

	await userEvent.click(picker());

	expect(optionLabels()).toEqual(['Off', 'Low', 'High']);
	await expect.element(page.getByRole('option', { name: 'Low' })).toHaveAttribute('aria-selected', 'true');
});

test('shows Off and is explained for a model that reports only off', async () => {
	await render(ThinkingLevelPicker, { level: 'off', levels: ['off'], onSelect: vi.fn() });

	await expect.element(picker()).toHaveTextContent('Off');
	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveAccessibleDescription(/does not offer thinking levels/);
});

test('shows a reported level the model does not offer without choosing it again', async () => {
	const onSelect = vi.fn();
	await render(ThinkingLevelPicker, { level: 'max', levels: ['off', 'low', 'high'], onSelect });

	await expect.element(picker()).toHaveTextContent('Max');
	await userEvent.click(picker());
	const max = page.getByRole('option', { name: 'Max' });
	await expect.element(max).toHaveAttribute('aria-disabled', 'true');
	await expect.element(max).toHaveAccessibleDescription('This model does not offer this level.');
	await userEvent.keyboard('{Enter}');
	expect(onSelect).not.toHaveBeenCalled();
});

test('keeps an open list usable when the model changes', async () => {
	const onSelect = vi.fn();
	const view = await render(ThinkingLevelPicker, { level: 'medium', onSelect });
	(picker().element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
	await expect.element(page.getByRole('option', { name: 'Extra high' })).toHaveClass(/select__option--active/);

	await view.rerender({ level: 'medium', levels: ['off', 'low', 'medium', 'high'], onSelect });

	await expect.element(picker()).toHaveAttribute('aria-expanded', 'true');
	expect(optionLabels()).toEqual(['Off', 'Low', 'Medium', 'High']);
	await expect.element(page.getByRole('option', { name: 'Medium' })).toHaveClass(/select__option--active/);
	await userEvent.keyboard('{ArrowDown}{Enter}');
	expect(onSelect).toHaveBeenCalledWith('high');
});

test('closes an open list when the new model has no thinking levels', async () => {
	const view = await render(ThinkingLevelPicker, { level: 'medium', onSelect: vi.fn() });
	await userEvent.click(picker());
	await expect.element(picker()).toHaveAttribute('aria-expanded', 'true');

	await view.rerender({ level: 'off', levels: ['off'] });

	await expect.element(picker()).toHaveAttribute('aria-expanded', 'false');
	await expect.element(picker()).toBeDisabled();
	await expect.element(picker()).toHaveTextContent('Off');
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

test('the composer offers the levels Pi reports for the model', async () => {
	const workspaces = withThinking(sessionFixtures.idle, 'medium', ['off', 'medium', 'high']);
	await render(SessionView, { workspaces, activeSessionId: 'session-idle', ...composerProps() });

	await userEvent.click(picker());

	expect(optionLabels()).toEqual(['Off', 'Medium', 'High']);
});

test('the composer disables the control when Pi reports only off', async () => {
	const workspaces = withThinking(sessionFixtures.idle, 'off', ['off']);
	await render(SessionView, { workspaces, activeSessionId: 'session-idle', ...composerProps() });

	await expect.element(picker()).toHaveTextContent('Off');
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
