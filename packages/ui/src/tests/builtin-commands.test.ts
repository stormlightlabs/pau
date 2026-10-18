import { expect, test } from 'vitest';

import { BUILTIN_COMMANDS, builtinInvocation, withBuiltins } from '../lib/builtin-commands';
import type { CommandOption } from '../lib/types/session';

const sessionCommands: CommandOption[] = [{ name: 'compact', source: 'extension' }];

test('lets a session command keep a built-in name', () => {
	const names = withBuiltins(sessionCommands).map((command) => `${command.source}:${command.name}`);
	expect(names.filter((name) => name.endsWith(':compact'))).toEqual(['extension:compact']);
	expect(names).toHaveLength(BUILTIN_COMMANDS.length);
	expect(builtinInvocation('/compact now', sessionCommands)).toBeUndefined();
});

test('reads a built-in and its argument from the draft', () => {
	expect(builtinInvocation('  /name  Release prep ', [])).toMatchObject({
		command: { name: 'name', action: 'name' },
		argument: 'Release prep'
	});
	expect(builtinInvocation('/fork', [])).toMatchObject({ command: { action: 'branch' }, argument: '' });
	expect(builtinInvocation('/nope', [])).toBeUndefined();
	expect(builtinInvocation('name it', [])).toBeUndefined();
});
