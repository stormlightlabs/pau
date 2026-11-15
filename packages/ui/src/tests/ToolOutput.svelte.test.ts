import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ToolOutput from '../lib/ToolOutput.svelte';

/** Characters the DOM gains or rewrites while `update` runs inside `root`. */
async function writtenDuring(root: Element, update: () => Promise<unknown>) {
	const records: MutationRecord[] = [];
	const observer = new MutationObserver((batch) => {
		records.push(...batch);
	});
	observer.observe(root, { subtree: true, childList: true, characterData: true });
	await update();
	records.push(...observer.takeRecords());
	observer.disconnect();
	let written = 0;
	for (const record of records) {
		if (record.type === 'characterData') written += record.target.textContent!.length;
		for (const node of record.addedNodes) written += node.textContent!.length;
	}
	return written;
}

const streamed = (count: number) => Array.from({ length: count }, (_, index) => `test case ${index + 1} ... ok`);

for (const diff of [false, true]) {
	test(`rewrites only the newest lines of an opened ${diff ? 'diff' : 'output'} as it streams`, async () => {
		let lines = streamed(5000);
		const screen = await render(ToolOutput, { lines, label: 'Command output', from: 'tail', diff });
		await userEvent.click(page.getByRole('button', { name: 'Show all 5,000 lines' }));
		const output = page.getByLabelText('Command output').element();
		const total = output.textContent!.length;

		for (let step = 0; step < 3; step++) {
			lines = [...lines, `test case streamed ${step} ... ok`];
			const written = await writtenDuring(output, () => screen.rerender({ lines }));
			expect(written).toBeGreaterThan(0);
			expect(written).toBeLessThan(total / 10);
		}
		await expect.element(page.getByText('All 5,003 lines')).toBeVisible();
		expect(output.textContent).toContain('test case streamed 2 ... ok');
		expect(output.textContent).toContain('test case 1 ... ok');
	});
}
