import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { transcriptSearchFixtures, transcriptSearchNow } from '../fixtures/transcript-search';
import ExtensionUi from '../lib/ExtensionUi.svelte';
import SessionView from '../lib/SessionView.svelte';
import TranscriptSearch from '../lib/TranscriptSearch.svelte';
import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';
import '../styles/tokens.css';
import { themeCssProperties } from '../theme';

const theme = Object.entries(themeCssProperties('eldritch', 'inter'));
for (const [name, value] of theme) {
	document.documentElement.style.setProperty(name, value);
}

/** Reads a computed pixel length such as `2px`. */
const length = (value: string) => Number(value.replace('px', ''));
const px = (name: string) => length(getComputedStyle(document.documentElement).getPropertyValue(name));
const token = (name: string) => {
	const probe = document.createElement('span');
	probe.style.color = `var(${name})`;
	document.body.append(probe);
	const value = getComputedStyle(probe).color;
	probe.remove();
	return value;
};

/** Focuses with the keyboard modality so `:focus-visible` matches. */
async function focusByKeyboard(element: HTMLElement) {
	await userEvent.keyboard('{Tab}');
	element.focus();
}

/** True when the ring's outer edge extends past an ancestor that clips overflow. */
function ringIsClipped(element: HTMLElement) {
	const style = getComputedStyle(element);
	const reach = length(style.outlineOffset) + length(style.outlineWidth);
	if (reach <= 0) return false;
	const box = element.getBoundingClientRect();
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		if (getComputedStyle(parent).overflow === 'visible') continue;
		const bounds = parent.getBoundingClientRect();
		if (
			box.left - reach < bounds.left ||
			box.top - reach < bounds.top ||
			box.right + reach > bounds.right ||
			box.bottom + reach > bounds.bottom
		)
			return true;
	}
	return false;
}

async function expectTokenRing(element: HTMLElement) {
	await focusByKeyboard(element);
	const style = getComputedStyle(element);
	expect(style.outlineStyle).toBe('solid');
	expect(length(style.outlineWidth)).toBe(px('--pau-focus-width'));
	expect(style.outlineColor).toBe(token('--pau-focus'));
	expect([px('--pau-focus-offset'), px('--pau-focus-offset-inset')]).toContain(length(style.outlineOffset));
	expect(ringIsClipped(element)).toBe(false);
}

const base = sessionFixtures.running[0]!;
const session = base.sessions[0]!;
const entries = [
	{ id: 'u1', kind: 'message' as const, role: 'user' as const, body: 'Run the tests' },
	{ id: 'a1', kind: 'message' as const, role: 'assistant' as const, body: 'Done.\n\n```ts\nconst a = 1;\n```' }
];

test('the token defines one ring width and offsets', () => {
	expect(px('--pau-focus-width')).toBe(2);
	expect(px('--pau-focus-offset')).toBe(2);
	expect(px('--pau-focus-offset-inset')).toBe(-2);
});

test('controls in a scrolled transcript and the composer use the token ring', async () => {
	await render(SessionView, {
		workspaces: [{ ...base, sessions: [{ ...session, transcript: entries }] }],
		activeSessionId: session.id
	});

	const transcript = document.querySelector<HTMLElement>('.session-view__transcript')!;
	transcript.scrollTop = transcript.scrollHeight;
	await expectTokenRing(transcript.querySelector<HTMLElement>('button')!);

	const composer = document.querySelector<HTMLElement>('.session-composer')!;
	composer.querySelector<HTMLElement>('textarea')!.focus();
	const style = getComputedStyle(composer);
	expect(style.outlineStyle).toBe('solid');
	expect(length(style.outlineWidth)).toBe(px('--pau-focus-width'));
	expect(style.outlineColor).toBe(token('--pau-focus'));
	expect(ringIsClipped(composer)).toBe(false);
});

test('overlay controls use the token ring', async () => {
	await render(ExtensionUi, {
		state: {
			dialog: { id: 'confirm', kind: 'confirm', title: 'Continue?', message: 'This updates the index.' },
			notifications: [],
			statuses: [],
			widgets: []
		},
		onRespond: vi.fn()
	});
	await expectTokenRing(page.getByRole('button', { name: 'Yes' }).element() as HTMLElement);
});

test('popover controls use the token ring', async () => {
	await render(TranscriptSearch, {
		agent: 'Pi',
		delay: 0,
		now: transcriptSearchNow,
		search: vi.fn(async () => transcriptSearchFixtures.results),
		onSelect: vi.fn(() => true),
		onClose: vi.fn()
	});
	await expectTokenRing(page.getByRole('searchbox', { name: 'Search transcript' }).element() as HTMLElement);
});

test('shell controls and the pane resizer use the token ring', async () => {
	await page.viewport(1440, 900);
	await render(ApplicationShellDemo);

	const visible = [...document.querySelectorAll<HTMLElement>('.app-shell button')].find(
		(button) => button.offsetParent
	);
	await expectTokenRing(visible!);

	const separator = page.getByRole('separator', { name: 'Resize workspaces' }).element() as HTMLElement;
	await focusByKeyboard(separator);
	const line = getComputedStyle(separator, '::after');
	expect(line.backgroundColor).toBe(token('--pau-focus'));
	expect(length(line.width)).toBe(px('--pau-focus-width'));
});
