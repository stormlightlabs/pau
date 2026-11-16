import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import ApplicationShellDemo from './ApplicationShellDemo.svelte';

const meta = {
	title: 'Shell/Application shell',
	component: ApplicationShellDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: {
		theme: { control: 'select', options: ['eldritch', 'nord', 'iceberg', 'catppuccin-mocha', 'vitesse-dark'] },
		uiFont: {
			control: 'select',
			options: ['overpass', 'ibm-plex-sans', 'inter', 'atkinson-hyperlegible-next', 'atkinson-hyperlegible-soft']
		}
	},
	args: {
		disconnected: false,
		withWorkspace: true,
		longContent: false,
		paneWidths: { contextRail: null, inspector: null }
	}
} satisfies Meta<typeof ApplicationShellDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewRow: Story = {
	play: async ({ canvasElement }) => {
		const views = within(canvasElement.querySelector<HTMLElement>('nav[aria-label="Views"]')!);
		const sessions = views.getByRole('link', { name: 'Sessions' });

		await expect(sessions).toHaveAttribute('href', '#sessions');
		await expect(sessions).toHaveAttribute('aria-current', 'page');
		await expect(views.getAllByRole('listitem')).toHaveLength(6);
		await expect(views.getByRole('button', { name: 'Terminal' })).toHaveAccessibleDescription(
			'Terminal Open a workspace first'
		);
		await expect(views.getByRole('button', { name: 'Review' })).toHaveAccessibleDescription('Review Coming soon');
		await expect(views.getByRole('link', { name: 'Settings' })).toHaveAccessibleDescription('Settings ⌘,');
	}
};

export const Nord: Story = { args: { theme: 'nord' } };

export const Iceberg: Story = { args: { theme: 'iceberg' } };

export const CatppuccinMocha: Story = { args: { theme: 'catppuccin-mocha' } };

export const VitesseDark: Story = { args: { theme: 'vitesse-dark' } };

export const AtkinsonHyperlegibleSoft: Story = { args: { uiFont: 'atkinson-hyperlegible-soft' } };

export const WithoutWorkspaceColumn: Story = { args: { withWorkspace: false } };

export const LongContent: Story = { args: { longContent: true } };

export const Disconnected: Story = {
	args: { disconnected: true },
	play: async ({ canvasElement }) => {
		const views = within(canvasElement.querySelector<HTMLElement>('nav[aria-label="Views"]')!);
		await expect(views.getByRole('status')).toHaveTextContent('Disconnected');
	}
};

export const NarrowOverlay: Story = {
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole('complementary', { name: 'Checks' })).toBeNull();
		const toggle = canvas.getByRole('button', { name: 'Show checks' });
		await userEvent.click(toggle);
		const overlay = canvas.getByRole('complementary', { name: 'Checks' });
		await expect(overlay).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		await expect(canvas.queryByRole('complementary', { name: 'Checks' })).toBeNull();
		await expect(toggle).toHaveFocus();
	}
};

const wide = { viewport: { defaultViewport: 'wide' } };

export const ResizeByKeyboard: Story = {
	parameters: wide,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize the session bay' });
		const before = Number(separator.getAttribute('aria-valuenow'));

		separator.focus();
		await userEvent.keyboard('{ArrowRight}');
		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', String(before + 16)));
		await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', String(before - 48)));
	}
};

export const DragToResize: Story = {
	parameters: wide,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize the checks column' });
		const before = Number(separator.getAttribute('aria-valuenow'));
		const { x, y, width, height } = separator.getBoundingClientRect();
		const start = { clientX: x + width / 2, clientY: y + height / 2 };

		await userEvent.pointer([
			{ keys: '[MouseLeft>]', target: separator, coords: start },
			{ coords: { clientX: start.clientX - 40, clientY: start.clientY } },
			{ keys: '[/MouseLeft]' }
		]);
		await waitFor(() =>
			expect(canvas.getByRole('separator', { name: 'Resize the checks column' })).toHaveAttribute(
				'aria-valuenow',
				String(before + 40)
			)
		);
	}
};

export const ResetToDefaultWidth: Story = {
	parameters: wide,
	args: { paneWidths: { contextRail: 400, inspector: 400 } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize the session bay' });

		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', '400'));
		await userEvent.dblClick(separator);
		await waitFor(() => expect(separator).not.toHaveAttribute('aria-valuenow', '400'));
		await expect(canvas.getByLabelText('Saved pane widths')).toHaveTextContent('"contextRail":null');
	}
};

export const MinimumWidth: Story = {
	parameters: wide,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize the session bay' });

		separator.focus();
		for (let press = 0; press < 8; press += 1) await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', '288'));
	}
};

export const MainSurfaceKeepsItsWidth: Story = {
	parameters: wide,
	args: { paneWidths: { contextRail: 2000, inspector: 2000 } },
	play: async ({ canvasElement }) => {
		const main = canvasElement.querySelector<HTMLElement>('#main-surface')!;

		await expect(main.getBoundingClientRect().width).toBeGreaterThanOrEqual(383);
	}
};
