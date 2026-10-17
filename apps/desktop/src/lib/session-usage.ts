import type { SessionUsage as ApiSessionUsage } from '@stormlightlabs/pau-protocol';
import type { SessionUsage } from '@stormlightlabs/pau-ui';

/** Converts the API's usage report to the session surface's shape. */
export function viewUsage(usage: ApiSessionUsage): SessionUsage {
	const { context, tokens } = usage;
	return {
		context: context
			? {
					tokens: context.tokens ?? undefined,
					contextWindow: context.context_window,
					percent: context.percent ?? undefined
				}
			: undefined,
		tokens: {
			input: tokens.input,
			output: tokens.output,
			cacheRead: tokens.cache_read,
			cacheWrite: tokens.cache_write,
			total: tokens.total
		},
		cost: usage.cost
	};
}

/**
 * Reads the synthetic `session_usage` event the server publishes after each
 * assistant message and settled run. Returns undefined for any other event.
 */
export function usageFromEvent(event: unknown): SessionUsage | undefined {
	if (typeof event !== 'object' || event === null) return undefined;
	const { type, usage } = event as { type?: unknown; usage?: unknown };
	return type === 'session_usage' && typeof usage === 'object' && usage !== null
		? viewUsage(usage as ApiSessionUsage)
		: undefined;
}
