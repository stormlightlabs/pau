import { Lexer, type Token } from 'marked';

/** A top-level Markdown block as produced by the lexer. */
export type MarkdownBlockToken = Token;

/**
 * Lexes Markdown into top-level blocks, reusing the previous result's token
 * objects for blocks whose source did not change.
 *
 * A streaming message grows at its tail, so every block before the last one
 * keeps its identity and the renderer only updates the block still receiving
 * text. Lexing is the only per-update cost and is linear in the message size.
 * The lexer never produces HTML: raw HTML stays a token and the renderer
 * shows it as text.
 */
export function parseMarkdown(text: string, previous: readonly MarkdownBlockToken[] = []): MarkdownBlockToken[] {
	const blocks = new Lexer({ gfm: true }).lex(text).filter((token) => token.type !== 'space');
	return blocks.map((block, index) => {
		const old = previous[index];
		return old && old.type === block.type && old.raw === block.raw ? old : block;
	});
}

const safeProtocols = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns the link target when it is an absolute http, https, or mailto URL,
 * and `undefined` for anything else, including `javascript:` and relative
 * links the agent cannot resolve.
 */
export function safeHref(href: string): string | undefined {
	try {
		return safeProtocols.has(new URL(href).protocol) ? href : undefined;
	} catch {
		return undefined;
	}
}
