import { expect, test } from 'vitest';

import { stepZoom } from './zoom';

test('steps through zoom levels and stops at the limits', () => {
	expect(stepZoom(1, 1)).toBe(1.1);
	expect(stepZoom(1, -1)).toBe(0.9);
	expect(stepZoom(1.2, 1)).toBe(1.25);
	expect(stepZoom(3, 1)).toBe(3);
	expect(stepZoom(0.5, -1)).toBe(0.5);
});
