/** Markdown that assistant messages commonly contain, for stories and tests. */
export const markdownFixtures = {
	headings: '# Findings\n\n## Cause\n\nThe gutter ignores wrapped lines.\n\n### Fix\n\nMeasure each wrapped row.',
	lists:
		'- Read `gutter.ts`\n- Update the width calculation\n  - Keep the minimum width\n\n1. Run the tests\n2. Commit\n\n- [x] Reproduce\n- [ ] Verify',
	code: [
		'Run it:',
		'',
		'```ts',
		'export function width(rows: number): number {',
		'\treturn Math.max(rows.toString().length, 2);',
		'}',
		'```',
		'',
		'```',
		'plain output <b>not html</b>',
		'```'
	].join('\n'),
	longCode: [
		'```ts',
		...Array.from(
			{ length: 40 },
			(_, line) =>
				`const value${line} = computeSomethingWithAVeryLongName(${line}, 'argument-${line}', 'another-long-argument-value', 'and-one-more-argument-value');`
		),
		'```'
	].join('\n'),
	links: 'Read [the docs](https://example.com/docs) or [run this](javascript:alert(1)) or [local](./file.md).',
	table: '| Tool | Calls |\n| :--- | ---: |\n| read | 12 |\n| edit | 3 |',
	html: 'Before <b>bold</b> <script>alert(1)</script> after\n\n<div onclick="alert(1)">block</div>\n\n![pixel](https://example.com/x.png)',
	streaming: 'Here is the plan:\n\n1. Read the file\n2. Edit `gutter.ts`\n\n```ts\nconst width = measure(',
	quote: '> Measure first.\n\nThen change it.'
};
