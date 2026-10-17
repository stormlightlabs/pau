import type { SessionTreeItem, SessionTreeSnapshot } from '../lib/types/session';

const prompts = [
	'Fix the flaky terminal resize test',
	'Explain why the event stream reconnects twice',
	'Add a regression test for the sandbox denial path',
	'Rename the workspace store to match the API',
	'Profile the transcript reducer with a long session'
];

function entry(
	id: string,
	parentId: string | undefined,
	role: string,
	preview: string,
	minute: number
): SessionTreeItem {
	return {
		id,
		parentId,
		kind: 'message',
		role,
		preview,
		timestamp: new Date(Date.UTC(2026, 4, 1, 9, minute)).toISOString()
	};
}

/**
 * Appends `turns` prompt turns after `parentId`. Each turn is a user prompt,
 * an assistant tool call, two tool results, and an assistant answer.
 */
function appendTurns(
	entries: SessionTreeItem[],
	prefix: string,
	parentId: string | undefined,
	turns: number,
	firstTurn = 0
): string | undefined {
	let parent = parentId;
	for (let turn = firstTurn; turn < firstTurn + turns; turn += 1) {
		const minute = entries.length;
		const ids = [0, 1, 2, 3, 4].map((step) => `${prefix}-${turn}-${step}`);
		entries.push(entry(ids[0]!, parent, 'user', `${prompts[turn % prompts.length]} (${prefix} ${turn + 1})`, minute));
		entries.push(entry(ids[1]!, ids[0], 'assistant', 'I will read the relevant files first.', minute));
		entries.push(entry(ids[2]!, ids[1], 'toolResult', 'packages/ui/src/lib/TerminalSurface.svelte', minute));
		entries.push(entry(ids[3]!, ids[2], 'toolResult', 'apps/desktop/src/lib/event-stream.ts', minute));
		entries.push(entry(ids[4]!, ids[3], 'assistant', 'The resize handler runs before the socket opens.', minute));
		parent = ids[4];
	}
	return parent;
}

/**
 * Builds a session with `turns` main-line turns and a side branch every
 * `branchEvery` turns, so tests can exercise thousands of entries.
 */
export function branchedSessionTree(turns: number, branchEvery: number): SessionTreeSnapshot {
	const entries: SessionTreeItem[] = [];
	let leaf: string | undefined;
	for (let start = 0; start < turns; start += branchEvery) {
		const forkPoint = leaf;
		leaf = appendTurns(entries, 'main', leaf, Math.min(branchEvery, turns - start), start);
		if (forkPoint !== undefined) appendTurns(entries, `side${start}`, forkPoint, 3);
	}
	return { entries, leafId: leaf, truncated: false };
}

const small: SessionTreeSnapshot = {
	entries: [
		entry('u1', undefined, 'user', 'Fix the flaky terminal resize test', 0),
		entry('a1', 'u1', 'assistant', 'The resize handler runs before the socket opens.', 1),
		entry('u2', 'a1', 'user', 'Move the resize after the socket opens', 2),
		entry('a2', 'u2', 'assistant', 'Moved it and added a regression test.', 3),
		entry('u3', 'a1', 'user', 'Queue resizes until the socket opens instead', 4),
		entry('a3', 'u3', 'assistant', 'Resizes now wait in a queue until the socket is ready.', 5),
		entry('u4', 'a3', 'user', 'Run the terminal tests again', 6),
		entry('a4', 'u4', 'assistant', 'All twelve terminal tests pass.', 7)
	],
	leafId: 'a4',
	truncated: false
};

const large = branchedSessionTree(800, 40);

export const sessionTreeFixtures = {
	empty: { entries: [], truncated: false },
	small,
	/** About 4,300 entries with a side branch every 40 turns. */
	large,
	/** The newest entries of a longer session. The oldest entries lost their parents. */
	truncated: (() => {
		const tree = branchedSessionTree(1100, 50);
		return { ...tree, entries: tree.entries.slice(-5000), truncated: true };
	})()
} satisfies Record<string, SessionTreeSnapshot>;
