import type { SessionUsage } from '../lib/types/session';

const tokens = { input: 84_210, output: 12_480, cacheRead: 410_000, cacheWrite: 31_250, total: 537_940 };

/** Usage reports shared by stories and deterministic browser tests. */
export const usageFixtures = {
	normal: { context: { tokens: 84_000, contextWindow: 200_000, percent: 42 }, tokens, cost: 1.2345 },
	nearLimit: { context: { tokens: 164_000, contextWindow: 200_000, percent: 82 }, tokens, cost: 3.5 },
	atLimit: { context: { tokens: 196_000, contextWindow: 200_000, percent: 98 }, tokens, cost: 4.02 },
	unknownAfterCompaction: { context: { contextWindow: 200_000 }, tokens, cost: 4.02 },
	noContext: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0.0042 }
} satisfies Record<string, SessionUsage>;
