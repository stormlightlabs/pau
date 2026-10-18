import type { ReadToolCall, ToolTruncation } from './types/session';

/**
 * Lines a tool output block renders before it offers "show more". Pi can
 * return thousands of lines, and the transcript re-renders while a call
 * streams, so each reveal adds this many lines rather than the whole output.
 */
export const toolOutputLineStep = 200;

/** Line kinds in Pi's display diff, read from each line's first character. */
export type DiffLineKind = 'added' | 'removed' | 'context';

/** One window of a long output, with the number of lines left out of it. */
export type OutputWindow = { lines: string[]; hidden: number };

/**
 * Splits text into lines and keeps `shown` of them. Bash output keeps its
 * tail because the latest lines matter while a command runs; file content
 * keeps its head so it reads from the top.
 */
export function outputWindow(lines: string[], shown: number, from: 'head' | 'tail'): OutputWindow {
	if (lines.length <= shown) return { lines, hidden: 0 };
	const kept = from === 'head' ? lines.slice(0, shown) : lines.slice(lines.length - shown);
	return { lines: kept, hidden: lines.length - shown };
}

/** Splits output into lines, dropping the single trailing newline most tools print. */
export function outputLines(text: string): string[] {
	if (text === '') return [];
	return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

/** Classifies a line of Pi's display diff by its `+`, `-`, or space marker. */
export function diffLineKind(line: string): DiffLineKind {
	if (line.startsWith('+')) return 'added';
	if (line.startsWith('-')) return 'removed';
	return 'context';
}

/** Formats a run time for the bash footer: `320 ms`, `4.2 s`, or `2 min 5 s`. */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Describes the lines a `read` call asked for, or undefined for the whole file. */
export function readRange(call: ReadToolCall): string | undefined {
	const start = call.offset ?? 1;
	if (call.limit !== undefined) return `lines ${start}–${start + call.limit - 1}`;
	if (call.offset !== undefined) return `from line ${start}`;
	return undefined;
}

/** Explains how much of a long output the tool kept. */
export function truncationNotice(truncation: ToolTruncation, kept: 'first' | 'last'): string {
	const limit = truncation.truncatedBy === 'bytes' ? 'the size limit' : 'the line limit';
	return `Pi kept the ${kept} ${truncation.outputLines} of ${truncation.totalLines} lines because of ${limit}.`;
}
