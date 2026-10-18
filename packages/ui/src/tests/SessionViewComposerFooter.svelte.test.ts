import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { modelFixtures } from '../fixtures/models';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';

/** The model-controls fixture, optionally moved to another status. */
function workspaces(status: SessionViewModel['status'] = 'running'): SessionWorkspace[] {
	const [workspace] = sessionFixtures.modelControls;
	return [{ ...workspace!, sessions: workspace!.sessions.map((session) => ({ ...session, status })) }];
}

async function setup(status: SessionViewModel['status'] = 'running') {
	const handlers = {
		onLoadModels: vi.fn().mockResolvedValue(modelFixtures.populated),
		onSelectModel: vi.fn(),
		onSelectThinkingLevel: vi.fn(),
		onInterrupt: vi.fn(),
		onCompact: vi.fn()
	};
	await render(SessionView, { workspaces: workspaces(status), activeSessionId: 'session-running', ...handlers });
	await expect.element(page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' })).toBeVisible();
	await document.fonts.ready;
	return handlers;
}

const footer = () => document.querySelector<HTMLElement>('.session-composer__footer')!;
const header = () => document.querySelector<HTMLElement>('.session-view__header')!;

test('renders the pickers and the context meter in the composer footer', async () => {
	await page.viewport(1440, 900);
	await setup();

	for (const control of [
		page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' }),
		page.getByRole('combobox', { name: 'Thinking level' }),
		page.getByRole('meter', { name: 'Context window used' })
	]) {
		expect(footer().contains(control.element())).toBe(true);
		expect(header().contains(control.element())).toBe(false);
	}
	// The header keeps only the title, status, and session actions.
	expect(header().querySelectorAll('button')).toHaveLength(2);
	expect(header().textContent).toContain('Compact');
	expect(header().textContent).toContain('Stop');
});

test('keeps keyboard control of the footer pickers and meter', async () => {
	await page.viewport(1440, 900);
	const { onSelectModel, onSelectThinkingLevel } = await setup('idle');

	const model = page.getByRole('button', { name: 'Model: Claude Sonnet 4.5' });
	(model.element() as HTMLElement).focus();
	await userEvent.keyboard('{Enter}');
	const models = page.getByRole('group', { name: 'Models' });
	await expect.element(models).toBeVisible();
	// The list opens upward, above the footer at the bottom of the window.
	expect(models.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
		model.element().getBoundingClientRect().top
	);
	await userEvent.keyboard('{Escape}');
	await expect.element(models).not.toBeInTheDocument();
	await expect.element(model).toHaveFocus();
	await userEvent.keyboard('{Enter}');
	await page.getByRole('button', { name: /Claude Haiku 4.5/ }).click();
	expect(onSelectModel).toHaveBeenCalledWith('session-running', expect.objectContaining({ id: 'claude-haiku-4-5' }));

	const thinking = page.getByRole('combobox', { name: 'Thinking level' });
	(thinking.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(thinking).toHaveAttribute('aria-expanded', 'true');
	await userEvent.keyboard('{ArrowDown}{Enter}');
	expect(onSelectThinkingLevel).toHaveBeenCalledWith('session-running', 'xhigh');

	const meter = page.getByRole('button', { name: /Context 84k/ });
	(meter.element() as HTMLElement).focus();
	await userEvent.keyboard('{Enter}');
	const usage = page.getByRole('group', { name: 'Session usage' });
	await expect.element(usage).toBeVisible();
	expect(usage.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
		meter.element().getBoundingClientRect().top
	);
	await userEvent.keyboard('{Escape}');
	await expect.element(usage).not.toBeInTheDocument();
});

test.each([360, 900, 1440])('wraps the footer without hiding Send prompt at %ipx', async (width) => {
	await page.viewport(width, 900);
	await setup();

	const composer = document.querySelector<HTMLElement>('.session-composer')!.getBoundingClientRect();
	const send = page.getByRole('button', { name: /Send prompt/ });
	await expect.element(send).toBeVisible();
	const box = send.element().getBoundingClientRect();
	expect(box.left).toBeGreaterThanOrEqual(composer.left);
	expect(box.right).toBeLessThanOrEqual(composer.right);
	expect(box.bottom).toBeLessThanOrEqual(composer.bottom);
	expect(footer().scrollWidth).toBeLessThanOrEqual(footer().clientWidth);
});
