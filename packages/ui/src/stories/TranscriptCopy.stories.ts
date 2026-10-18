import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { sessionFixtures } from '../fixtures/sessions';
import type { SessionWorkspace } from '../lib/types/session';
import SessionViewDemo from './SessionViewDemo.svelte';

const reply = 'Gutter rows now follow **visual** offsets.\n\n```ts\nconst width = measure(row);\n```';
const base = sessionFixtures.running[0]!;
const workspaces: SessionWorkspace[] = [
	{
		...base,
		sessions: [
			{
				...base.sessions[0]!,
				id: 'session-copy',
				transcript: [
					{ id: 'user-1', kind: 'message', role: 'user', body: 'Fix the **wrapped** gutter.' },
					{ id: 'answer-1', kind: 'message', role: 'assistant', body: reply }
				]
			}
		]
	}
];

const meta = {
	title: 'Sessions/Transcript copy',
	component: SessionViewDemo,
	parameters: { layout: 'fullscreen' },
	args: { workspaces, initialSessionId: 'session-copy' }
} satisfies Meta<typeof SessionViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Replaces the clipboard for a story and returns the text written to it. */
function stubClipboard(fail = false): string[] {
	const written: string[] = [];
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				if (fail) throw new Error('denied');
				written.push(text);
			}
		}
	});
	return written;
}

export const CopyMessage: Story = {
	play: async ({ canvasElement }) => {
		const written = stubClipboard();
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Copy reply' }));
		await expect(written[0]).toBe(reply);
		await expect(canvas.getByRole('button', { name: 'Copy reply' })).toHaveTextContent('Copied');
		await userEvent.click(canvas.getByRole('button', { name: 'Copy your message' }));
		await expect(written[1]).toBe('Fix the **wrapped** gutter.');
	}
};

export const CopyCodeBlock: Story = {
	play: async ({ canvasElement }) => {
		const written = stubClipboard();
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Copy code' }));
		await expect(written[0]).toBe('const width = measure(row);');
	}
};

export const ClipboardFailure: Story = {
	play: async ({ canvasElement }) => {
		stubClipboard(true);
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Copy reply' }));
		await expect(canvas.getByRole('button', { name: 'Copy reply' })).toHaveTextContent('Copy failed');
		await expect(canvasElement.querySelector('.session-view__announcer')).toHaveTextContent(
			'The clipboard refused the copy.'
		);
	}
};
