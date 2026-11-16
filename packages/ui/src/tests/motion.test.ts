import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { isReducedMotion, motion, motionOffset } from '../motion';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function token(name: string): string {
	const match = css.match(new RegExp(String.raw`${name}:\s*([^;]+);`));
	if (!match) throw new Error(`Missing token ${name}`);
	return match[1]!.trim();
}

describe('motion tokens', () => {
	test.each(Object.entries(motion.duration))('duration %s matches CSS', (name, ms) => {
		expect(token(`--pau-duration-${name}`)).toBe(`${ms}ms`);
	});

	test.each(Object.entries(motion.arrival))('arrival %s matches CSS', (name, ms) => {
		expect(token(`--pau-arrival-${name}`)).toBe(`${ms}ms`);
	});

	test('mark spin matches CSS', () => {
		expect(token('--pau-mark-spin')).toBe(`${motion.markSpin}ms`);
	});

	test.each(Object.entries(motion.ease))('easing %s matches CSS', (name, value) => {
		expect(token(`--pau-ease-${name}`)).toBe(value);
	});

	test.each(Object.entries(motion.offset))('offset %s matches CSS', (name, rem) => {
		expect(token(`--pau-motion-offset-${name}`)).toBe(`${rem}rem`);
	});

	test('enter scale matches CSS', () => {
		expect(token('--pau-motion-scale-enter')).toBe(String(motion.scaleEnter));
	});

	test('reduced motion zeroes distances and scale in both CSS paths', () => {
		for (const selector of [":root[data-motion='reduce']", ':root:not([data-motion])']) {
			const block = css.slice(css.indexOf(selector)).split('}', 1)[0]!;
			expect(block).toContain('--pau-motion-offset-sm: 0;');
			expect(block).toContain('--pau-motion-offset-md: 0;');
			expect(block).toContain('--pau-motion-scale-enter: 1;');
		}
	});
});

const query = (matches: boolean) => () => ({ matches });

describe('isReducedMotion', () => {
	test('follows the OS query when data-motion is unset', () => {
		expect(isReducedMotion({ dataset: {} }, query(true))).toBe(true);
		expect(isReducedMotion({ dataset: {} }, query(false))).toBe(false);
	});

	test('data-motion overrides the OS query', () => {
		expect(isReducedMotion({ dataset: { motion: 'reduce' } }, query(false))).toBe(true);
		expect(isReducedMotion({ dataset: { motion: 'full' } }, query(true))).toBe(false);
	});

	test('offsets drop to zero when reduced', () => {
		expect(motionOffset('md', true)).toBe(0);
		expect(motionOffset('md', false)).toBe(motion.offset.md);
	});
});
