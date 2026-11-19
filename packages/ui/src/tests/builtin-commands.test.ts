import { expect, test } from 'vitest';

import { BUILTIN_COMMANDS, builtinInvocation, TERMINAL_ONLY_REASON, withBuiltins } from '../lib/builtin-commands';
import type { CommandOption } from '../lib/types/session';

const sessionCommands: CommandOption[] = [{ name: 'compact', source: 'extension' }];
const host = { canExport: true };

test('lets a session command keep a built-in name', () => {
	const names = withBuiltins(sessionCommands, host).map((command) => `${command.source}:${command.name}`);
	expect(names.filter((name) => name.endsWith(':compact'))).toEqual(['extension:compact']);
	expect(names).toHaveLength(BUILTIN_COMMANDS.length);
	expect(builtinInvocation('/compact now', sessionCommands, host)).toBeUndefined();
});

test('reads a built-in and its argument from the draft', () => {
	expect(builtinInvocation('  /name  Release prep ', [], host)).toMatchObject({
		command: { name: 'name', action: 'name' },
		argument: 'Release prep'
	});
	expect(builtinInvocation('/fork', [], host)).toMatchObject({ command: { action: 'branch' }, argument: '' });
	expect(builtinInvocation('/nope', [], host)).toBeUndefined();
	expect(builtinInvocation('name it', [], host)).toBeUndefined();
});

test('runs /export only where the host can save a transcript', () => {
	expect(builtinInvocation('/export', [], host)).toMatchObject({ command: { action: 'export' } });
	const terminal = builtinInvocation('/export', [], { canExport: false });
	expect(terminal?.command.action).toBeUndefined();
	expect(terminal?.command.unavailable).toBe(TERMINAL_ONLY_REASON);
	expect(withBuiltins([], { canExport: false }).find((command) => command.name === 'export')).toMatchObject({
		unavailable: TERMINAL_ONLY_REASON
	});
});
