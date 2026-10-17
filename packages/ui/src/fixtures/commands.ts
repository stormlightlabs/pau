import type { CommandOption } from '../lib/types/session';

/** Slash command lists shared by stories and deterministic browser tests. */
export const commandFixtures = {
	populated: [
		{ name: 'compact', description: 'Summarize the conversation to free context', source: 'extension' },
		{ name: 'review', description: 'Review the working tree changes', source: 'prompt' },
		{ name: 'skill:release-notes', description: 'Draft release notes from merged changes', source: 'skill' },
		{ name: 'deploy', source: 'extension' }
	]
} satisfies Record<string, CommandOption[]>;
