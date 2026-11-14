import { cdp, page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ControlStatesDemo from '../stories/ControlStatesDemo.svelte';
import { applyTheme } from './apply-theme';

const controls = [
	'primary',
	'secondary',
	'quiet',
	'danger',
	'utility',
	'row',
	'tab',
	'field',
	'option',
	'choice',
	'disclosure',
	'link'
] as const;
type Control = (typeof controls)[number];

/** Links and disclosures cannot be disabled, so they have one instance. */
const withoutDisabled = new Set<Control>(['disclosure', 'link']);

const properties = [
	'color',
	'background-color',
	'background-image',
	'border-top-color',
	'outline-style',
	'outline-color',
	'opacity',
	'accent-color'
];

function colors(target: Element): string {
	const style = getComputedStyle(target);
	return properties.map((property) => style.getPropertyValue(property)).join(' ');
}

/** The computed colors a control shows. A choice row also reports its native input. */
function look(element: HTMLElement): string {
	const input = element.querySelector('input');
	return input ? `${colors(element)} | ${colors(input)}` : colors(element);
}

function instances(control: Control) {
	const [enabled, disabled] = document.querySelectorAll<HTMLElement>(`[data-control="${CSS.escape(control)}"]`);
	return { enabled: enabled!, disabled };
}

/** Moves the pointer onto a section heading and clears focus, so no control is hovered or focused. */
async function rest() {
	await userEvent.hover(page.getByRole('heading', { name: 'Buttons' }));
	(document.activeElement as HTMLElement | null)?.blur();
}

/**
 * Holds the primary mouse button over the element so `:active` matches, reads
 * the element, then releases. CDP coordinates are in the top page, where the
 * test frame is offset and scaled to fit, so the element's center is mapped
 * through the frame's box.
 */
async function whilePressed<T>(element: HTMLElement, read: () => T): Promise<T> {
	await userEvent.hover(element);
	const frame = window.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth };
	const scale = frame.width / window.innerWidth;
	const box = element.getBoundingClientRect();
	const point = {
		x: frame.left + (box.left + box.width / 2) * scale,
		y: frame.top + (box.top + box.height / 2) * scale,
		button: 'left' as const
	};
	const session = cdp();
	await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, ...point });
	const result = read();
	await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, ...point });
	return result;
}

/** Focuses with the keyboard modality so `:focus-visible` matches. */
async function lookWhileFocused(element: HTMLElement): Promise<string> {
	await userEvent.keyboard('{Tab}');
	const target = element.querySelector('input') ?? element;
	target.focus();
	const focused = look(element);
	target.blur();
	return focused;
}

/**
 * Touch emulation makes the page report `(hover: none)`, as a touch screen
 * does. On headless Chromium for Linux, turning it off, even when it is
 * already off, leaves the page with no hover until it reloads. So `afterEach`
 * turns it off only after a test that turned it on, and those tests run last.
 */
const touch = { on: false };
async function emulateTouch(enabled: boolean) {
	touch.on = enabled;
	await cdp().send('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints: 1 });
	// Touch emulation alone updates matchMedia but can leave styles computed for
	// a hover-capable pointer, so the media features are emulated directly too.
	await cdp().send('Emulation.setEmulatedMedia', {
		features: enabled
			? [
					{ name: 'hover', value: 'none' },
					{ name: 'pointer', value: 'coarse' }
				]
			: []
	});
}

/** Transitions would leave a read mid-fade, so the test reads end states. */
const instant = document.createElement('style');
instant.textContent = '* { transition: none !important; }';

beforeEach(async () => {
	applyTheme();
	document.head.append(instant);
	await render(ControlStatesDemo);
});

afterEach(async () => {
	instant.remove();
	if (touch.on) await emulateTouch(false);
});

describe.each(controls)('%s', (control) => {
	test('shows distinct colors at rest, on hover, pressed, and focused', async () => {
		expect(matchMedia('(hover: hover)').matches).toBe(true);
		const { enabled } = instances(control);
		await rest();
		const resting = look(enabled);
		await userEvent.hover(enabled);
		const hovered = look(enabled);
		const pressed = await whilePressed(enabled, () => look(enabled));
		await rest();
		const focused = await lookWhileFocused(enabled);

		expect(new Set([resting, hovered, pressed, focused]).size).toBe(4);
	});

	test.skipIf(withoutDisabled.has(control))('looks disabled and ignores hover and press', async () => {
		const { enabled, disabled } = instances(control);
		await rest();
		const disabledRest = look(disabled!);
		expect(disabledRest).not.toBe(look(enabled));

		await userEvent.hover(disabled!);
		expect(look(disabled!)).toBe(disabledRest);
		expect(await whilePressed(disabled!, () => look(disabled!))).toBe(disabledRest);
	});
});

test('never moves a pressed control', async () => {
	for (const control of controls) {
		const { enabled } = instances(control);
		await userEvent.hover(enabled);
		const before = enabled.getBoundingClientRect().toJSON();
		const during = await whilePressed(enabled, () => ({
			box: enabled.getBoundingClientRect().toJSON(),
			transform: getComputedStyle(enabled).transform
		}));
		expect(during, control).toEqual({ box: before, transform: 'none' });
	}
});

/** These run last, after every hover test, as `emulateTouch` explains. */
describe.each(controls)('%s on a touch screen', (control) => {
	test('drops the hover look without a hover-capable pointer', async () => {
		await emulateTouch(true);
		expect(matchMedia('(hover: hover)').matches).toBe(false);
		const { enabled } = instances(control);
		await rest();
		const resting = look(enabled);
		await userEvent.hover(enabled);
		expect(enabled.matches(':hover')).toBe(true);
		expect(look(enabled)).toBe(resting);
	});
});
