import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';

import { modelFixtures } from '../fixtures/models';
import { sessionFixtures } from '../fixtures/sessions';
import ModelPicker from '../lib/ModelPicker.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

type PickerProps = ComponentProps<typeof ModelPicker>;

const targets: HTMLElement[] = [];
afterEach(() => {
	for (const target of targets.splice(0)) target.remove();
});

/** Renders the picker low in the page, as the composer footer does, so its list has room to open upward. */
function renderPicker(props: PickerProps) {
	const target = document.createElement('div');
	target.style.marginTop = '24rem';
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

test('keeps the list open and explains a rejected selection', async () => {
	const onSelect = vi.fn().mockRejectedValue(new Error('Pi rejected the request: Model not found'));
	await renderPicker({ load: async () => modelFixtures.populated, onSelect });

	await userEvent.click(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: Model not found');
	await expect.element(page.getByRole('button', { name: /gpt-5/ })).toBeEnabled();
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

test('stays closed and explains why when the agent cannot switch models', async () => {
	const load = vi.fn(async () => modelFixtures.populated);
	await renderPicker({ load, onSelect: vi.fn(), supported: false, fallbackLabel: 'Sonnet' });

	const trigger = page.getByRole('button', { name: 'Model: Sonnet' });
	await expect.element(trigger).toBeDisabled();
	await expect.element(trigger).toHaveAccessibleDescription(/does not support switching models/);
	expect(load).not.toHaveBeenCalled();
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
