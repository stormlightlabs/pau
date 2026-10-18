/** Kinds of palette entries, in the order the palette lists them. */
export const PALETTE_GROUPS = ['Actions', 'Sessions', 'Workspaces', 'Views'] as const;

export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/**
 * One command palette row. An entry either runs a callback or links to a
 * route with `href`, which lets the app's router handle the navigation.
 */
export type PaletteEntry = {
	/** Stable identity, unique across every group. */
	id: string;
	label: string;
	group: PaletteGroup;
	/** Secondary text that the filter also matches, such as a session's workspace. */
	detail?: string;
	/** Formatted shortcut shown at the end of the row. */
	shortcut?: string;
	/** Why the entry cannot run. A disabled entry shows the reason instead of its shortcut. */
	disabled?: string;
	run?: () => void;
	href?: string;
};

/**
 * Ranks how well a query matches text, lower is better, or returns
 * `undefined` when it does not match. A prefix ranks first, then a match at
 * the start of a word, then any substring, then the query's characters in
 * order with gaps, such as `ns` in "New session". Matching ignores case.
 */
export function fuzzyRank(query: string, text: string): number | undefined {
	const needle = query.trim().toLowerCase();
	const haystack = text.toLowerCase();
	if (needle === '' || haystack.startsWith(needle)) return 0;
	const index = haystack.indexOf(needle);
	if (index > 0 && /\W/.test(haystack.charAt(index - 1))) return 1;
	if (index > 0) return 2;
	let at = 0;
	for (const char of haystack) if (char === needle[at]) at += 1;
	return at === needle.length ? 3 : undefined;
}

/**
 * Filters entries by a query and orders them by group, then by rank, then by
 * their original order. A label match outranks a match in the detail text.
 */
export function filterPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
	return entries
		.map((entry, order) => {
			const label = fuzzyRank(query, entry.label);
			const detail = entry.detail === undefined ? undefined : fuzzyRank(query, entry.detail);
			const rank = label ?? (detail === undefined ? undefined : detail + 4);
			return { entry, order, rank, group: PALETTE_GROUPS.indexOf(entry.group) };
		})
		.filter((match): match is typeof match & { rank: number } => match.rank !== undefined)
		.sort((a, b) => a.group - b.group || a.rank - b.rank || a.order - b.order)
		.map((match) => match.entry);
}
