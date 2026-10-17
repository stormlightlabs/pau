import type { SessionTreeItem, SessionTreeSnapshot } from './types/session';

/**
 * Linear runs of at least this many non-user entries collapse into one row,
 * so the tree reads as a list of prompts with their branch points.
 */
export const COLLAPSE_RUN_LENGTH = 3;

type RowPosition = {
	/** 1-based depth, as `aria-level` expects. */
	level: number;
	/** Key of the row that `ArrowLeft` moves to, when the row has a parent. */
	parentKey?: string;
	/** 1-based position among rows at the same level under the same parent. */
	position: number;
	setSize: number;
	/** Whether the row lies on the path from a root to the current leaf. */
	onPath: boolean;
};

/**
 * One visible entry. On a branch point, `alternatives` counts the branches
 * that indent beneath it and `expanded` says whether they are shown.
 */
export type SessionTreeEntryRow = RowPosition & {
	kind: 'entry';
	key: string;
	item: SessionTreeItem;
	isLeaf: boolean;
	expanded?: boolean;
	alternatives?: number;
};

/** A collapsed linear run of entries that expands in place. */
export type SessionTreeRunRow = RowPosition & {
	kind: 'run';
	key: string;
	/** ID of the first hidden entry, which takes focus after expanding. */
	firstId: string;
	count: number;
};

export type SessionTreeRow = SessionTreeEntryRow | SessionTreeRunRow;

/** Which branch points are collapsed and which runs the operator expanded. */
export type SessionTreeExpansion = { collapsed: ReadonlySet<string>; expandedRuns: ReadonlySet<string> };

type Chain = { startId: string; level: number; parentKey?: string; group: string };

/** Returns the run row key for a run that starts at `firstId`. */
export function runKey(firstId: string): string {
	return `run:${firstId}`;
}

/** IDs from the current leaf back to its root. */
export function currentPath(tree: SessionTreeSnapshot): Set<string> {
	const parents = new Map(tree.entries.map((entry) => [entry.id, entry.parentId]));
	const path = new Set<string>();
	let id = tree.leafId;
	while (id !== undefined && parents.has(id) && !path.has(id)) {
		path.add(id);
		id = parents.get(id);
	}
	return path;
}

/**
 * Flattens the tree into display rows in depth-first order.
 *
 * A linear chain stays at one level. At a branch point, the child on the
 * current path (or the oldest child, off the path) continues at the same
 * level, and every other branch indents beneath the branch point. A session
 * with many branches therefore keeps its main line at the left edge instead
 * of drifting right. Entries whose parent was left out by truncation become
 * roots. The walk is iterative because a chain can be thousands of entries
 * long.
 */
export function flattenSessionTree(tree: SessionTreeSnapshot, expansion: SessionTreeExpansion): SessionTreeRow[] {
	const known = new Set(tree.entries.map((entry) => entry.id));
	const byId = new Map(tree.entries.map((entry) => [entry.id, entry]));
	const children = new Map<string, string[]>();
	const roots: string[] = [];
	for (const entry of tree.entries) {
		if (entry.parentId === undefined || !known.has(entry.parentId)) {
			roots.push(entry.id);
			continue;
		}
		const siblings = children.get(entry.parentId);
		if (siblings) siblings.push(entry.id);
		else children.set(entry.parentId, [entry.id]);
	}
	const path = currentPath(tree);
	const rows: (Omit<SessionTreeEntryRow, 'position' | 'setSize'> | Omit<SessionTreeRunRow, 'position' | 'setSize'>)[] =
		[];
	const groups: string[] = [];
	const stack: Chain[] = roots.map((id) => ({ startId: id, level: 1, group: '' })).toReversed();

	const collapsible = (item: SessionTreeItem) =>
		item.role !== 'user' && item.id !== tree.leafId && (children.get(item.id)?.length ?? 0) <= 1;

	while (stack.length > 0) {
		const chain = stack.pop()!;
		const base = { level: chain.level, parentKey: chain.parentKey };
		let run: SessionTreeItem[] = [];
		const flush = () => {
			const first = run[0];
			if (first && run.length >= COLLAPSE_RUN_LENGTH && !expansion.expandedRuns.has(runKey(first.id))) {
				rows.push({
					...base,
					kind: 'run',
					key: runKey(first.id),
					firstId: first.id,
					count: run.length,
					onPath: path.has(first.id)
				});
				groups.push(chain.group);
			} else {
				for (const item of run) {
					rows.push({ ...base, kind: 'entry', key: item.id, item, isLeaf: false, onPath: path.has(item.id) });
					groups.push(chain.group);
				}
			}
			run = [];
		};

		let id: string | undefined = chain.startId;
		while (id !== undefined) {
			const item = byId.get(id)!;
			const next: string[] = children.get(id) ?? [];
			if (collapsible(item)) {
				run.push(item);
			} else {
				flush();
				const branchPoint = next.length > 1;
				const expanded = branchPoint ? !expansion.collapsed.has(id) : undefined;
				rows.push({
					...base,
					kind: 'entry',
					key: id,
					item,
					isLeaf: id === tree.leafId,
					onPath: path.has(id),
					expanded,
					alternatives: branchPoint ? next.length - 1 : undefined
				});
				groups.push(chain.group);
				if (branchPoint) {
					const primary = next.find((child) => path.has(child)) ?? next[0]!;
					stack.push({ ...chain, startId: primary });
					if (expanded) {
						const others = next.filter((child) => child !== primary).toReversed();
						for (const child of others) {
							stack.push({ startId: child, level: chain.level + 1, parentKey: id, group: id });
						}
					}
					id = undefined;
					continue;
				}
			}
			id = next[0];
		}
		flush();
	}

	const sizes = new Map<string, number>();
	for (const [index, row] of rows.entries()) {
		const group = `${groups[index]}:${row.level}`;
		sizes.set(group, (sizes.get(group) ?? 0) + 1);
	}
	const seen = new Map<string, number>();
	return rows.map((row, index) => {
		const group = `${groups[index]}:${row.level}`;
		const position = (seen.get(group) ?? 0) + 1;
		seen.set(group, position);
		return { ...row, position, setSize: sizes.get(group)! } as SessionTreeRow;
	});
}

/** Short label for an entry: who wrote it, or what kind of entry it is. */
export function entryLabel(item: SessionTreeItem, agent: string): string {
	if (item.kind === 'message') {
		switch (item.role) {
			case 'user': {
				return 'You';
			}
			case 'assistant': {
				return agent;
			}
			case 'toolResult': {
				return 'Tool result';
			}
			case 'bashExecution': {
				return 'Shell command';
			}
		}
	}
	const words = (item.kind === 'message' && item.role ? item.role : item.kind)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}
