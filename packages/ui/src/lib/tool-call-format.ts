import type { ReadToolCall, ToolTruncation, TranscriptTool } from './types/session';

/**
 * Lines a tool output block shows before it offers Show all. A long result
 * would otherwise push the agent's answer screens away from the prompt.
 */
export const toolOutputLineCap = 12;

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

function lineCount(count: number): string {
	return count === 1 ? '1 line' : `${count} lines`;
}

/**
 * Summarizes what a finished call returned for the right column of its row:
 * the lines a read or write covered, an edit's added and removed lines, or the
 * last line a command printed, which is usually its verdict, such as
 * "38 passed". Other tools show a one-line result as is and a longer one as a
 * line count, since their last line is often just the end of a JSON value.
 */
export function resultSummary(tool: TranscriptTool): string {
	const call = tool.call;
	const lines = outputLines(tool.result ?? '');
	if (call?.tool === 'read') {
		const truncation = call.truncation;
		return truncation ? `${truncation.outputLines} of ${lineCount(truncation.totalLines)}` : lineCount(lines.length);
	}
	if (call?.tool === 'write') return lineCount(outputLines(call.content).length);
	if (call?.tool === 'edit') {
		if (!call.diff) return call.edits.length === 1 ? '1 edit' : `${call.edits.length} edits`;
		const kinds = outputLines(call.diff).map((line) => diffLineKind(line));
		const added = kinds.filter((kind) => kind === 'added').length;
		const removed = kinds.filter((kind) => kind === 'removed').length;
		return `+${added} −${removed}`;
	}
	const printed = lines.map((line) => line.trim()).filter((line) => line !== '');
	if (printed.length === 0) return 'No output';
	if (call?.tool === 'bash' || printed.length === 1) return printed.at(-1)!;
	return lineCount(lines.length);
}
