/**
 * The questions the gate asks about a `bash` command, answered by the vendored
 * analysis: its command units, the paths it reads or writes, and whether each
 * unit is a wrapper, failed to parse, only reads, or reaches the network.
 */
import type { AccessPath } from '#src/access-intent/access-path';
import { proveCommandEffect } from '#src/access-intent/bash/command-effects';
import { type ArgWord, WordReader } from '#src/access-intent/bash/node-text';
import { getParser } from '#src/access-intent/bash/parser';
import { BashProgram } from '#src/access-intent/bash/program';
import { REDIRECT_NODE_TYPES } from '#src/access-intent/bash/redirect-analysis';
import { ShellVariables } from '#src/access-intent/bash/shell-variable-expansion';
import { COMMAND_PREFIX_TYPES, extractCommandWord } from '#src/access-intent/bash/token-collection';
import type { PathNormalizer } from '#src/path/path-normalizer';

/** One command unit of a bash program, such as each side of `a && b`. */
export type BashUnit = {
	text: string;
	/** Other spellings the shell runs identically, such as `~` spelled out. */
	spellings: readonly string[];
	/** Set for `bash -c`, `eval`, `sudo`, `env`, `xargs`, `find -exec`, and similar. */
	wrapper: boolean;
	/** Set when the unit came from, or sits under, text the parser could not resolve. */
	unparsed: boolean;
	/** Set when the analysis proves the unit only reads, whatever its arguments. */
	readOnly: boolean;
	/** Set for a recognized network client. */
	network?: { destination?: string };
};

/** A path the command accesses, with the direction the analysis proved. */
export type BashPath = { access: 'read' | 'write'; path: AccessPath };

/** What the gate needs to know about one bash command. */
export type BashAnalysis = {
	units: BashUnit[];
	paths: BashPath[];
	/** Set when a non-empty command yielded no unit from the primary parse. */
	unparsed: boolean;
};

/**
 * Commands that open network connections. They are never read-only, so they
 * always ask; naming them lets the request say `network` and show the host.
 */
const NETWORK_COMMANDS = new Set([
	'curl',
	'wget',
	'ssh',
	'scp',
	'sftp',
	'rsync',
	'nc',
	'ncat',
	'netcat',
	'telnet',
	'ftp'
]);
const NETWORK_GIT_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote']);

/** Parse a command once and describe every unit and path in it. */
export async function analyzeBash(command: string, normalizer: PathNormalizer): Promise<BashAnalysis> {
	const program = await BashProgram.parse(command, normalizer);
	const commands = program.commands();
	const meaningful = command.split('\n').some((line) => !/^\s*(?:#|$)/.test(line));
	const units = await Promise.all(
		commands.map(async (unit) => {
			const wrapper = unit.wrapperKind !== undefined;
			const unparsed = unit.parseUnresolved === true || unit.salvaged === true;
			const words = await inspectUnit(unit.text);
			return {
				text: unit.text,
				spellings: unit.spellings ?? [],
				wrapper,
				unparsed,
				readOnly: !wrapper && !unparsed && words !== undefined && isCoreReader(words),
				...(words && networkOf(words))
			};
		})
	);
	const paths = new Map<string, BashPath>();
	const add = (access: BashPath['access'], path: AccessPath): void => {
		paths.set(`${access}\0${path.value()}\0${path.boundaryValue()}`, { access, path });
	};
	for (const { path, effect } of [...program.pathRuleCandidates(), ...program.externalAccesses()]) {
		// An unproven effect consults both directions, as upstream's gates do.
		if (effect.effect !== 'write') add('read', path);
		if (effect.effect !== 'read') add('write', path);
	}
	return {
		units,
		paths: paths.values().toArray(),
		unparsed: meaningful && commands.every((unit) => unit.salvaged === true)
	};
}

type UnitWords = { head: string; args: ArgWord[] };

/**
 * Re-parse one unit's text and read its head word and arguments. Returns
 * `undefined` unless the text is a single simple command with no redirect, so
 * pipelines, subshells, and redirected statements never count as read-only.
 */
async function inspectUnit(text: string): Promise<UnitWords | undefined> {
	const parser = await getParser();
	const tree = parser.parse(text);
	if (!tree) return undefined;
	try {
		const root = tree.rootNode;
		const named = [];
		for (let index = 0; index < root.childCount; index++) {
			const child = root.child(index);
			if (child?.isNamed) named.push(child);
		}
		const node = named[0];
		if (root.hasError || named.length !== 1 || node?.type !== 'command') return undefined;
		const words = new WordReader(ShellVariables.scan([root]));
		const head = extractCommandWord(node, words);
		if (head === undefined) return undefined;
		const args: ArgWord[] = [];
		for (let index = 0; index < node.childCount; index++) {
			const child = node.child(index);
			if (!child?.isNamed || COMMAND_PREFIX_TYPES.has(child.type)) continue;
			if (REDIRECT_NODE_TYPES.has(child.type)) return undefined;
			args.push(words.argWord(child));
		}
		return { head, args };
	} finally {
		tree.delete();
	}
}

/** Whether the vendored pure-reader core proves the command reads only. */
function isCoreReader({ head, args }: UnitWords): boolean {
	const effect = proveCommandEffect(head, args);
	return effect.effect === 'read' && effect.source === 'core';
}

function networkOf({ head, args }: UnitWords): Pick<BashUnit, 'network'> | undefined {
	const values = args.map((arg) => arg.value);
	const isGitNetwork = head === 'git' && values.some((value) => NETWORK_GIT_SUBCOMMANDS.has(value));
	if (!isGitNetwork && !NETWORK_COMMANDS.has(head)) return undefined;
	const destination = values.map((value) => hostOf(value)).find((host) => host !== undefined);
	return { network: destination ? { destination } : {} };
}

/** The host named by a URL or an `ssh`-style `user@host` or `host:path` operand. */
function hostOf(value: string): string | undefined {
	if (/^[a-z][\d+.a-z-]*:\/\//i.test(value)) {
		try {
			return new URL(value).host || undefined;
		} catch {
			return undefined;
		}
	}
	if (value.startsWith('-')) return undefined;
	const remote = /^(?:[^\s/@]+@)?([\w.-]+\.[a-z]{2,}|[\w.-]+(?=:))/i.exec(value);
	return value.includes('@') || value.includes(':') ? remote?.[1] : undefined;
}
