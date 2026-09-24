import adapter from '@sveltejs/adapter-static';
import { mdsvex } from 'mdsvex';
import { createHighlighter } from 'shiki';

const highlighter = await createHighlighter({ langs: ['bash', 'rust', 'text', 'typescript'], themes: ['nord'] });

export default {
	extensions: ['.svelte', '.svx'],
	preprocess: [
		mdsvex({
			extensions: ['.svx'],
			highlight: {
				highlighter: (code, lang = 'text') =>
					highlighter.codeToHtml(code, { lang, theme: 'nord' }).replace(' tabindex="0"', '')
			}
		})
	],
	kit: { adapter: adapter() }
};
