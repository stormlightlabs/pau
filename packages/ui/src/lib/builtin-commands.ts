import type { CommandOption } from './types/session';

/**
 * The Pau action behind a Pi built-in command. Pi handles built-ins in its
 * terminal editor and treats them as plain text over RPC, so Pau runs each one
 * itself instead of sending it.
 */
export type BuiltinAction =
	| 'model'
	| 'thinking'
	| 'new'
	| 'resume'
	| 'name'
	| 'inspector'
	| 'tree'
	| 'branch'
	| 'clone'
	| 'compact'
	| 'copy'
	| 'export'
	| 'shortcuts'
	| 'stop';

/** A Pi built-in command and how Pau handles it. */
export type BuiltinCommand = CommandOption & {
	source: 'builtin';
	description: string;
	/** What Pau runs. Absent when the command needs Pi's terminal interface. */
	action?: BuiltinAction;
};

/** Why Pau cannot run a built-in that only Pi's terminal interface offers. */
export const TERMINAL_ONLY_REASON = 'Needs Pi in a terminal. Open Pi in a Pau terminal to use it.';

function runs(name: string, action: BuiltinAction, description: string, argument?: string): BuiltinCommand {
	return { name, description, source: 'builtin', action, ...(argument && { argument }) };
}

function terminalOnly(name: string, description: string): BuiltinCommand {
	return { name, description, source: 'builtin', unavailable: TERMINAL_ONLY_REASON };
}

/** Pi's built-in commands in the order Pi documents them, each mapped to its Pau action. */
export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
	terminalOnly('settings', 'Open settings'),
	runs('model', 'model', 'Select a model', '[provider/model]'),
	runs('thinking', 'thinking', 'Set the thinking level', '[level]'),
	terminalOnly('scoped-models', 'Configure the models used by interactive cycling'),
	terminalOnly('login', 'Add provider authentication'),
	terminalOnly('logout', 'Remove provider authentication'),
	terminalOnly('llama', 'Manage models on the configured llama.cpp router'),
	runs('new', 'new', 'Start a new session'),
	runs('resume', 'resume', 'Switch to another saved session'),
	runs('name', 'name', 'Rename the session', '[name]'),
	runs('session', 'inspector', 'Show session details in the inspector'),
	runs('tree', 'tree', 'Show the session tree'),
	runs('fork', 'branch', 'Branch from an earlier message in the session tree'),
	runs('clone', 'clone', 'Duplicate the session at its current position'),
	runs('compact', 'compact', 'Compact the context, optionally with instructions', '[instructions]'),
	terminalOnly('import', 'Import and resume a JSONL session'),
	runs('copy', 'copy', 'Copy the last reply'),
	runs('export', 'export', 'Save the conversation as a web page'),
	terminalOnly('share', 'Upload the session and return a viewer link'),
	terminalOnly('bug', 'Prepare a private bug report for the Pi developers'),
	terminalOnly('trust', 'Save a project trust decision'),
	terminalOnly('reload', 'Reload keybindings, extensions, skills, templates, and themes'),
	runs('hotkeys', 'shortcuts', 'Show keyboard shortcuts'),
	terminalOnly('changelog', 'Show changelog entries'),
	runs('quit', 'stop', 'Stop the session')
];

/** What the host offers to the built-ins that need it. */
export type BuiltinOptions = {
	/** Whether the host has a save dialog for transcripts. Without one, `/export` needs Pi's terminal. */
	canExport: boolean;
};

const TERMINAL_EXPORT = terminalOnly('export', 'Export the session as HTML or JSONL');

/** Pi's built-ins as this host handles them. */
function builtinCommands({ canExport }: BuiltinOptions): readonly BuiltinCommand[] {
	if (canExport) return BUILTIN_COMMANDS;
	return BUILTIN_COMMANDS.map((command) => (command.name === 'export' ? TERMINAL_EXPORT : command));
}

/**
 * Joins the session's commands with Pi's built-ins. A session command keeps
 * its name over a built-in, because Pi runs the session command when it
 * receives that name over RPC.
 */
export function withBuiltins(commands: readonly CommandOption[], options: BuiltinOptions): CommandOption[] {
	const taken = new Set(commands.map((command) => command.name));
	return [...commands, ...builtinCommands(options).filter((command) => !taken.has(command.name))];
}

/** A built-in typed in the draft, with the text after its name. */
export type BuiltinInvocation = { command: BuiltinCommand; argument: string };

/**
 * Finds the built-in a draft starts with, or `undefined` when the draft is not
 * one or names one of the session's own commands.
 */
export function builtinInvocation(
	draft: string,
	sessionCommands: readonly CommandOption[],
	options: BuiltinOptions
): BuiltinInvocation | undefined {
	const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
	if (!match || sessionCommands.some((command) => command.name === match[1])) return undefined;
	const command = builtinCommands(options).find((candidate) => candidate.name === match[1]);
	return command ? { command, argument: match[2]?.trim() ?? '' } : undefined;
}
