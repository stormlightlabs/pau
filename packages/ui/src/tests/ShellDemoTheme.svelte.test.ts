import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import CommandPaletteDemo from '../stories/CommandPaletteDemo.svelte';
import KeyboardShortcutsDemo from '../stories/KeyboardShortcutsDemo.svelte';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';
import TerminalSurfaceDemo from '../stories/TerminalSurfaceDemo.svelte';
import WorkspaceFilesDemo from '../stories/WorkspaceFilesDemo.svelte';

// Storybook hands the toolbar theme and font to each demo, and the demo passes them to its shell.
const demos = [
	['command palette', CommandPaletteDemo, {}],
	['keyboard shortcuts', KeyboardShortcutsDemo, {}],
	['session view', SessionViewDemo, { workspaces: [] }],
	['terminal', TerminalSurfaceDemo, {}],
	['files', WorkspaceFilesDemo, {}]
] as const;

test.each(demos)('the %s demo follows the theme and UI font it is given', async (_name, demo, props) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the demos take different props
	await render(demo as any, { ...props, theme: 'nord', uiFont: 'inter' });

	const shell = document.querySelector<HTMLElement>('.app-shell');
	expect(shell?.dataset.theme).toBe('nord');
	expect(shell?.dataset.uiFont).toBe('inter');
});
