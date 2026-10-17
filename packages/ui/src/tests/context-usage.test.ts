import { expect, test } from 'vitest';

import { contextLevel, formatCost, formatPercent, formatTokens } from '../lib/context-usage';

test.each([
	[0, 'ok'],
	[79.9, 'ok'],
	[80, 'warning'],
	[94.9, 'warning'],
	[95, 'danger'],
	[100, 'danger']
] as const)('classifies %s percent as %s', (percent, level) => {
	expect(contextLevel({ tokens: 1, contextWindow: 100, percent })).toBe(level);
});

test('classifies a report without a percent as unknown', () => {
	expect(contextLevel({ contextWindow: 100 })).toBe('unknown');
});

test('formats tokens, cost, and percent compactly', () => {
	expect(formatTokens(950)).toBe('950');
	expect(formatTokens(1234)).toBe('1.2k');
	expect(formatTokens(164_000)).toBe('164k');
	expect(formatTokens(1_500_000)).toBe('1.5M');
	expect(formatCost(0)).toBe('$0.00');
	expect(formatCost(0.0042)).toBe('$0.0042');
	expect(formatCost(1.2345)).toBe('$1.23');
	expect(formatPercent(99.8)).toBe('99%');
	expect(formatPercent(100)).toBe('100%');
});
