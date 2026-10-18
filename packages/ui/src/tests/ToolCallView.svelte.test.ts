import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { toolCallFixtures } from '../fixtures/tool-calls';
import ToolCallViewDemo from '../stories/ToolCallViewDemo.svelte';

test('shows a bash command, its output, exit code, and duration', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.bashComplete] });

	await expect.element(page.getByLabelText('Command', { exact: true })).toHaveTextContent('$ git status --short');
	await expect.element(page.getByLabelText('Command output')).toHaveTextContent('?? src/diff/wrap.test.ts');
	await expect.element(page.getByText('Exit 0')).toBeVisible();
	await expect.element(page.getByText('84 ms')).toBeVisible();
});

test('streams a running command without an exit code', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.bashRunning] });

	await expect.element(page.getByText('In progress')).toBeVisible();
	await expect.element(page.getByLabelText('Command output')).toHaveTextContent('gutter.test.ts');
	await expect.element(page.getByText(/^Exit/)).not.toBeInTheDocument();
});

test('marks a failed command and an edit that did not apply', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.bashFailed, toolCallFixtures.editFailed] });

	await expect.element(page.getByText('Failed').first()).toBeVisible();
	await expect.element(page.getByText('Exit 101')).toBeVisible();
	await expect.element(page.getByLabelText('Error')).toHaveTextContent('Could not find the exact text');
});

test('caps oversized output and reveals earlier lines on request', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.bashTruncated] });
	const output = page.getByLabelText('Command output');

	await expect.element(page.getByText(/Pi kept the last 1200 of 4800 lines/)).toBeVisible();
	await expect.element(page.getByText('/tmp/pi-bash-7f3a.log')).toBeVisible();
	expect(output.element().textContent?.split('\n')).toHaveLength(200);
	await expect.element(output).toHaveTextContent('test 1200 ... ok');

	await userEvent.click(page.getByRole('button', { name: 'Show 200 earlier lines' }));
	expect(output.element().textContent?.split('\n')).toHaveLength(400);
	await expect.element(output).toHaveTextContent('test 801 ... ok');
});

test('shows a read range and its file contents', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.read] });

	await expect.element(page.getByText('src/diff/gutter.ts')).toBeVisible();
	await expect.element(page.getByLabelText('Contents of src/diff/gutter.ts')).toHaveTextContent('gutterRows');
});

test('colors added and removed lines in an edit diff', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.edit, toolCallFixtures.editRunning] });

	await expect.element(page.getByText('-2 Old intro')).toHaveClass('tool-output__line--removed');
	await expect.element(page.getByText('+2 New intro')).toHaveClass('tool-output__line--added');
	await expect.element(page.getByText('+return visualLineOffsets(view);')).toHaveClass('tool-output__line--added');
});

test('previews the content of a write', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.write] });

	await expect.element(page.getByLabelText('New contents of src/diff/wrap.test.ts')).toHaveTextContent('wraps folded');
});

test('falls back to text for a tool without structured data', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.extension] });

	await expect.element(page.getByText('{"action":"add","text":"Cover folded ranges"}')).toBeVisible();
	await expect.element(page.getByLabelText('todo output')).toHaveTextContent('Added todo #3: Cover folded ranges');
});

test('renders a collapsed row without its body until opened', async () => {
	await render(ToolCallViewDemo, { tools: [toolCallFixtures.edit], initiallyOpen: false });

	await expect.element(page.getByLabelText('Diff for README.md')).not.toBeInTheDocument();
	await userEvent.click(page.getByText('README.md'));
	await expect.element(page.getByLabelText('Diff for README.md')).toBeVisible();
});
