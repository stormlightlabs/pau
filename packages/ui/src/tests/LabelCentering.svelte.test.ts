import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import { sandboxFixtures } from '../fixtures/sandbox';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';
import ControlStatesDemo from '../stories/ControlStatesDemo.svelte';
import { themeCssProperties, UI_FONTS, type UiFontName } from '../theme';

function firstText(element: Element): Text {
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.textContent!.trim() && !node.parentElement!.closest('.pau-visually-hidden')
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP
	});
	return walker.nextNode() as Text;
}

/**
 * The cap center of the first visible text in `element`: its baseline, found
 * with an empty inline box placed on it, less half the font's cap height.
 * This measures where the letters are drawn, which the element box does not.
 * The text and the probe share a wrapper for the measurement, because in a
 * flex container a bare probe would become its own centered item.
 */
function capCenter(element: Element): number {
	const text = firstText(element);
	const wrapper = document.createElement('span');
	const probe = document.createElement('span');
	probe.style.cssText = 'display: inline-block; width: 0; height: 0; vertical-align: baseline';
	text.replaceWith(wrapper);
	wrapper.append(text, probe);
	const baseline = probe.getBoundingClientRect().bottom;
	wrapper.replaceWith(text);
	const style = getComputedStyle(text.parentElement!);
	const context = document.createElement('canvas').getContext('2d')!;
	context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	return baseline - context.measureText('H').actualBoundingBoxAscent / 2;
}

const middle = (element: Element) => {
	const box = element.getBoundingClientRect();
	return box.top + box.height / 2;
};

/** The left edge of the first drawn text in `element`, from a text range. */
function textLeft(element: Element): number {
	const range = document.createRange();
	range.selectNodeContents(firstText(element));
	return range.getBoundingClientRect().left;
}

type RemovedRule = { sheet: CSSStyleSheet; index: number; text: string };
const removed: RemovedRule[] = [];

/**
 * Deletes every `@supports (text-box …)` block, so the page lays out as an
 * engine without `text-box` does, such as older WebKitGTK.
 */
function dropTextBoxSupport() {
	for (const sheet of document.styleSheets) {
		const rules = [...sheet.cssRules];
		for (let index = rules.length - 1; index >= 0; index--) {
			const rule = rules[index];
			if (!(rule instanceof CSSSupportsRule) || !rule.conditionText.includes('text-box')) continue;
			removed.push({ sheet, index, text: rule.cssText });
			sheet.deleteRule(index);
		}
	}
}

afterEach(() => {
	document.documentElement.removeAttribute('style');
	for (const { sheet, index, text } of removed.toReversed()) sheet.insertRule(text, index);
	removed.length = 0;
});

async function renderControls(font: UiFontName) {
	const family = themeCssProperties('eldritch', font)['--pau-font-ui']!;
	document.documentElement.style.setProperty('--pau-font-ui', family);
	await render(ControlStatesDemo);
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active });
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.referenced,
		effective: sandboxFixtures.referencedEffective
	});
	await document.fonts.load(`500 14px ${family}`);
	await document.fonts.ready;
	expect(document.fonts.check(`500 14px ${UI_FONTS[font].family}`)).toBe(true);

	const buttons = [...document.querySelectorAll('.pau-button')].filter((button) => button.textContent!.trim());
	const choices = [...document.querySelectorAll('.pau-choice')];
	expect(buttons.length).toBeGreaterThanOrEqual(10);
	expect(document.querySelectorAll('.pau-choice--multiline').length).toBeGreaterThanOrEqual(3);
	return { buttons, choices };
}

/** How far each label's cap center sits from its button's or input's center. */
function offsets(buttons: Element[], choices: Element[]) {
	return [
		...buttons.map((button) => ({ name: button.textContent!, offset: capCenter(button) - middle(button) })),
		...choices.map((choice) => ({
			name: choice.textContent!,
			offset: capCenter(choice) - middle(choice.querySelector('input')!)
		}))
	];
}

/** The space from a button's icon to its label, and from a label to its `kbd`. */
function itemSpacing() {
	const buttons = [...document.querySelectorAll('.pau-button')];
	const iconButton = buttons.find((button) => button.querySelector(':scope > .pau-icon + span'))!;
	const kbdButton = buttons.find((button) => button.querySelector(':scope > span + kbd'))!;
	const icon = iconButton.querySelector('.pau-icon')!.getBoundingClientRect();
	return {
		icon: textLeft(iconButton.querySelector(':scope > .pau-icon + span')!) - icon.right,
		kbd:
			kbdButton.querySelector('kbd')!.getBoundingClientRect().left -
			kbdButton.querySelector('span')!.getBoundingClientRect().right
	};
}

const remPx = () => Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));

test.each(Object.keys(UI_FONTS) as UiFontName[])(
	'centers button labels and choice inputs on the capitals in %s',
	async (font) => {
		const { buttons, choices } = await renderControls(font);
		expect(CSS.supports('text-box: trim-both cap alphabetic')).toBe(true);

		for (const { name, offset } of offsets(buttons, choices)) {
			expect(Math.abs(offset), name).toBeLessThanOrEqual(0.5);
		}
		const spacing = itemSpacing();
		expect(spacing.icon).toBeCloseTo(remPx() / 2, 0);
		expect(spacing.kbd).toBeCloseTo(remPx() / 2, 0);
	}
);

/*
 * Without `text-box`, centering places the line box, not the letters, so a
 * label sits off center by half the gap between its font's ascent and
 * descent. The bound is the largest such offset among the UI fonts. The
 * space between a button's items does not change.
 */
test.each(Object.keys(UI_FONTS) as UiFontName[])(
	'keeps labels within 2px of center without text-box in %s',
	async (font) => {
		const { buttons, choices } = await renderControls(font);
		const trimmed = itemSpacing();
		dropTextBoxSupport();
		expect(removed.length).toBeGreaterThanOrEqual(2);

		for (const { name, offset } of offsets(buttons, choices)) {
			expect(Math.abs(offset), name).toBeLessThanOrEqual(2);
		}
		const fallback = itemSpacing();
		expect(fallback.icon).toBeCloseTo(trimmed.icon, 0);
		expect(fallback.kbd).toBeCloseTo(trimmed.kbd, 0);
	}
);
