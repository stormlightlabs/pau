import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import DiffReview from '../lib/DiffReview.svelte';
import type { WorkspaceGitDiff } from '../lib/types/workspace-files';

function textDiff(): WorkspaceGitDiff {
	return {
		path: 'src/example.ts',
		previous_path: null,
		old_content: [
			'const removed = true;',
			...Array.from({ length: 10 }, (_, index) => `const context${index} = ${index};`),
			"const replacement = 'before';",
			...Array.from({ length: 10 }, (_, index) => `const later${index} = ${index};`),
			"const longLine = 'This old line is deliberately long so horizontal overflow and optional wrapping are both exercised.';"
		].join('\n'),
		new_content: [
			'const added = true;',
			'const secondAddition = true;',
			...Array.from({ length: 10 }, (_, index) => `const context${index} = ${index};`),
			"const replacement = 'after';",
			...Array.from({ length: 10 }, (_, index) => `const later${index} = ${index};`),
			"const longLine = 'This new line is deliberately long so horizontal overflow and optional wrapping are both exercised.';"
		].join('\n'),
		binary: false,
		too_large: false
	};
}

test('renders additions, deletions, replacements, and wrapped long lines', async () => {
	await render(DiffReview, { diff: textDiff() });

	await expect.element(page.getByLabelText('src/example.ts diff')).toBeInTheDocument();
	await expect.element(page.getByText('const removed = true;')).toBeInTheDocument();
	await expect.element(page.getByText('const secondAddition = true;')).toBeInTheDocument();
	await expect.element(page.getByText("const replacement = 'after';")).toBeInTheDocument();

	await userEvent.click(page.getByRole('checkbox', { name: 'Wrap lines' }));
	await expect.element(page.getByLabelText('src/example.ts diff')).toHaveClass(/cm-lineWrapping/);
});

test('navigates hunks with pointer and keyboard and records review state', async () => {
	const onReviewedHunksChange = vi.fn();
	await render(DiffReview, { diff: textDiff(), onReviewedHunksChange });
	await userEvent.click(page.getByRole('button', { name: 'Hunk' }));
	await expect.element(page.getByText('Hunk 1 of 3')).toBeInTheDocument();

	await userEvent.click(page.getByRole('button', { name: 'Next hunk' }));
	await expect.element(page.getByText('Hunk 2 of 3')).toBeInTheDocument();

	await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
	await expect.element(page.getByText('Hunk 3 of 3')).toBeInTheDocument();
	await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
	await expect.element(page.getByText('Hunk 2 of 3')).toBeInTheDocument();

	await userEvent.click(page.getByRole('button', { name: 'Mark reviewed' }));
	expect(onReviewedHunksChange).toHaveBeenLastCalledWith([1]);
	await expect.element(page.getByText('1 of 3 hunks reviewed')).toBeInTheDocument();
});

test('shows a binary-file notice instead of a text diff', async () => {
	await render(DiffReview, {
		diff: {
			path: 'assets/image.png',
			previous_path: null,
			old_content: null,
			new_content: null,
			binary: true,
			too_large: false
		}
	});

	await expect.element(page.getByRole('status')).toHaveTextContent('Binary file');
	await expect.element(page.getByText('Pau cannot display a text diff for this file.')).toBeInTheDocument();
});
