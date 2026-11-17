<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { permissionRequest } from './permission-request';
	import type { ExtensionUiResponse, ExtensionUiState } from './types/session';

	type Props = {
		/** Extension UI to render. Its statuses belong to the session status line, so this ignores them. */
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
	let selectedOption = $state(0);
	const focusReturn = createFocusReturn();

	/** The dialog to show. A permission request renders as the session's request card instead. */
	const dialog = $derived(
		extensionState.dialog?.id === expiredDialogId || permissionRequest(extensionState.dialog)
			? undefined
			: extensionState.dialog
	);
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

	/** Parsed form of a structured title: any JSON the extension sent. */
	type TitleDetail = { kind: 'structured'; text: string };

	const MAX_STRUCTURED_TITLE = 600;

	/**
	 * Reads a title that is a JSON object or array. Showing it as the dialog
	 * title would expose raw JSON, so it becomes a trimmed code block. Plain
	 * text titles return nothing.
	 */
	function titleDetail(title: string): TitleDetail | undefined {
		const text = title.trim();
		if (!/^[{[]/.test(text)) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return undefined;
		}
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const pretty = JSON.stringify(parsed, null, 2);
		return {
			kind: 'structured',
			text: pretty.length > MAX_STRUCTURED_TITLE ? `${pretty.slice(0, MAX_STRUCTURED_TITLE)}\n...` : pretty
		};
	}

	function headingFor(title: string, detail: TitleDetail | undefined): string {
		return detail ? 'Extension request' : title;
	}

	function openDialog(): void {
		if (!dialogSurface) return;
		if (!dialogSurface.open) {
			focusReturn.capture();
			dialogSurface.showModal();
		}
		// Native modal focus picks the first control; the dialog marks its own starting point.
		(dialogSurface.querySelector<HTMLElement>('[data-initial-focus]') ?? dialogSurface).focus();
	}

	function closeDialog(): void {
		dialogSurface?.close();
		focusReturn.restore();
	}

	$effect(() => {
		if (!dialog?.id) return;
		responseError = undefined;
		selectedOption = 0;
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

	function submitChoice(event: SubmitEvent, requestId: string, options: string[]): void {
		event.preventDefault();
		const value = options[selectedOption];
		if (value !== undefined) void respond({ id: requestId, value });
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
				<button
					type="button"
					class="pau-button pau-button--secondary"
					data-initial-focus={onOpenTerminal ? undefined : ''}
					onclick={() => void respond({ id: dialog.id, cancelled: true })}>
					Dismiss
				</button>
				{#if onOpenTerminal}
					<button type="button" class="pau-button pau-button--primary" data-initial-focus onclick={onOpenTerminal}
						>Open Pi in terminal</button>
				{/if}
			</div>
		{:else}
			{@const detail = titleDetail(dialog.title)}
			<h2 id={`extension-dialog-${dialog.id}`}>{headingFor(dialog.title, detail)}</h2>
			{#if detail}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<pre class="extension-ui__code" tabindex="0"><code>{detail.text}</code></pre>
			{/if}
			{#if dialog.kind === 'confirm'}
				<p>{dialog.message}</p>
				<div class="extension-ui__actions">
					<button
						type="button"
						class="pau-button pau-button--secondary"
						disabled={responding}
						onclick={() => void respond({ id: dialog.id, confirmed: false })}>No</button>
					<button
						type="button"
						class="pau-button pau-button--primary"
						data-initial-focus
						disabled={responding}
						onclick={() => void respond({ id: dialog.id, confirmed: true })}>Yes</button>
				</div>
			{:else if dialog.kind === 'select'}
				{@const options = dialog.options}
				<form onsubmit={(event) => submitChoice(event, dialog.id, options)}>
					<fieldset class="extension-ui__options" aria-labelledby={`extension-dialog-${dialog.id}`}>
						{#each options as option, index (`${index}-${option}`)}
							<label class="extension-ui__option pau-row">
								<input
									type="radio"
									name={`extension-option-${dialog.id}`}
									value={option}
									checked={index === selectedOption}
									disabled={responding}
									data-initial-focus={index === Math.max(selectedOption, 0) ? '' : undefined}
									onchange={() => (selectedOption = index)} />
								<span>{option}</span>
								<Icon name="check" class="extension-ui__check" size={16} />
							</label>
						{/each}
					</fieldset>
					<div class="extension-ui__actions">
						<button
							type="button"
							class="pau-button pau-button--secondary"
							disabled={responding}
							onclick={() => void respond({ id: dialog.id, cancelled: true })}>Cancel</button>
						<button
							type="submit"
							class="pau-button pau-button--primary"
							disabled={responding || selectedOption < 0 || options.length === 0}>Select</button>
					</div>
				</form>
			{:else}
				<form onsubmit={(event) => submitText(event, dialog.id)}>
					<label>
						<span>{dialog.kind === 'editor' ? 'Text' : 'Response'}</span>
						{#if dialog.kind === 'editor'}
							<textarea name="value" rows="7" data-initial-focus>{dialog.prefill ?? ''}</textarea>
						{:else}
							<input class="pau-field" name="value" placeholder={dialog.placeholder} data-initial-focus />
						{/if}
					</label>
					<div class="extension-ui__actions">
						<button
							type="button"
							class="pau-button pau-button--secondary"
							disabled={responding}
							onclick={() => void respond({ id: dialog.id, cancelled: true })}>Cancel</button>
						<button type="submit" class="pau-button pau-button--primary" disabled={responding}>Submit</button>
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
		font-size: var(--pau-type-md);
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
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.extension-ui__dialog {
		width: min(32rem, calc(100% - 2rem));
		max-height: min(38rem, calc(100dvh - 2rem));
		padding: var(--pau-space-4);
		overflow: auto;
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-overlay);
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

	/* Extensions control these strings, and some send long unbroken text such as JSON. */
	.extension-ui__dialog h2,
	.extension-ui__dialog p,
	.extension-ui__option span,
	.extension-ui__notification {
		overflow-wrap: anywhere;
	}

	.extension-ui__dialog > p {
		margin-top: var(--pau-space-3);
		color: var(--pau-text-muted);
		line-height: 1.5;
	}

	.extension-ui__dialog form {
		display: grid;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
	}

	.extension-ui__options {
		display: grid;
		margin: 0;
		padding: 0;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.extension-ui__dialog label.extension-ui__option {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-target-touch);
		padding-inline: var(--pau-space-3);
		cursor: pointer;
	}

	.extension-ui__option + .extension-ui__option {
		border-top: 1px solid var(--pau-border);
	}

	.extension-ui__dialog .extension-ui__option span {
		display: block;
		flex: 1;
		color: var(--pau-text);
		font-size: inherit;
	}

	/* The radio is the accessible control; the row and check mark are its visible form. */
	.extension-ui__dialog .extension-ui__option input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		opacity: 0;
		border: 0;
		cursor: pointer;
	}

	.extension-ui__option :global(.extension-ui__check) {
		visibility: hidden;
		flex: none;
		color: var(--pau-accent);
	}

	.extension-ui__option:has(input:checked) {
		background-color: var(--pau-surface-raised);
	}

	.extension-ui__option:has(input:checked) :global(.extension-ui__check) {
		visibility: visible;
	}

	.extension-ui__option:has(input:focus-visible) {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: calc(var(--pau-focus-width) * -1);
	}

	.extension-ui__code {
		margin: var(--pau-space-3) 0 0;
		padding: var(--pau-space-3);
		max-height: 14rem;
		overflow: auto;
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.extension-ui__dialog label,
	.extension-ui__dialog label span {
		display: grid;
		gap: var(--pau-space-2);
	}

	.extension-ui__dialog label span {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.extension-ui__dialog .pau-field {
		width: 100%;
	}

	.extension-ui__dialog textarea {
		box-sizing: border-box;
		width: 100%;
		padding: var(--pau-space-3);
		resize: vertical;
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border-control);
		font: inherit;
	}

	.extension-ui__dialog textarea:focus,
	.extension-ui__dialog button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.extension-ui__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
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
