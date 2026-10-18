<script lang="ts">
	import '../styles/tokens.css';
	import Markdown from '../lib/Markdown.svelte';
	import { themeCssProperties, type ThemeName } from '../theme';

	let { text, theme = 'eldritch' }: { text: string; theme?: ThemeName } = $props();

	const style = $derived(
		Object.entries(themeCssProperties(theme, 'inter'))
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);
</script>

<div class="markdown-demo" data-theme={theme} {style}>
	<Markdown {text} />
</div>

<style>
	.markdown-demo {
		max-width: 75ch;
		padding: var(--pau-space-4);
		background: var(--pau-canvas);
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}
</style>
