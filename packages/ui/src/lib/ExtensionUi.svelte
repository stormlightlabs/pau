<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	import type { ExtensionUiResponse, ExtensionUiState } from './types/session';

	type Props = {
		state: ExtensionUiState;
		onRespond?: (response: ExtensionUiResponse) => void | Promise<void>;
		onTimeout?: (requestId: string) => void;
		onOpenTerminal?: () => void;
		children?: Snippet;
	};

	let { state: extensionState, onRespond = () => {}, onTimeout = () => {}, onOpenTerminal, children }: Props = $props();
	let responding = $state(false);
	let responseError = $state<string>();
	let expiredDialogId = $state<string>();
	let dialogSurface = $state<HTMLDialogElement>();

	const dialog = $derived(extensionState.dialog?.id === expiredDialogId ? undefined : extensionState.dialog);
	const aboveWidgets = $derived(extensionState.widgets.filter((widget) => widget.placement === 'above-editor'));
	const belowWidgets = $derived(extensionState.widgets.filter((widget) => widget.placement === 'below-editor'));

	$effect(() => {
		const request = extensionState.dialog;
		if (!request || !('timeoutMs' in request) || request.timeoutMs === undefined) return;
		const timer = setTimeout(() => {
			expiredDialogId = request.id;
			onTimeout(request.id);
		}, request.timeoutMs);
		return () => clearTimeout(timer);
	});

	function openDialog(): void {
		if (dialogSurface && !dialogSurface.open) dialogSurface.showModal();
		dialogSurface?.focus();
	}

	function closeDialog(): void {
		dialogSurface?.close();
	}

	$effect(() => {
		if (!dialog?.id) return;
		responseError = undefined;
		queueMicrotask(openDialog);
		return closeDialog;
	});

	async function respond(response: ExtensionUiResponse): Promise<void> {
		if (responding) return;
		responding = true;
		responseError = undefined;
		try {
			await onRespond(response);
		} catch (cause) {
			responseError = cause instanceof Error ? cause.message : 'The response could not be sent. Try again.';
		} finally {
			responding = false;
		}
	}

	function submitText(event: SubmitEvent, requestId: string): void {
		event.preventDefault();
		const value = new FormData(event.currentTarget as HTMLFormElement).get('value');
		void respond({ id: requestId, value: typeof value === 'string' ? value : '' });
	}
</script>

{#if extensionState.notifications.length > 0}
	<div class="extension-ui__notifications" aria-label="Extension notifications">
		{#each extensionState.notifications as notification (notification.id)}
			<p
				class={`extension-ui__notification extension-ui__notification--${notification.level}`}
				role={notification.level === 'error' ? 'alert' : 'status'}>
				{notification.message}
			</p>
		{/each}
	</div>
{/if}

{#each aboveWidgets as widget (widget.key)}
	<section class="extension-ui__widget" aria-label={`Extension widget: ${widget.key}`}>
		{#each widget.lines as line, index (`${index}-${line}`)}<p>{line}</p>{/each}
	</section>
{/each}

{#if children}{@render children()}{/if}

{#each belowWidgets as widget (widget.key)}
	<section class="extension-ui__widget" aria-label={`Extension widget: ${widget.key}`}>
		{#each widget.lines as line, index (`${index}-${line}`)}<p>{line}</p>{/each}
	</section>
{/each}

{#if extensionState.statuses.length > 0}
	<div class="extension-ui__statuses" aria-label="Extension status">
		{#each extensionState.statuses as status (status.key)}
			<span><strong>{status.key}</strong> {status.text}</span>
		{/each}
	</div>
{/if}

{#if dialog}
	<dialog
		bind:this={dialogSurface}
		class="extension-ui__dialog"
		aria-labelledby={`extension-dialog-${dialog.id}`}
		tabindex="-1"
		oncancel={(event) => {
			event.preventDefault();
			void respond({ id: dialog.id, cancelled: true });
		}}>
		{#if dialog.kind === 'unsupported'}
			<h2 id={`extension-dialog-${dialog.id}`}>Terminal-only extension interface</h2>
			<p>
				This extension uses a custom Pi component that Pau cannot render. Open vanilla Pi in a Pau terminal to use it.
			</p>
			<div class="extension-ui__actions">
				<button type="button" class="secondary" onclick={() => void respond({ id: dialog.id, cancelled: true })}>
					Dismiss
				</button>
				{#if onOpenTerminal}
					<button type="button" onclick={onOpenTerminal}>Open Pi in terminal</button>
				{/if}
			</div>
		{:else}
			<h2 id={`extension-dialog-${dialog.id}`}>{dialog.title}</h2>
			{#if dialog.kind === 'confirm'}
				<p>{dialog.message}</p>
				<div class="extension-ui__actions">
					<button
						type="button"
						class="secondary"
						disabled={responding}
						onclick={() => void respond({ id: dialog.id, confirmed: false })}>No</button>
					<button type="button" disabled={responding} onclick={() => void respond({ id: dialog.id, confirmed: true })}
						>Yes</button>
				</div>
			{:else if dialog.kind === 'select'}
				<div class="extension-ui__options">
					{#each dialog.options as option, index (`${index}-${option}`)}
						<button type="button" disabled={responding} onclick={() => void respond({ id: dialog.id, value: option })}
							>{option}</button>
					{/each}
				</div>
				<button
					type="button"
					class="extension-ui__cancel"
					disabled={responding}
					onclick={() => void respond({ id: dialog.id, cancelled: true })}>Cancel</button>
			{:else}
				<form onsubmit={(event) => submitText(event, dialog.id)}>
					<label>
						<span>{dialog.kind === 'editor' ? 'Text' : 'Response'}</span>
						{#if dialog.kind === 'editor'}
							<textarea name="value" rows="7">{dialog.prefill ?? ''}</textarea>
						{:else}
							<input name="value" placeholder={dialog.placeholder} />
						{/if}
					</label>
					<div class="extension-ui__actions">
						<button
							type="button"
							class="secondary"
							disabled={responding}
							onclick={() => void respond({ id: dialog.id, cancelled: true })}>Cancel</button>
						<button type="submit" disabled={responding}>Submit</button>
					</div>
				</form>
			{/if}
		{/if}
		{#if responseError}<p class="extension-ui__error" role="alert">{responseError}</p>{/if}
	</dialog>
{/if}

<style>
	.extension-ui__notifications {
		display: grid;
		gap: var(--pau-space-1);
		margin-bottom: var(--pau-space-2);
	}

	.extension-ui__notification,
	.extension-ui__widget p {
		margin: 0;
	}

	.extension-ui__notification {
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border-inline-start: 2px solid var(--pau-info);
		font-size: var(--pau-type-sm);
	}

	.extension-ui__notification--warning {
		border-color: var(--pau-warning);
	}

	.extension-ui__notification--error {
		border-color: var(--pau-danger);
	}

	.extension-ui__widget {
		padding: var(--pau-space-3) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.extension-ui__statuses {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2) var(--pau-space-4);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-inline: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
	}

	.extension-ui__statuses strong {
		color: var(--pau-text);
		font-weight: 600;
	}

	.extension-ui__dialog {
		width: min(32rem, calc(100% - 2rem));
		max-height: min(38rem, calc(100dvh - 2rem));
		padding: var(--pau-space-4);
		overflow: auto;
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-focus);
		box-shadow: 0 1rem 3rem color-mix(in srgb, var(--pau-canvas) 85%, transparent);
		outline: 0;
	}

	.extension-ui__dialog::backdrop {
		background: color-mix(in srgb, var(--pau-canvas) 78%, transparent);
	}

	.extension-ui__dialog h2,
	.extension-ui__dialog p {
		margin: 0;
	}

	.extension-ui__dialog h2 {
		font-size: var(--pau-type-lg);
	}

	.extension-ui__dialog > p {
		margin-top: var(--pau-space-3);
		color: var(--pau-text-muted);
		line-height: 1.5;
	}

	.extension-ui__dialog form,
	.extension-ui__options {
		display: grid;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
	}

	.extension-ui__dialog label,
	.extension-ui__dialog label span {
		display: grid;
		gap: var(--pau-space-2);
	}

	.extension-ui__dialog label span {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.extension-ui__dialog input,
	.extension-ui__dialog textarea {
		width: 100%;
		padding: var(--pau-space-3);
		resize: vertical;
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: inherit;
	}

	.extension-ui__dialog input:focus,
	.extension-ui__dialog textarea:focus,
	.extension-ui__dialog button:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 2px;
	}

	.extension-ui__dialog button {
		min-height: var(--pau-size-target-touch);
		padding-inline: var(--pau-space-3);
		color: var(--pau-canvas);
		background: var(--pau-accent);
		border: 0;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	.extension-ui__dialog button.secondary,
	.extension-ui__dialog .extension-ui__cancel {
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
	}

	.extension-ui__dialog button:disabled {
		color: var(--pau-text-muted);
		background: var(--pau-surface-raised);
		cursor: not-allowed;
	}

	.extension-ui__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
	}

	.extension-ui__cancel {
		margin-top: var(--pau-space-2);
	}

	.extension-ui__error {
		margin-top: var(--pau-space-3) !important;
		color: var(--pau-danger) !important;
	}

	@media (max-width: 30rem) {
		.extension-ui__dialog {
			width: calc(100% - 1rem);
			max-height: calc(100dvh - 1rem);
		}
	}
</style>
