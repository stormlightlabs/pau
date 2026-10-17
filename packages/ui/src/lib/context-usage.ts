import type { ContextUsage } from './types/session';

/** Context fill at or above this percent shows the warning state. */
export const CONTEXT_WARNING_PERCENT = 80;

/** Context fill at or above this percent shows the danger state. */
export const CONTEXT_DANGER_PERCENT = 95;

/** How full the context window is: `unknown` until a usage report exists after a compaction. */
export type ContextLevel = 'ok' | 'warning' | 'danger' | 'unknown';

/**
 * Classifies a context report. Below 80% is `ok`, 80% up to 95% is `warning`,
 * and 95% or more is `danger`. A report without a percent is `unknown`.
 */
export function contextLevel(context: ContextUsage): ContextLevel {
	if (context.percent === undefined) return 'unknown';
	if (context.percent >= CONTEXT_DANGER_PERCENT) return 'danger';
	if (context.percent >= CONTEXT_WARNING_PERCENT) return 'warning';
	return 'ok';
}

/** Formats a token count with a k or M suffix once it reaches 1,000. */
export function formatTokens(tokens: number): string {
	const compact = (value: number, suffix: string) =>
		`${new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 100 ? 1 : 0 }).format(value)}${suffix}`;
	if (tokens >= 1_000_000) return compact(tokens / 1_000_000, 'M');
	if (tokens >= 1_000) return compact(tokens / 1_000, 'k');
	return new Intl.NumberFormat().format(tokens);
}

/** Formats an exact token count with thousands separators. */
export function formatTokenCount(tokens: number): string {
	return new Intl.NumberFormat().format(tokens);
}

/** Formats a cost in US dollars, keeping four decimals while it is under one cent. */
export function formatCost(dollars: number): string {
	const digits = dollars > 0 && dollars < 0.01 ? 4 : 2;
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(dollars);
}

/** Formats a percent without decimals. Only a full window reads as 100%. */
export function formatPercent(percent: number): string {
	return `${percent >= 100 ? 100 : Math.floor(percent)}%`;
}
