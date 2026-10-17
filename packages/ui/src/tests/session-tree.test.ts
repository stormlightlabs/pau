import { describe, expect, test } from 'vitest';

import { branchedSessionTree, sessionTreeFixtures } from '../fixtures/session-tree';
import { entryLabel, flattenSessionTree, runKey } from '../lib/session-tree';

const open = { collapsed: new Set<string>(), expandedRuns: new Set<string>() };

describe('flattenSessionTree', () => {
	test('keeps the current path at its level and indents the other branches', () => {
		const rows = flattenSessionTree(sessionTreeFixtures.small, open);

		expect(rows.map((row) => [row.key, row.level, row.onPath])).toEqual([
			['u1', 1, true],
			['a1', 1, true],
			['u2', 2, false],
			['a2', 2, false],
			['u3', 1, true],
			['a3', 1, true],
			['u4', 1, true],
			['a4', 1, true]
		]);
		expect(rows.find((row) => row.key === 'a1')).toMatchObject({ expanded: true, alternatives: 1, setSize: 6 });
		expect(rows.find((row) => row.key === 'u2')).toMatchObject({ parentKey: 'a1', position: 1, setSize: 2 });
		expect(rows.find((row) => row.key === 'u3')).toMatchObject({ position: 3, setSize: 6 });
	});

	test('hides the other branches of a collapsed branch point', () => {
		const rows = flattenSessionTree(sessionTreeFixtures.small, { ...open, collapsed: new Set(['a1']) });

		expect(rows.map((row) => row.key)).toEqual(['u1', 'a1', 'u3', 'a3', 'u4', 'a4']);
	});

	test('collapses runs between prompts until the operator expands them', () => {
		const tree = branchedSessionTree(2, 10);
		const collapsed = flattenSessionTree(tree, open);

		expect(collapsed.map((row) => (row.kind === 'run' ? `${row.key}×${row.count}` : row.key))).toEqual([
			'main-0-0',
			`${runKey('main-0-1')}×4`,
			'main-1-0',
			`${runKey('main-1-1')}×3`,
			'main-1-4'
		]);

		const expanded = flattenSessionTree(tree, { ...open, expandedRuns: new Set([runKey('main-0-1')]) });
		expect(expanded.slice(1, 5).map((row) => row.key)).toEqual(['main-0-1', 'main-0-2', 'main-0-3', 'main-0-4']);
	});

	test('treats entries whose parent was truncated as roots', () => {
		const rows = flattenSessionTree(sessionTreeFixtures.truncated, open);

		expect(rows[0]).toMatchObject({ level: 1 });
		expect(rows.filter((row) => row.level === 1 && row.parentKey === undefined).length).toBeGreaterThan(1);
		expect(rows.find((row) => row.kind === 'entry' && row.isLeaf)).toMatchObject({ onPath: true, level: 1 });
	});

	test('flattens thousands of entries without recursion', () => {
		const tree = branchedSessionTree(4000, 100);
		const rows = flattenSessionTree(tree, open);

		expect(tree.entries.length).toBeGreaterThan(20_000);
		expect(rows.filter((row) => row.kind === 'entry' && row.isLeaf)).toHaveLength(1);
	});
});

test('labels entries by author or kind', () => {
	expect(entryLabel({ id: '1', kind: 'message', role: 'assistant', preview: '' }, 'Pi')).toBe('Pi');
	expect(entryLabel({ id: '2', kind: 'message', role: 'toolResult', preview: '' }, 'Pi')).toBe('Tool result');
	expect(entryLabel({ id: '3', kind: 'branch_summary', preview: '' }, 'Pi')).toBe('Branch summary');
	expect(entryLabel({ id: '4', kind: 'modelChange', preview: '' }, 'Pi')).toBe('Model change');
});
