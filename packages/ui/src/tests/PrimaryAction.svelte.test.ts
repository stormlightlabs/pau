import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Component } from 'svelte';

import * as fileEditorStories from '../stories/FileEditor.stories';
import * as mcpStories from '../stories/McpConfigurationView.stories';
import * as sandboxStories from '../stories/SandboxSettingsView.stories';
import * as sessionPickerStories from '../stories/SessionPicker.stories';
import * as sessionViewStories from '../stories/SessionView.stories';
import * as terminalStories from '../stories/TerminalSurface.stories';
import '../styles/tokens.css';
import { applyTheme } from './apply-theme';

applyTheme();

// Wide enough for the rails, so each surface shows everything it holds.
beforeEach(() => page.viewport(1440, 900));

type StoryModule = { default: { component: unknown; args?: Record<string, unknown> } };

/** Resolves a theme color token to the computed `rgb()` string the browser reports. */
function tokenColor(name: string) {
	const probe = document.createElement('span');
	probe.style.color = `var(${name})`;
	document.body.append(probe);
	const value = getComputedStyle(probe).color;
	probe.remove();
	return value;
}

/** Renders a story the way Storybook does: the meta component with meta and story args merged. */
async function renderStory(module: StoryModule, story: { args?: Record<string, unknown> }) {
	const props = { ...module.default.args, ...story.args };
	return render(module.default.component as Component<Record<string, unknown>>, props);
}

function accentButtons(container: HTMLElement) {
	const accent = tokenColor('--pau-accent');
	return [...container.querySelectorAll('button')].filter(
		(button) => getComputedStyle(button).backgroundColor === accent
	);
}

type Setup = { args?: Record<string, unknown>; act?: () => Promise<void> };

/** The desktop app picks folders with the system dialog, so first-run stories get a folder picker. */
const desktopPicker: Setup = { args: { pickedFolder: null } };

const failStart: Setup = { act: () => userEvent.click(page.getByRole('button', { name: 'New session in Pau' })) };

/** Send prompt stays disabled, and so drops the accent, until there is a draft. */
const draftPrompt: Setup = {
	act: () => userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Keep the public API unchanged.')
};

const openFolder: Setup = {
	act: async () => {
		await userEvent.type(page.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/projects/pau');
		await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));
	}
};

test.each([
	['first run', sessionViewStories, sessionViewStories.FirstRun, desktopPicker, 'Open workspace…'],
	[
		'first run before Pi is ready',
		sessionViewStories,
		sessionViewStories.FirstRunPiNotReady,
		desktopPicker,
		'Open workspace…'
	],
	['failed start', sessionViewStories, sessionViewStories.FailedStart, failStart, 'Try again'],
	['empty workspace', sessionViewStories, sessionViewStories.OpenWorkspace, openFolder, 'Start session'],
	['running session', sessionViewStories, sessionViewStories.Running, draftPrompt, /^(Send|Queue) prompt/],
	['stopped session', sessionViewStories, sessionViewStories.Stopped, {}, 'Start again'],
	['saved sessions', sessionPickerStories, sessionPickerStories.Populated, {}, /^(Open|Resume) /],
	['no saved sessions', sessionPickerStories, sessionPickerStories.Empty, {}, 'New session'],
	['no terminals', terminalStories, terminalStories.Empty, {}, 'Open a terminal'],
	['MCP off', mcpStories, mcpStories.ConfiguredOff, {}, 'Enable for this workspace'],
	['sandbox', sandboxStories, sandboxStories.UnsandboxedDefault, {}, 'Save workspace default']
] as const)('the %s surface has one accent primary', async (_name, module, story, setup: Setup, primary) => {
	const args = { ...(story as { args?: Record<string, unknown> }).args, ...setup.args };
	const { container } = await renderStory(module as StoryModule, { args });
	await setup.act?.();
	const surface = container.querySelector('main') ?? container;
	const button = page
		.elementLocator(surface)
		.getByRole('button', { name: primary, exact: typeof primary === 'string' })
		.first();
	await expect.element(button).toBeEnabled();
	await expect.poll(() => accentButtons(container).length).toBe(1);
	expect(accentButtons(container)[0]).toBe(button.element());
});

test('a disabled primary drops the accent for muted text on the raised surface', async () => {
	const { container } = await renderStory(fileEditorStories, fileEditorStories.Editable);
	const save = page.getByRole('button', { name: 'Save' });
	await expect.element(save).toBeDisabled();
	const disabled = getComputedStyle(save.element());
	expect(disabled.color).toBe(tokenColor('--pau-text-muted'));
	expect(disabled.backgroundColor).toBe(tokenColor('--pau-surface-raised'));
	expect(disabled.opacity).toBe('1');
	expect(accentButtons(container)).toHaveLength(0);

	// CodeMirror loads its language support asynchronously, so wait for the editor first.
	const editor = page.getByRole('textbox');
	await expect.element(editor).toBeInTheDocument();
	await userEvent.click(editor);
	await userEvent.keyboard('{End} // changed');
	await expect.element(save).toBeEnabled();
	// Buttons fade between state colors, so wait for the enabled color to land.
	await expect.poll(() => getComputedStyle(save.element()).color).toBe(tokenColor('--pau-text-on-accent'));
	expect(accentButtons(container)).toHaveLength(1);
	expect(accentButtons(container)[0]).toBe(save.element());
});
