import { expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { createTerminalFixture } from '../fixtures/terminals';
import TerminalSurface from '../lib/TerminalSurface.svelte';
import { THEMES, type ThemeName } from '../theme';

function screenText(label: string): string {
	return document.querySelector(`[aria-label="${CSS.escape(label)}"] .xterm-rows`)?.textContent ?? '';
}

function rgb(hex: string): string {
	const [red, green, blue] = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16));
	return `rgb(${red}, ${green}, ${blue})`;
}

test('opens, switches, and closes terminal tabs that carry typed Unicode input', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready: 界 🙂');

	await userEvent.keyboard('echo 界{Enter}');
	await expect.poll(() => fixture.input.get('fixture-1')).toBe('echo 界\r');
	await expect.poll(() => screenText('zsh terminal')).toContain('$ echo 界');

	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
	await expect.element(page.getByRole('group', { name: 'zsh 2 terminal' })).toBeVisible();
	await expect.element(page.getByRole('group', { name: 'zsh terminal', exact: true })).not.toBeInTheDocument();

	await userEvent.click(page.getByRole('tab', { name: 'zsh 2' }));
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(page.getByRole('tab', { name: 'zsh', exact: true })).toHaveAttribute('aria-selected', 'true');

	await userEvent.click(page.getByRole('button', { name: 'Close zsh', exact: true }));
	await expect.element(page.getByRole('tab', { name: 'zsh', exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
});

test('reports exit status and stops accepting input', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('$');

	await userEvent.keyboard('exit 3{Enter}');
	await expect.element(page.getByText('The process exited with code 3.')).toBeVisible();
	await expect.element(page.getByRole('tab', { name: 'zsh exit 3' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Paste' })).toBeDisabled();

	await userEvent.keyboard('more');
	expect(fixture.input.get('fixture-1')).toBe('exit 3\r');
});

test('enables copying once output is selected', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	await expect.element(page.getByRole('button', { name: 'Copy selection' })).toBeDisabled();

	const screen = page.getByRole('group', { name: 'zsh terminal' }).element().querySelector('.xterm-screen')!;
	await userEvent.tripleClick(screen, { position: { x: 24, y: 8 } });
	await expect.element(page.getByRole('button', { name: 'Copy selection' })).toBeEnabled();
});

test('fits the grid to the surface and reports each resize', async () => {
	await page.viewport(1200, 800);
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => fixture.sizes.get('fixture-1')?.cols ?? 0).toBeGreaterThan(80);
	const wide = fixture.sizes.get('fixture-1')!;

	await page.viewport(900, 500);
	await expect.poll(() => fixture.sizes.get('fixture-1')!.cols).toBeLessThan(wide.cols);
	expect(fixture.sizes.get('fixture-1')!.rows).toBeLessThan(wide.rows);
});

test('applies each theme to the terminal background and ANSI palette', async () => {
	const fixture = createTerminalFixture();
	const screen = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('~/pau');

	for (const name of Object.keys(THEMES) as ThemeName[]) {
		const { terminal } = THEMES[name];
		await screen.rerender({ theme: name });
		const view = page.getByRole('group', { name: 'zsh terminal' }).element() as HTMLElement;
		// The fixture prompt is bold blue, which xterm.js draws in bright blue.
		const prompt = view.querySelector(':scope .xterm-rows span.xterm-fg-12')!;
		await expect.poll(() => getComputedStyle(prompt).color).toBe(rgb(terminal.ansi[12]));
		expect(getComputedStyle(view).backgroundColor).toBe(rgb(terminal.background));
		expect(view.dataset.theme).toBe(name);
	}
});
