import type { Meta, StoryObj } from '@storybook/svelte-vite';

import TokensDemo from './TokensDemo.svelte';

const meta = { title: 'Foundation/Tokens', component: TokensDemo, parameters: { layout: 'fullscreen' } } satisfies Meta<
	typeof TokensDemo
>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Eldritch, the default theme. */
export const Eldritch: Story = { globals: { theme: 'eldritch' } };
export const Nord: Story = { globals: { theme: 'nord' } };
export const Iceberg: Story = { globals: { theme: 'iceberg' } };
export const CatppuccinMocha: Story = { globals: { theme: 'catppuccin-mocha' } };
export const VitesseDark: Story = { globals: { theme: 'vitesse-dark' } };
