import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';

import { modelFixtures } from '../fixtures/models';
import { sessionFixtures } from '../fixtures/sessions';
import { usageFixtures } from '../fixtures/usage';
import ContextMeter from '../lib/ContextMeter.svelte';
import ModelPicker from '../lib/ModelPicker.svelte';
import Select from '../lib/Select.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';
import { dismissals } from './dismiss-actions';

type PickerProps = ComponentProps<typeof ModelPicker>;

const targets: HTMLElement[] = [];
afterEach(() => {
	for (const target of targets.splice(0)) target.remove();
});

/** Renders the picker at the bottom of the window, as the composer footer does, so its list opens upward. */
function renderPicker(props: PickerProps) {
	const target = document.createElement('div');
	target.style.cssText = 'position: fixed; left: 1rem; bottom: 1rem;';
	document.body.append(target);
	targets.push(target);
	return render(ModelPicker, { target, props });
}

function withModelSelection(workspaces: SessionWorkspace[]): SessionWorkspace[] {
	return workspaces.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({
			...session,
			capabilities: { ...session.capabilities, modelSelection: true }
		}))
	}));
}

test('selects a model and reloads the list', async () => {
	const load = vi.fn(async () => modelFixtures.populated);
	const onSelect = vi.fn();
	await renderPicker({ load, onSelect });

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	expect(onSelect).toHaveBeenCalledWith(modelFixtures.populated[2]);
	await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
	await expect.element(page.getByRole('group', { name: 'Models' })).not.toBeInTheDocument();
});

test('uses the Select surface: a chevron on the trigger and a check on the current model', async () => {
	await renderPicker({ load: async () => modelFixtures.populated, onSelect: vi.fn() });

	const trigger = page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' });
	await expect.element(trigger).toBeVisible();
	expect(trigger.element().querySelector('.model-picker__chevron')).toBeVisible();

	await userEvent.click(trigger);
	const current = page.getByRole('group', { name: 'Models' }).getByRole('button', { name: /Claude Sonnet 4.5/ });
	await expect.element(current).toHaveAttribute('aria-current', 'true');
	expect(current.element().querySelector('.model-picker__check')).toBeVisible();
	const other = page.getByRole('button', { name: /Claude Haiku 4.5/ });
	expect(other.element().querySelector('.model-picker__check')).not.toBeVisible();

	// The list opens upward from the trigger's left edge, like Select's list.
	const list = page.getByRole('group', { name: 'Models' }).element().getBoundingClientRect();
	const anchor = trigger.element().getBoundingClientRect();
	expect(list.left).toBe(anchor.left);
	expect(list.bottom).toBeLessThanOrEqual(anchor.top);
});

test.each(dismissals)('%s closes the list and returns focus to the trigger', async (_, dismiss) => {
	const onSelect = vi.fn();
	await renderPicker({ load: async () => modelFixtures.full, onSelect });
	const trigger = page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' });
	await userEvent.click(trigger);
	await expect.element(page.getByRole('group', { name: 'Models' })).toBeVisible();

	await dismiss();

	await expect.element(page.getByRole('group', { name: 'Models' })).not.toBeInTheDocument();
	await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect.poll(() => document.activeElement).toBe(trigger.element());
	expect(onSelect).not.toHaveBeenCalled();
});

test('one press on another overlay trigger closes the open overlay and opens that one', async () => {
	await renderPicker({ load: async () => modelFixtures.full, onSelect: vi.fn() });
	await render(ContextMeter, { usage: usageFixtures.normal });
	await render(Select, {
		label: 'Thinking level',
		options: [
			{ value: 'low', label: 'Low' },
			{ value: 'high', label: 'High' }
		],
		value: 'low'
	});
	const models = page.getByRole('group', { name: 'Models' });
	const usage = page.getByRole('group', { name: 'Session usage' });
	const level = page.getByRole('combobox', { name: 'Thinking level' });

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await expect.element(models).toBeVisible();

	await userEvent.click(page.getByRole('button', { name: /Context/ }));
	await expect.element(models).not.toBeInTheDocument();
	await expect.element(usage).toBeVisible();

	await userEvent.click(level);
	await expect.element(usage).not.toBeInTheDocument();
	await expect.element(level).toHaveAttribute('aria-expanded', 'true');

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await expect.element(level).toHaveAttribute('aria-expanded', 'false');
	await expect.element(models).toBeVisible();
});

test('keeps the list open and explains a rejected selection', async () => {
	const onSelect = vi.fn().mockRejectedValue(new Error('Pi rejected the request: Model not found'));
	await renderPicker({ load: async () => modelFixtures.populated, onSelect });

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: Model not found');
	await expect.element(page.getByRole('button', { name: /gpt-5/ })).toBeEnabled();
});

test.each([
	[600, 'top'],
	[600, 'bottom'],
	[1440, 'top'],
	[1440, 'bottom']
])('keeps a rejection message inside a %ipx window with the trigger at the %s', async (width, edge) => {
	await page.viewport(width, 500);
	const onSelect = vi.fn().mockRejectedValue(new Error('Pi rejected the request: Model not found'));
	const { container } = await renderPicker({ load: async () => modelFixtures.populated, onSelect });
	container.style.cssText = `position: fixed; left: 1rem; ${edge}: 1rem;`;

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	const alert = page.getByRole('alert');
	await expect.element(alert).toHaveTextContent('Pi rejected the request: Model not found');
	const box = alert.element().getBoundingClientRect();
	expect(box.left).toBeGreaterThanOrEqual(0);
	expect(box.right).toBeLessThanOrEqual(innerWidth);
	expect(box.top).toBeGreaterThanOrEqual(0);
	expect(box.bottom).toBeLessThanOrEqual(innerHeight);
});

test('explains an empty model list', async () => {
	await renderPicker({ load: async () => modelFixtures.empty, onSelect: vi.fn() });

	await userEvent.click(page.getByRole('button', { name: 'Model: Model' }));

	await expect.element(page.getByText(/No models are available/)).toBeVisible();
});

test('shows a load failure with a retry', async () => {
	const load = vi
		.fn()
		.mockRejectedValueOnce(new Error('Pi did not answer.'))
		.mockResolvedValue(modelFixtures.populated);
	await renderPicker({ load, onSelect: vi.fn() });

	await userEvent.click(page.getByRole('button', { name: 'Model: Model' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi did not answer.');
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));

	await expect.element(page.getByRole('button', { name: /Claude Haiku 4.5/ })).toBeVisible();
});

test('the session header offers the picker only while the session is idle', async () => {
	const props = { onLoadModels: async () => modelFixtures.populated, onSelectModel: vi.fn() };

	const view = await render(SessionView, {
		workspaces: withModelSelection(sessionFixtures.idle),
		activeSessionId: 'session-idle',
		...props
	});
	await expect.element(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' })).toBeEnabled();

	await view.rerender({ workspaces: withModelSelection(sessionFixtures.running), activeSessionId: 'session-running' });
	const trigger = page.getByRole('button', { name: /Model:/ });
	await expect.element(trigger).toBeDisabled();
	await expect.element(trigger).toHaveAccessibleDescription(/Wait for this run/);
});
