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
		inspectorOpen: true,
		longContent: false,
		theme: 'eldritch',
		uiFont: 'inter',
		paneWidths: { contextRail: null, inspector: null }
	}
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

export const RailNavigation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const sessions = canvas.getByRole('link', { name: 'Sessions' });

		await expect(sessions).toHaveAttribute('href', '#sessions');
		await expect(sessions).toHaveAttribute('aria-current', 'page');
		await expect(canvas.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '#files');
		await expect(canvas.getByRole('button', { name: 'Terminal' })).toHaveAccessibleDescription(
			'Open a workspace first'
		);
	}
};

export const ComingSoon: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const settings = canvas.getByRole('button', { name: 'Settings' });

		await expect(settings).toHaveAttribute('aria-disabled', 'true');
		await expect(settings).toHaveAccessibleDescription('Coming soon');
		await expect(canvas.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
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

/** Counts the running transform transitions on an element. */
function transformTransitions(element: Element): number {
	return element
		.getAnimations()
		.filter((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'transform').length;
}

export const NarrowRailWithReducedMotion: Story = {
	globals: { reducedMotion: 'on' },
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		await expect(document.documentElement.dataset.motion).toBe('reduce');
		const rail = canvasElement.querySelector('#shell-context-rail')!;
		// The decorator switches the attribute after first render; let that settle before opening.
		await Promise.all(rail.getAnimations().map((animation) => animation.finished));
		const closed = getComputedStyle(rail).transform;
		await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open navigation' }));
		await expect(rail).toHaveClass('open');
		await expect(getComputedStyle(rail).transform).toBe(closed);
		await expect(transformTransitions(rail)).toBe(0);
	}
};

export const NarrowRailWithFullMotion: Story = {
	globals: { reducedMotion: 'off' },
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		await expect(document.documentElement.dataset.motion).toBe('full');
		const rail = canvasElement.querySelector('#shell-context-rail')!;
		await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open navigation' }));
		await waitFor(() => expect(transformTransitions(rail)).toBeGreaterThan(0));
	}
};

const wide = { viewport: { defaultViewport: 'wide' } };

export const ResizeByKeyboard: Story = {
	parameters: wide,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize workspaces' });
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
		const separator = canvas.getByRole('separator', { name: 'Resize inspector' });
		const before = Number(separator.getAttribute('aria-valuenow'));
		const { x, y, width, height } = separator.getBoundingClientRect();
		const start = { clientX: x + width / 2, clientY: y + height / 2 };

		await userEvent.pointer([
			{ keys: '[MouseLeft>]', target: separator, coords: start },
			{ coords: { clientX: start.clientX - 40, clientY: start.clientY } },
			{ keys: '[/MouseLeft]' }
		]);
		await waitFor(() =>
			expect(canvas.getByRole('separator', { name: 'Resize inspector' })).toHaveAttribute(
				'aria-valuenow',
				String(before + 40)
			)
		);
	}
};

export const ResetToDefaultWidth: Story = {
	parameters: wide,
	args: { paneWidths: { contextRail: 320, inspector: 400 } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize workspaces' });

		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', '320'));
		await userEvent.dblClick(separator);
		await waitFor(() => expect(separator).not.toHaveAttribute('aria-valuenow', '320'));
		await expect(canvas.getByLabelText('Saved pane widths')).toHaveTextContent('"contextRail":null');
	}
};

export const MinimumWidth: Story = {
	parameters: wide,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const separator = canvas.getByRole('separator', { name: 'Resize workspaces' });

		separator.focus();
		for (let press = 0; press < 8; press += 1) await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
		await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', '160'));
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
