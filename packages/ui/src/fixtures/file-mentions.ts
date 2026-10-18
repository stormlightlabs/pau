import type { FileMention } from '../lib/types/session';

/** Workspace entries shared by stories and deterministic browser tests. */
export const fileMentionFixtures = {
	populated: [
		{ path: 'src/', directory: true },
		{ path: 'src/App.svelte', directory: false },
		{ path: 'src/lib/api.ts', directory: false },
		{ path: 'docs/release notes.md', directory: false },
		{ path: 'README.md', directory: false }
	]
} satisfies Record<string, FileMention[]>;
