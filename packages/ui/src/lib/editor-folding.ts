import { foldNodeProp, Language, LanguageSupport } from '@codemirror/language';

/** Turns off folding for Markdown paragraphs, which CodeMirror folds by default. */
const paragraphsDoNotFold = foldNodeProp.add({ Paragraph: () => null });

/** The part of `@lezer/markdown`'s parser that this module uses. */
type MarkdownParser = Language['parser'] & {
	configure(extension: { props: (typeof paragraphsDoNotFold)[] }): Language['parser'];
};

/**
 * Limits Markdown fold markers to blocks that hold a section of the document:
 * headings, list items, quotes, code blocks, and tables. CodeMirror's Markdown
 * support also folds every paragraph that spans more than one line, which puts
 * a chevron beside most prose and hides the markers that matter. Other
 * languages pass through unchanged.
 */
export function sectionFolding(support: LanguageSupport): LanguageSupport {
	const { language } = support;
	if (language.name !== 'markdown') return support;
	const parser = (language.parser as MarkdownParser).configure({ props: [paragraphsDoNotFold] });
	return new LanguageSupport(new Language(language.data, parser, [], language.name), support.support);
}
