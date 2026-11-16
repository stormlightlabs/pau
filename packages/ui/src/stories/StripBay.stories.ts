import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { bayFixtures } from '../fixtures/bay';
import BayArrivalDemo from './BayArrivalDemo.svelte';
import SessionViewDemo from './SessionViewDemo.svelte';

const meta = {
	title: 'Sessions/Strip bay',
	component: SessionViewDemo,
	parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'wide' } },
	args: { workspaces: bayFixtures.busy, initialSessionId: 'sandbox-pi' }
} satisfies Meta<typeof SessionViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

const rack = (canvasElement: HTMLElement, name: string) =>
	within(canvasElement.querySelector<HTMLElement>(`section[aria-labelledby="bay-${CSS.escape(name)}"]`)!);

/** Fourteen sessions racked by what they need, with the open one waiting on a permission request. */
export const Waiting: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: 'Needs you 4' })).toBeVisible();
		await expect(canvas.getByRole('heading', { name: 'Running 4' })).toBeVisible();
		await expect(rack(canvasElement, 'needs').getAllByRole('button')).toHaveLength(4);
		await expect(canvas.getByRole('heading', { name: /Allow write to/ })).toBeVisible();
	}
};

/** A running session: the spinning mark, the live tool strip and the composer for steering. */
export const Running: Story = { args: { initialSessionId: 'audit-drain' } };

/** The open session failed, so Start again takes the composer's place. */
export const Failed: Story = { args: { workspaces: bayFixtures.failed } };

/** A long session title truncates in the header and the strip. */
export const LongContent: Story = { args: { initialSessionId: 'thndrs-readme' } };

/** No workspaces yet. */
export const Empty: Story = { args: { workspaces: [], initialSessionId: undefined, openable: true } };

/** The filter narrows every rack. */
export const Filtered: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox', { name: 'Filter sessions' }), 'audit');
		await waitFor(() => expect(canvas.getByRole('heading', { name: 'Running 2' })).toBeVisible());
		await expect(canvas.getByRole('heading', { name: 'Needs you 1' })).toBeVisible();
	}
};

/** Arrow keys step through the strips in rack order. */
export const KeyboardPath: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		canvas.getByRole('searchbox', { name: 'Filter sessions' }).focus();
		await userEvent.keyboard('{ArrowDown}');
		await expect(canvasElement.ownerDocument.activeElement).toHaveTextContent('Pi RPC timeout');
		await userEvent.keyboard('{ArrowDown}');
		await expect(canvasElement.ownerDocument.activeElement).toHaveTextContent('Terminal relay PTY');
	}
};

/** Below 1200px the bay narrows and the workspace column opens as an overlay from the header. */
export const Narrow: Story = {
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole('dialog', { name: 'Workspace' })).toBeNull();
		const toggle = canvas.getByRole('button', { name: 'Show workspace' });
		await userEvent.click(toggle);
		await expect(canvas.getByRole('dialog', { name: 'Workspace' })).toHaveFocus();
		await userEvent.keyboard('{Escape}');
		await expect(toggle).toHaveFocus();
	}
};

/** The arrival: Diff gutter numbers travels from Running to the top of Needs you. */
export const Arrival: StoryObj<typeof BayArrivalDemo> = {
	render: () => ({ Component: BayArrivalDemo }),
	globals: { reducedMotion: 'off' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Diff gutter numbers asks for you' }));
		const needs = rack(canvasElement, 'needs');
		await waitFor(() => expect(needs.getAllByRole('button')[0]).toHaveTextContent('Diff gutter numbers'));
	}
};

/** Under reduced motion the strip changes place at once and its band fades in. */
export const ArrivalReducedMotion: StoryObj<typeof BayArrivalDemo> = {
	render: () => ({ Component: BayArrivalDemo }),
	globals: { reducedMotion: 'on' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Diff gutter numbers asks for you' }));
		const strip = rack(canvasElement, 'needs').getAllByRole('button')[0]!;
		await expect(strip).toHaveTextContent('Diff gutter numbers');
		const moves = strip.getAnimations().filter((animation) => {
			const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
			return frames.some((frame) => 'transform' in frame);
		});
		await expect(moves).toHaveLength(0);
	}
};
