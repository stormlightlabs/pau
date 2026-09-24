import type { UserConfig } from '@unocss/core';
import presetIcons from '@unocss/preset-icons';

const config = {
	presets: [
		presetIcons({
			extraProperties: { display: 'inline-block', 'flex-shrink': '0', 'vertical-align': '-0.125em' },
			warn: true
		})
	]
} satisfies UserConfig;

export default config;
