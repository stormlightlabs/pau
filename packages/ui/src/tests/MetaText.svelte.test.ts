import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import { sessionFixtures } from '../fixtures/sessions';
import { toolCallFixtures } from '../fixtures/tool-calls';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import MetaText from '../lib/MetaText.svelte';
import SessionView from '../lib/SessionView.svelte';
import ToolCallViewDemo from '../stories/ToolCallViewDemo.svelte';

/** Separators are hidden elements, never a dot inside the surrounding text. */
function separators(container: Element): Element[] {
	return [...container.querySelectorAll(':scope .meta-separator')];
}

test('splits a label around hidden separator elements with equal spacing', async () => {
	const { container } = await render(MetaText, { text: 'Pi · Sonnet · error' });

	const found = separators(container);
	expect(found).toHaveLength(2);
	for (const separator of found) {
		expect(separator).toHaveAttribute('aria-hidden', 'true');
		const style = getComputedStyle(separator);
		expect(style.marginInlineStart).toBe(style.marginInlineEnd);
		expect(style.marginInlineStart).not.toBe('0px');
	}
	expect(container.textContent).not.toContain(' · ');
});

test('renders a label without a separator as plain text', async () => {
	const { container } = await render(MetaText, { text: 'Pi' });

	expect(separators(container)).toHaveLength(0);
});

test('renders the session header agent and model with a separator element', async () => {
	const { container } = await render(SessionView, {
		workspaces: sessionFixtures.idle,
		activeSessionId: 'session-idle'
	});

	const header = container.querySelector(':scope .session-view__header p');
	expect(header?.textContent).not.toContain(' · ');
	expect(header ? separators(header) : []).toHaveLength(1);
});

test('renders a tool call path and range with a separator element', async () => {
	const { container } = await render(ToolCallViewDemo, { tools: [toolCallFixtures.read] });

	const summary = container.querySelector(':scope .tool-call__name + code');
	expect(summary?.textContent).not.toContain(' · ');
	expect(summary ? separators(summary) : []).toHaveLength(1);
	await expect.element(page.getByText('lines 10–14')).toBeVisible();
});

test('renders Diagnostics adapter capabilities with separator elements', async () => {
	const { container } = await render(DiagnosticsView, { bundle: diagnosticFixtures.active });

	const capabilities = container.querySelector(':scope .meta-separator')?.parentElement;
	expect(capabilities?.textContent).not.toContain(' · ');
	expect(capabilities ? separators(capabilities) : []).toHaveLength(3);
});

test('leaves equal space on both sides of the dot in a shell command outcome', async () => {
	const { container } = await render(ToolCallViewDemo, {
		tools: [{ ...toolCallFixtures.bashRunning, shell: { excludedFromContext: true } }],
		initiallyOpen: false
	});

	const outcome = container.querySelector(':scope .tool-call summary small');
	const separator = outcome ? separators(outcome)[0] : undefined;
	const space = separator?.previousElementSibling;
	if (!outcome || !separator || !space) throw new Error('The outcome has no separated parts.');
	expect(outcome.textContent).not.toContain(' · ');

	// The hidden space clips a glyph, so the text before ends where that space begins.
	const before = document.createRange();
	before.setStart(outcome, 0);
	before.setEndBefore(space);
	const after = document.createRange();
	after.setStartAfter(separator);
	after.setEnd(outcome, outcome.childNodes.length);
	const dot = separator.getBoundingClientRect();
	const leading = dot.left - before.getBoundingClientRect().right;
	const trailing = after.getBoundingClientRect().left - dot.right;
	expect(leading).toBeGreaterThan(2);
	expect(Math.abs(leading - trailing)).toBeLessThan(1);
});
