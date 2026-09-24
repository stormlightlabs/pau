import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import ApplicationShellDemo from './ApplicationShellDemo.svelte';

const meta = {
	title: 'Shell/Application shell',
	component: ApplicationShellDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: {
		theme: { control: 'select', options: ['eldritch', 'nord', 'iceberg', 'catppuccin-mocha', 'vitesse-dark'] },
		uiFont: {
			control: 'select',
			options: ['ibm-plex-sans', 'inter', 'atkinson-hyperlegible-next', 'atkinson-hyperlegible-soft']
		}
	},
	args: { disconnected: false, inspectorOpen: true, longContent: false, theme: 'eldritch', uiFont: 'inter' }
} satisfies Meta<typeof ApplicationShellDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RailsAndInspector: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const inspectorToggle = canvas.getByRole('button', { name: 'Hide inspector' });

		await userEvent.click(inspectorToggle);
		await expect(canvas.queryByRole('complementary', { name: 'Inspector' })).not.toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Show inspector' })).toHaveAttribute('aria-expanded', 'false');
	}
};

export const Nord: Story = { args: { theme: 'nord' } };

export const Iceberg: Story = { args: { theme: 'iceberg' } };

export const CatppuccinMocha: Story = { args: { theme: 'catppuccin-mocha' } };

export const VitesseDark: Story = { args: { theme: 'vitesse-dark' } };

export const AtkinsonHyperlegibleSoft: Story = { args: { uiFont: 'atkinson-hyperlegible-soft' } };

export const InspectorClosed: Story = { args: { inspectorOpen: false } };

export const LongContent: Story = { args: { longContent: true } };

export const Disconnected: Story = { args: { disconnected: true } };

export const NarrowLayout: Story = {
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const inspector = canvas.getByRole('complementary', { name: 'Inspector' });
		const navigationToggle = canvas.getByRole('button', { name: 'Open navigation' });

		await userEvent.click(within(inspector).getByRole('button', { name: 'Close inspector' }));
		await userEvent.click(navigationToggle);
		await expect(navigationToggle).toHaveAttribute('aria-expanded', 'true');
	}
};
