import type { StorybookConfig } from '@storybook/svelte-vite';

const config = {
	stories: ['../src/**/*.stories.@(js|ts|svelte)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/svelte-vite', options: {} }
} satisfies StorybookConfig;

export default config;
