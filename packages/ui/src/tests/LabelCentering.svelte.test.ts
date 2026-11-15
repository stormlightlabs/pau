import { page } from 'vitest/browser';
import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import { sandboxFixtures } from '../fixtures/sandbox';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';
import { longCommandOutput } from '../fixtures/foundation';
import ToolOutput from '../lib/ToolOutput.svelte';
import ButtonsDemo from '../stories/ButtonsDemo.svelte';
import ChipsDemo from '../stories/ChipsDemo.svelte';
import ControlStatesDemo from '../stories/ControlStatesDemo.svelte';
import FieldsDemo from '../stories/FieldsDemo.svelte';
import MenusDemo from '../stories/MenusDemo.svelte';
import NoticesDemo from '../stories/NoticesDemo.svelte';
import PageHeaderDemo from '../stories/PageHeaderDemo.svelte';
import RequestCardDemo from '../stories/RequestCardDemo.svelte';
import StripsDemo from '../stories/StripsDemo.svelte';
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

/*
 * Every centered label, mark and input text lands within half a CSS pixel of
 * its center line, in both engines. The centering projects run at a device
 * scale of 2, as on the Retina displays the desktop app draws on, so a
 * snapped box or glyph in WebKit is off by at most a quarter pixel.
 */
const precision = 0.5;

const remPx = () => Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));

test.each(Object.keys(UI_FONTS) as UiFontName[])(
	'centers button labels and choice inputs on the capitals in %s',
	async (font) => {
		const { buttons, choices } = await renderControls(font);
		expect(CSS.supports('text-box: trim-both cap alphabetic')).toBe(true);

		for (const { name, offset } of offsets(buttons, choices)) {
			expect(Math.abs(offset), name).toBeLessThanOrEqual(precision);
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

/** Renders every component sheet in one font and waits for the font to load. */
async function renderSheets(font: UiFontName) {
	await page.viewport(1440, 900);
	const family = themeCssProperties('eldritch', font)['--pau-font-ui']!;
	document.documentElement.style.setProperty('--pau-font-ui', family);
	for (const sheet of [ButtonsDemo, FieldsDemo, ChipsDemo, StripsDemo, PageHeaderDemo, MenusDemo, NoticesDemo]) {
		await render(sheet);
	}
	await render(RequestCardDemo);
	await render(ToolOutput, { lines: longCommandOutput, label: 'cargo test output', from: 'tail' });
	await document.fonts.load(`500 14px ${family}`);
	await document.fonts.ready;
}

/** The vertical center of an element's box, for icons, marks, inputs and boxes. */
const box = (selector: string, scope: ParentNode = document) =>
	[...scope.querySelectorAll(selector)].map((element) => ({ name: selector, center: middle(element) }));

/** The cap center of each element's text, for labels. */
const caps = (selector: string, scope: ParentNode = document) =>
	[...scope.querySelectorAll(selector)].map((element) => ({ name: `${selector} text`, center: capCenter(element) }));

/**
 * Every row of controls, with what must share its center line: the boxes of
 * icons, marks, inputs and controls, and the capitals of every label.
 */
function rows() {
	const groups: { name: string; items: { name: string; center: number }[] }[] = [];
	const add = (name: string, scope: Element, items: { name: string; center: number }[]) => {
		groups.push({ name, items: [{ name: 'row', center: middle(scope) }, ...items] });
	};

	for (const row of document.querySelectorAll<HTMLElement>('[data-row="field"], [data-row="select"]')) {
		add(row.dataset.row!, row.querySelector('.pau-field')!, [
			...box('.pau-field, .pau-button, .pau-chip, .pau-field > .pau-icon, kbd', row),
			...caps('.pau-button, .pau-field > span:not(.pau-icon), .pau-chip > span:not(.pau-icon), kbd > span', row)
		]);
	}
	for (const row of document.querySelectorAll<HTMLElement>('[data-row="choice"], [data-row="radio"]')) {
		add(row.dataset.row!, row.querySelector('input')!, [...box('input', row), ...caps('.pau-choice > span', row)]);
	}
	for (const row of document.querySelectorAll<HTMLElement>('[data-status]:has(> .pau-state)')) {
		add(`mark ${row.dataset.status}`, row.querySelector('.pau-mark')!, caps('.pau-state > span:not(.pau-mark)', row));
	}
	const chips = document.querySelector('[data-row="chips"]')!;
	for (const chip of chips.querySelectorAll('.pau-chip')) {
		add('chip', chip, [...box('.pau-icon', chip), ...caps(':scope > span:not(.pau-icon)', chip)]);
	}
	for (const strip of document.querySelectorAll('.pau-strip:not(.pau-strip--row)')) {
		const top = strip.getBoundingClientRect().top + 4;
		groups.push(
			{
				name: `strip ${strip.textContent}`,
				items: [
					{ name: 'first line', center: top + 12 },
					...box(':scope > .pau-mark', strip),
					...caps('.pau-strip__name, .pau-strip__agent, .pau-strip__meta', strip)
				]
			},
			{
				name: `strip state ${strip.textContent}`,
				items: [{ name: 'second line', center: top + 36 }, ...caps('.pau-strip__state, .pau-strip__figure', strip)]
			}
		);
	}
	for (const row of document.querySelectorAll('.pau-strip--row')) {
		add(`row strip ${row.textContent}`, row, [
			...box('.pau-icon', row),
			...caps('.pau-strip__name, .pau-strip__meta', row)
		]);
	}
	for (const heading of document.querySelectorAll('.pau-bay-heading')) {
		const label = heading.querySelector('.pau-section-label')!;
		groups.push({
			name: 'bay heading',
			items: [{ name: 'label', center: capCenter(label) }, ...caps('.pau-count', heading)]
		});
	}
	for (const header of document.querySelectorAll<HTMLElement>('.pau-page-header')) {
		add(`page header ${header.dataset.header}`, header, [
			...box('.pau-mark, .pau-button, .pau-button > .pau-icon', header),
			...caps(
				'.pau-page-header__title, .pau-state > span:not(.pau-mark), .pau-count, .pau-button:not(.pau-button--icon)',
				header
			)
		]);
	}
	for (const item of document.querySelectorAll('.pau-menu__item')) {
		// Closed lists, such as a select's, are not laid out.
		if (item.getClientRects().length === 0) continue;
		add(`menu ${item.textContent}`, item, [
			...box('.pau-icon, kbd', item),
			...caps(':scope > span:not(.pau-icon, .pau-menu__text)', item)
		]);
	}
	for (const actions of document.querySelectorAll(
		'.pau-request__actions, .pau-notice__actions, .pau-tool-output__bar'
	)) {
		add(actions.className, actions.querySelector('.pau-button')!, [
			...box('.pau-button, kbd', actions),
			...caps('.pau-button, kbd > span, .pau-request__aside, :scope > span', actions)
		]);
	}
	const head = document.querySelector('.pau-request__head')!;
	groups.push({
		name: 'request head',
		items: [
			{ name: 'question', center: capCenter(head.querySelector('.pau-request__title')!) },
			...box('.pau-mark', head)
		]
	});
	return groups;
}

test.each(Object.keys(UI_FONTS) as UiFontName[])(
	'keeps every control and row on one center line in %s',
	async (font) => {
		await renderSheets(font);
		const groups = rows();
		expect(groups.length).toBeGreaterThan(40);
		for (const group of groups) {
			const [reference, ...items] = group.items;
			for (const item of items) {
				expect(Math.abs(item.center - reference!.center), `${group.name}: ${item.name}`).toBeLessThanOrEqual(precision);
			}
		}
	}
);

test('makes every button, field and select 32px tall', async () => {
	await renderSheets('overpass');
	const controls = document.querySelectorAll('.pau-button, .pau-field, [role="combobox"]');
	expect(controls.length).toBeGreaterThan(40);
	for (const control of controls) {
		expect(control.getBoundingClientRect().height, control.textContent ?? '').toBe(32);
	}
});

/** A capture of the test frame, with how many image pixels make one CSS pixel. */
async function captureFrame() {
	const base64 = (await page.screenshot({ save: false })) as string;
	const image = new Image();
	image.src = `data:image/png;base64,${base64}`;
	await image.decode();
	const canvas = document.createElement('canvas');
	canvas.width = image.width;
	canvas.height = image.height;
	const context = canvas.getContext('2d', { willReadFrequently: true })!;
	context.drawImage(image, 0, 0);
	return { pixels: context.getImageData(0, 0, image.width, image.height), scale: image.width / innerWidth };
}

/**
 * How far the ink of an input's text sits from its field's center, in CSS
 * pixels, counted from the drawn pixels rather than from any box. Each row of
 * the input's content area gets the strongest contrast any of its pixels has
 * with the field fill, as a fraction of the strongest in the area. Capitals
 * with flat tops and a flat baseline make that profile a plateau with
 * partial rows at its edges, so its weighted mean row is the cap center to a
 * fraction of a device pixel.
 */
function inkOffset({ pixels, scale }: Awaited<ReturnType<typeof captureFrame>>, input: HTMLInputElement) {
	const field = (input.closest('.pau-field') ?? input).getBoundingClientRect();
	const box = input.getBoundingClientRect();
	const style = getComputedStyle(input);
	const inset = (side: 'Left' | 'Right') =>
		Number(style[`padding${side}`].replace('px', '')) + Number(style[`border${side}Width`].replace('px', ''));
	const left = Math.ceil((box.left + inset('Left')) * scale);
	const right = Math.floor((box.right - inset('Right')) * scale);
	const top = Math.ceil((field.top + 1) * scale);
	const bottom = Math.floor((field.bottom - 1) * scale);
	const at = (x: number, y: number) => (y * pixels.width + x) * 4;
	const fill = at(right - 1, top + 1);
	const contrast = (x: number, y: number) => {
		const index = at(x, y);
		return Math.max(
			...[0, 1, 2].map((channel) => Math.abs(pixels.data[index + channel]! - pixels.data[fill + channel]!))
		);
	};
	const profile: number[] = [];
	for (let y = top; y < bottom; y++) {
		let strongest = 0;
		for (let x = left; x < right; x++) strongest = Math.max(strongest, contrast(x, y));
		profile.push(strongest);
	}
	const peak = Math.max(...profile);
	expect(peak, 'the input text has ink').toBeGreaterThan(64);
	let weight = 0;
	let moment = 0;
	for (const [row, value] of profile.entries()) {
		const share = value / peak;
		weight += share;
		moment += share * (top + row + 0.5);
	}
	return moment / weight / scale - (field.top + field.height / 2);
}

/** The text every field shows while its ink is measured: capitals with flat tops and baselines. */
const CAPITALS = 'HIEFT';

for (const mode of ['value', 'placeholder'] as const) {
	test.each(Object.keys(UI_FONTS) as UiFontName[])(
		`centers input ${mode} text on the field by its ink in %s`,
		async (font) => {
			await page.viewport(900, 700);
			const properties = themeCssProperties('eldritch', font);
			for (const [name, value] of Object.entries(properties)) document.documentElement.style.setProperty(name, value);
			await render(FieldsDemo);
			await document.fonts.load(`400 14px ${properties['--pau-font-ui']}`);
			await document.fonts.ready;
			const inputs = [...document.querySelectorAll<HTMLInputElement>('input.pau-field, .pau-field > input')];
			expect(inputs.length).toBeGreaterThanOrEqual(5);
			for (const input of inputs) {
				input.value = mode === 'value' ? CAPITALS : '';
				input.placeholder = CAPITALS;
			}
			const frame = await captureFrame();
			expect(frame.scale).toBe(2);
			for (const input of inputs) {
				const offset = inkOffset(frame, input);
				expect.soft(Math.abs(offset), input.ariaLabel!).toBeLessThanOrEqual(precision);
			}
		}
	);
}
