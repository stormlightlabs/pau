import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
	emptyResourceIndex,
	largeResourceIndex,
	resourceIndex,
	undecidedResourceIndex,
	untrustedResourceIndex
} from '../fixtures/resources';
import ResourceBrowser from '../lib/ResourceBrowser.svelte';

const meta = {
	title: 'Workspaces/Resource browser',
	component: ResourceBrowser,
	parameters: { layout: 'fullscreen' },
	args: { workspaceName: 'pau', kind: 'skill', kindHref: (kind) => `#${kind}s`, index: resourceIndex }
} satisfies Meta<typeof ResourceBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Skills: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const invalid = await canvas.findByRole('option', { name: /^broken-frontmatter/ });
		await userEvent.click(invalid);
		await expect(await canvas.findByText('Malformed frontmatter; skill not loaded.')).toBeInTheDocument();
	}
};

export const Prompts: Story = { args: { kind: 'prompt' } };

export const Extensions: Story = { args: { kind: 'extension' } };

export const Themes: Story = { args: { kind: 'theme' } };

export const Packages: Story = { args: { kind: 'package' } };

export const TrustNotDecided: Story = { args: { index: undecidedResourceIndex } };

export const Untrusted: Story = { args: { index: untrustedResourceIndex, kind: 'prompt' } };

export const Loading: Story = { args: { index: undefined } };

export const LoadError: Story = { args: { index: undefined, error: 'The local API stopped responding.' } };

export const Empty: Story = { args: { index: emptyResourceIndex } };

export const LargeIndex: Story = {
	args: { index: largeResourceIndex },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox', { name: 'Filter by name' }), 'skill-29');
		await expect(await canvas.findByText('10 of 300 skills')).toBeInTheDocument();
	}
};
