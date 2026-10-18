import { expect, test } from 'vitest';

import { filterPalette, fuzzyRank, type PaletteEntry } from '../lib/command-palette';

test.each([
	['', 'New session', 0],
	['new', 'New session', 0],
	['ses', 'New session', 1],
	['ess', 'New session', 2],
	['ns', 'New session', 3],
	['NS', 'New session', 3],
	['sw', 'New session', undefined],
	['zoom', 'New session', undefined]
])('ranks %j against %j as %j', (query, text, rank) => {
	expect(fuzzyRank(query, text)).toBe(rank);
});

const entry = (id: string, label: string, group: PaletteEntry['group'], detail?: string): PaletteEntry => ({
	id,
	label,
	group,
	detail
});

test('orders matches by group, then rank, then original order, with detail matches last', () => {
	const entries = [
		entry('view', 'Sessions', 'Views'),
		entry('in-detail', 'Fix gutter', 'Sessions', 'session tests'),
		entry('subsequence', 'Restore saved notes', 'Sessions'),
		entry('prefix', 'Session tree', 'Sessions'),
		entry('action', 'New session', 'Actions'),
		entry('miss', 'Zoom in', 'Actions')
	];

	expect(filterPalette(entries, 'ses').map(({ id }) => id)).toEqual([
		'action',
		'prefix',
		'subsequence',
		'in-detail',
		'view'
	]);
});

test('lists unavailable entries after available ones within a group', () => {
	const entries = [
		{ ...entry('off', 'Show shortcuts', 'Actions'), disabled: 'Not available in this view' },
		entry('on', 'New session', 'Actions'),
		entry('view', 'Sessions', 'Views')
	];

	expect(filterPalette(entries, '').map(({ id }) => id)).toEqual(['on', 'off', 'view']);
});
