import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
	{
		ignores: [
			'**/.svelte-kit/**',
			'**/build/**',
			'**/node_modules/**',
			'**/storybook-static/**',
			'packages/claude-bridge/**',
			'packages/protocol/src/generated.ts'
		]
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	unicorn.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'no-undef': 'off',
			'unicorn/prefer-ternary': 'off',
			'unicorn/catch-error-name': 'off',
			'unicorn/consistent-boolean-name': 'off',
			'unicorn/filename-case': 'off',
			'unicorn/import-style': 'off',
			'unicorn/name-replacements': 'off',
			'unicorn/no-array-sort': 'off',
			'unicorn/no-negated-condition': 'off',
			'unicorn/no-null': 'off',
			'unicorn/prefer-query-selector': 'off',
			'unicorn/prefer-string-replace-all': 'off',
			'unicorn/prefer-top-level-await': 'off',
			'unicorn/prevent-abbreviations': 'off',
			'unicorn/single-line-block-comment-style': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser } },
		rules: { 'unicorn/no-top-level-assignment-in-function': 'off' }
	}
);
