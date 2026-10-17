import type { ModelOption } from '../lib/types/session';

/** Model lists shared by stories and deterministic browser tests. */
export const modelFixtures = {
	populated: [
		{ provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: true, current: true },
		{ provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', reasoning: false, current: false },
		{ provider: 'openai', id: 'gpt-5', reasoning: true, current: false }
	],
	empty: [] as ModelOption[]
} satisfies Record<string, ModelOption[]>;
