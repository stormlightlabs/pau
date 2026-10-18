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
	class={['copy-button', className, result && (result.ok ? 'copy-button--copied' : 'copy-button--failed')]}
	aria-label={label}
	onclick={() => void copy()}>
	{result ? (result.ok ? 'Copied' : 'Copy failed') : 'Copy'}
</button>
<span class="copy-button__status" role="status">{result && !result.ok ? result.error : ''}</span>

<style>
	.copy-button {
		padding: var(--pau-space-1) var(--pau-space-2);
		border: var(--pau-border-thin) solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		background: var(--pau-surface-raised);
		color: var(--pau-text-muted);
		font: inherit;
		font-size: var(--pau-type-xs);
		cursor: pointer;
		transition:
			color var(--pau-duration-feedback) var(--pau-ease-standard),
			border-color var(--pau-duration-feedback) var(--pau-ease-standard);
	}

	.copy-button:hover,
	.copy-button:focus-visible {
		color: var(--pau-text);
	}

	.copy-button--copied {
		border-color: var(--pau-success);
		color: var(--pau-success);
	}

	.copy-button--failed {
		border-color: var(--pau-danger);
		color: var(--pau-danger);
	}

	/* Read by screen readers only. The button label already shows the failure. */
	.copy-button__status {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
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
