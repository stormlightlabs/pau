import type { ModelOption } from '../lib/types/session';

/** Model lists shared by stories and deterministic browser tests. */
export const modelFixtures = {
	populated: [
		{ provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: true, current: true },
		{ provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', reasoning: false, current: false },
		{ provider: 'openai', id: 'gpt-5', reasoning: true, current: false }
	],
	/** About as many models as a signed-in Pi lists across its providers, so the list scrolls. */
	full: fullList(),
	empty: [] as ModelOption[]
} satisfies Record<string, ModelOption[]>;

function fullList(): ModelOption[] {
	const providers: Record<string, [id: string, name: string, reasoning: boolean][]> = {
		anthropic: [
			['claude-opus-4-5', 'Claude Opus 4.5', true],
			['claude-sonnet-4-5', 'Claude Sonnet 4.5', true],
			['claude-haiku-4-5', 'Claude Haiku 4.5', false],
			['claude-opus-4-1', 'Claude Opus 4.1', true],
			['claude-sonnet-4', 'Claude Sonnet 4', true],
			['claude-3-7-sonnet', 'Claude Sonnet 3.7', true],
			['claude-3-5-haiku', 'Claude Haiku 3.5', false]
		],
		openai: [
			['gpt-5', 'GPT-5', true],
			['gpt-5-mini', 'GPT-5 mini', true],
			['gpt-5-nano', 'GPT-5 nano', true],
			['gpt-5-codex', 'GPT-5 Codex', true],
			['gpt-4.1', 'GPT-4.1', false],
			['gpt-4.1-mini', 'GPT-4.1 mini', false],
			['o3', 'o3', true],
			['o4-mini', 'o4-mini', true]
		],
		google: [
			['gemini-2.5-pro', 'Gemini 2.5 Pro', true],
			['gemini-2.5-flash', 'Gemini 2.5 Flash', true],
			['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', true],
			['gemini-2.0-flash', 'Gemini 2.0 Flash', false]
		],
		openrouter: [
			['deepseek/deepseek-r1', 'DeepSeek R1', true],
			['deepseek/deepseek-chat-v3.1', 'DeepSeek V3.1', false],
			['qwen/qwen3-coder', 'Qwen3 Coder 480B A35B', false],
			['qwen/qwen3-235b-a22b-thinking', 'Qwen3 235B A22B Thinking', true],
			['moonshotai/kimi-k2', 'Kimi K2', false],
			['z-ai/glm-4.6', 'GLM 4.6', true],
			['meta-llama/llama-4-maverick', 'Llama 4 Maverick', false],
			['x-ai/grok-4', 'Grok 4', true],
			['x-ai/grok-code-fast-1', 'Grok Code Fast 1', true]
		],
		groq: [
			['openai/gpt-oss-120b', 'GPT OSS 120B', true],
			['openai/gpt-oss-20b', 'GPT OSS 20B', true],
			['llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile', false]
		],
		mistral: [
			['mistral-large-latest', 'Mistral Large', false],
			['mistral-medium-latest', 'Mistral Medium', false],
			['codestral-latest', 'Codestral', false],
			['devstral-medium-latest', 'Devstral Medium', false],
			['magistral-medium-latest', 'Magistral Medium', true]
		],
		ollama: [
			['qwen2.5-coder:32b', 'qwen2.5-coder:32b', false],
			['llama3.1:8b', 'llama3.1:8b', false],
			['gpt-oss:20b', 'gpt-oss:20b', true]
		]
	};
	return Object.entries(providers).flatMap(([provider, models]) =>
		models.map(([id, name, reasoning]) => ({
			provider,
			id,
			name,
			reasoning,
			current: provider === 'anthropic' && id === 'claude-sonnet-4-5'
		}))
	);
}
