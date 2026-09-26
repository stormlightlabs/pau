import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';

const meta = {
	title: 'Diagnostics/Release diagnostics',
	component: DiagnosticsView,
	parameters: { layout: 'fullscreen' },
	args: { bundle: diagnosticFixtures.active }
} satisfies Meta<typeof DiagnosticsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Review bundle' }));
		await expect(canvas.getByText('Bundle revision 48')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Export reviewed bundle' })).toBeEnabled();
	}
};

export const Disabled: Story = { args: { bundle: diagnosticFixtures.disabled } };

export const PayloadTracing: Story = {
	args: {
		bundle: {
			...diagnosticFixtures.active,
			settings: { ...diagnosticFixtures.active.settings, payloadTracing: true, payloadTracingExpiresAt: 1_775_045_100 }
		}
	}
};

export const Narrow: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };
