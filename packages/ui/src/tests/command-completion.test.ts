import { expect, test } from 'vitest';

import { commandFixtures } from '../fixtures/commands';
import { commandName, commandQuery, filterCommands } from '../lib/command-completion';

test('reads the command being typed only before the first space', () => {
	expect(commandQuery('/')).toBe('');
	expect(commandQuery('/rev')).toBe('rev');
	expect(commandQuery('/review ')).toBeUndefined();
	expect(commandQuery('fix /review')).toBeUndefined();
	expect(commandName('/review the diff')).toBe('review');
	expect(commandName('/')).toBeUndefined();
});

function names(query: string): string[] {
	return filterCommands(commandFixtures.populated, query).map((command) => command.name);
}

test('ranks prefix matches before substring and fuzzy matches', () => {
	expect(names('')).toHaveLength(4);
	expect(names('REL')).toEqual(['skill:release-notes']);
	expect(names('re')).toEqual(['review', 'skill:release-notes']);
	expect(names('dpy')).toEqual(['deploy']);
	expect(names('zzz')).toEqual([]);
});
