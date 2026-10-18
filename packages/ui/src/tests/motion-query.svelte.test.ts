import { afterEach, describe, expect, test } from 'vitest';

import { isReducedMotion } from '../motion';
import '../styles/tokens.css';

/**
 * Runs in two browser projects, one with the OS reduced-motion query on and
 * one off (see `vitest.config.ts`). Each run reads the query it got.
 */
const osReduces = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

function offset(): string {
	return getComputedStyle(root).getPropertyValue('--pau-motion-offset-md').trim();
}

afterEach(() => delete root.dataset.motion);

describe(`OS reduced motion is ${osReduces ? 'on' : 'off'}`, () => {
	test('system follows the OS when data-motion is absent', () => {
		expect(isReducedMotion()).toBe(osReduces);
		expect(offset()).toBe(osReduces ? '0' : '0.5rem');
	});

	test('reduce wins over the OS', () => {
		root.dataset.motion = 'reduce';

		expect(isReducedMotion()).toBe(true);
		expect(offset()).toBe('0');
	});

	test('full wins over the OS', () => {
		root.dataset.motion = 'full';

		expect(isReducedMotion()).toBe(false);
		expect(offset()).toBe('0.5rem');
	});
});
