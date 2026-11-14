import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import ControlStatesDemo from '../stories/ControlStatesDemo.svelte';
import { themeCssProperties, UI_FONTS, type UiFontName } from '../theme';

/**
 * The cap center of the first visible text in `element`: its baseline, found
 * with an empty inline box placed on it, less half the font's cap height.
 * This measures where the letters are drawn, which the element box does not.
 */
function capCenter(element: Element): number {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.textContent!.trim() && !node.parentElement!.closest('.pau-visually-hidden')
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP
	});
	const text = walker.nextNode() as Text;
	const probe = document.createElement('span');
	probe.style.cssText = 'display: inline-block; width: 0; height: 0; vertical-align: baseline';
	text.after(probe);
	const baseline = probe.getBoundingClientRect().bottom;
	probe.remove();
	const style = getComputedStyle(text.parentElement!);
	const context = document.createElement('canvas').getContext('2d')!;
	context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	return baseline - context.measureText('H').actualBoundingBoxAscent / 2;
}

const middle = (element: Element) => {
	const box = element.getBoundingClientRect();
	return box.top + box.height / 2;
};

afterEach(() => document.documentElement.removeAttribute('style'));

test.each(Object.keys(UI_FONTS) as UiFontName[])(
	'centers button labels and choice inputs on the capitals in %s',
	async (font) => {
		const family = themeCssProperties('eldritch', font)['--pau-font-ui']!;
		document.documentElement.style.setProperty('--pau-font-ui', family);
		await render(ControlStatesDemo);
		await render(DiagnosticsView, { bundle: diagnosticFixtures.active });
		await document.fonts.load(`500 14px ${family}`);
		await document.fonts.ready;
		expect(document.fonts.check(`500 14px ${UI_FONTS[font].family}`)).toBe(true);

		const buttons = [...document.querySelectorAll('.pau-button')].filter((button) => button.textContent!.trim());
		const choices = [...document.querySelectorAll('.pau-choice')];
		expect(buttons.length).toBeGreaterThanOrEqual(8);
		expect(choices.length).toBeGreaterThanOrEqual(3);

		for (const button of buttons) {
			expect(Math.abs(capCenter(button) - middle(button)), button.textContent!).toBeLessThanOrEqual(0.5);
		}
		for (const choice of choices) {
			const input = choice.querySelector('input')!;
			expect(Math.abs(capCenter(choice) - middle(input)), choice.textContent!).toBeLessThanOrEqual(0.5);
		}
	}
);
