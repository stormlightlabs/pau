import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import { mcpConfigurationFixtures } from '../fixtures/mcp';
import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import { sandboxFixtures } from '../fixtures/sandbox';
import { sessionFixtures } from '../fixtures/sessions';
import { toolCallFixtures } from '../fixtures/tool-calls';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import McpConfigurationView from '../lib/McpConfigurationView.svelte';
import ProcessesView from '../lib/ProcessesView.svelte';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';
import SessionResourceSummary from '../lib/SessionResourceSummary.svelte';
import SessionView from '../lib/SessionView.svelte';
import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';
import KeyboardShortcutsDemo from '../stories/KeyboardShortcutsDemo.svelte';
import ToolCallViewDemo from '../stories/ToolCallViewDemo.svelte';
import '../styles/tokens.css';
import { UI_FONTS } from '../theme';

/** Reads a computed pixel length such as `11px`. `normal` reads as 0. */
const pixels = (value: string) => Number(value.replace('px', '')) || 0;

/** The first family in a computed `font-family` list, without quotes. */
const primaryFamily = (element: Element) =>
	getComputedStyle(element).fontFamily.split(',', 1)[0]!.trim().replace(/['"]/g, '');

/**
 * Lists visible text that renders below the 12px floor. Only uppercase,
 * letter-spaced section labels may use the 11px label step.
 */
function textBelowFloor(root: ParentNode = document.body): string[] {
	const offenders: string[] = [];
	for (const element of root.querySelectorAll<HTMLElement>('*')) {
		const ownText = [...element.childNodes].some(
			(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
		);
		if (!ownText || element.getClientRects().length === 0) continue;
		const style = getComputedStyle(element);
		const size = pixels(style.fontSize);
		if (size >= 12) continue;
		const label = size === 11 && style.textTransform === 'uppercase' && pixels(style.letterSpacing) > 0;
		if (!label) offenders.push(`${element.className || element.tagName}: ${size}px "${element.textContent?.trim()}"`);
	}
	return offenders;
}

const base = sessionFixtures.running[0]!;
const session = base.sessions[0]!;
const transcript = [
	{ id: 'u1', kind: 'message' as const, role: 'user' as const, body: 'Run the tests' },
	{
		id: 'a1',
		kind: 'message' as const,
		role: 'assistant' as const,
		body: '## Result\n\nAll **green**. See `src/lib`.\n\n```ts\nconst a = 1;\n```'
	}
];

test('the default UI font is Overpass', async () => {
	await render(ApplicationShellDemo);

	const shell = document.querySelector<HTMLElement>('.app-shell')!;
	expect(shell.dataset.uiFont).toBe('overpass');
	expect(primaryFamily(shell)).toBe('Overpass Variable');
	await document.fonts.load(`14px ${UI_FONTS.overpass.family}`);
	expect(document.fonts.check(`14px ${UI_FONTS.overpass.family}`)).toBe(true);
});

test('IBM Plex Sans remains selectable', async () => {
	await render(ApplicationShellDemo, { uiFont: 'ibm-plex-sans' });

	expect(primaryFamily(document.querySelector('.app-shell')!)).toBe('IBM Plex Sans Variable');
});

test('code uses Overpass Mono', async () => {
	await render(SessionView, {
		workspaces: [{ ...base, sessions: [{ ...session, transcript }] }],
		activeSessionId: session.id
	});

	const code = document.querySelector('.session-view__transcript pre code')!;
	const inline = document.querySelector('.session-view__transcript p code')!;
	expect(primaryFamily(code)).toBe('Overpass Mono Variable');
	expect(primaryFamily(inline)).toBe('Overpass Mono Variable');
	await document.fonts.load("13px 'Overpass Mono Variable'");
	expect(document.fonts.check("13px 'Overpass Mono Variable'")).toBe(true);
});

test('the main task heading is 18px semibold and body text is 14px', async () => {
	await render(SessionView, {
		workspaces: [{ ...base, sessions: [{ ...session, transcript }] }],
		activeSessionId: session.id
	});

	const heading = getComputedStyle(document.querySelector('#session-title')!);
	expect(heading.fontSize).toBe('18px');
	expect(heading.fontWeight).toBe('600');
	expect(getComputedStyle(document.querySelector('.session-view__transcript p')!).fontSize).toBe('14px');
	expect(getComputedStyle(document.querySelector('.session-composer textarea')!).fontSize).toBe('14px');
	expect(textBelowFloor()).toEqual([]);
});

test('no shell, inspector, or tool text renders below 12px', async () => {
	await page.viewport(1440, 900);
	await render(ApplicationShellDemo);
	await render(SessionResourceSummary, {
		snapshot: resourceMonitoringFixtures.active[2]!,
		actions: { interrupt: true, stop: true }
	});
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.bashComplete, toolCallFixtures.editFailed] });

	expect(textBelowFloor()).toEqual([]);
});

test('no Diagnostics, Processes, sandbox, or MCP text renders below 12px', async () => {
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active });
	await render(ProcessesView, { workspaceName: 'Pau', processes: resourceMonitoringFixtures.active });
	await render(SandboxSettingsView, { selection: sandboxFixtures.unsandboxed });
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piConfiguredOff });

	expect(textBelowFloor()).toEqual([]);
});

test('no overlay text renders below 12px', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });

	document.body.dispatchEvent(
		new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '/', code: 'Slash', metaKey: true })
	);
	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	expect(textBelowFloor()).toEqual([]);
});
