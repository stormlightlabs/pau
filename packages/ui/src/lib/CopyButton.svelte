<script lang="ts">
	import { onDestroy } from 'svelte';
	import '../styles/tokens.css';
	import { copyText, type CopyResult } from './clipboard';

	type Props = {
		/** Text to copy. It is read when the button is pressed, so streaming text copies in full. */
		text: string;
		/** Accessible name, such as "Copy code". */
		label?: string;
		/** Called with the outcome so a host can announce it. */
		onResult?: (result: CopyResult) => void;
		class?: string;
	};

	let { text, label = 'Copy', onResult, class: className = '' }: Props = $props();

	/** How long "Copied" or the error stays on the button. */
	const feedbackMs = 1500;
	let result = $state<CopyResult>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		result = await copyText(text);
		onResult?.(result);
		clearTimeout(timer);
		timer = setTimeout(() => (result = undefined), feedbackMs);
	}

	onDestroy(() => clearTimeout(timer));
</script>

<button
	type="button"
	class={[
		'copy-button',
		'pau-utility-button',
		className,
		result && (result.ok ? 'copy-button--copied' : 'copy-button--failed')
	]}
	aria-label={label}
	onclick={() => void copy()}>
	{result ? (result.ok ? 'Copied' : 'Copy failed') : 'Copy'}
</button>
<span class="pau-visually-hidden" role="status">{result && !result.ok ? result.error : ''}</span>

<style>
	.copy-button {
		padding: var(--pau-space-1) var(--pau-space-2);
		border: var(--pau-border-thin) solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		background-color: var(--pau-surface-raised);
		font: inherit;
		font-size: var(--pau-type-xs);
		cursor: pointer;
	}

	.copy-button:focus-visible {
		color: var(--pau-text);
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	/* The result color outranks the shared hover and press text color. */
	.copy-button.copy-button--copied,
	.copy-button.copy-button--copied:is(:hover, :active) {
		border-color: var(--pau-success);
		color: var(--pau-success);
	}

	.copy-button.copy-button--failed,
	.copy-button.copy-button--failed:is(:hover, :active) {
		border-color: var(--pau-danger);
		color: var(--pau-danger);
	}

	:global(:root[data-motion='reduce']) .copy-button {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .copy-button {
			transition: none;
		}
	}
</style>
