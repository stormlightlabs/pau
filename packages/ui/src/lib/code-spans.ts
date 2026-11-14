/** One run of a message: plain text, or a name the message quoted in backticks. */
export type CodeSpan = { text: string; code: boolean };

/**
 * Splits a backend message into plain text and the commands, paths, and
 * package names it quotes in backticks, so a view can set those as code
 * instead of showing the backticks. An unpaired backtick stays as text.
 */
export function codeSpans(message: string): CodeSpan[] {
	const parts = message.split('`');
	// An even number of parts means the last backtick has no partner.
	const unpaired = parts.length % 2 === 0 ? parts.pop() : undefined;
	const spans: CodeSpan[] = parts.map((text, index) => ({ text, code: index % 2 === 1 }));
	if (unpaired !== undefined) spans.push({ text: `\`${unpaired}`, code: false });
	return spans.filter((span) => span.text !== '');
}

/** The message with its backticks removed, for places that show plain text only. */
export function withoutCodeMarks(message: string): string {
	return codeSpans(message)
		.map((span) => span.text)
		.join('');
}
