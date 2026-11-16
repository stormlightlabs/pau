<script lang="ts">
	import '../styles/tokens.css';

	import { isTextField } from './keymap.svelte';
	import { permissionDecision, permissionQuestion, type PermissionRequest } from './permission-request';
	import type { ExtensionUiResponse } from './types/session';

	/**
	 * A permission request as the focal point of the session view: the one
	 * green surface on it. Each decision carries its key cap. The keys choose
	 * while focus is outside a text field and no menu or dialog is open, so a
	 * request that arrives while the operator types never takes their
	 * keystrokes, and the card never takes focus on its own. A card behind an
	 * open overlay sits in an inert subtree and ignores the keys too, since
	 * `inert` stops focus and pointer events but not a window listener.
	 */
	type Props = {
		request: PermissionRequest;
		/** The agent's name as people know it, such as "Pi". */
		agent: string;
		/** Why the decisions cannot be sent now, such as a lost connection. The card stays visible. */
		unavailable?: string;
		onRespond: (response: ExtensionUiResponse) => void | Promise<void>;
	};

	let { request, agent, unavailable, onRespond }: Props = $props();

	let card = $state<HTMLElement>();
	let responding = $state(false);
	let error = $state<string>();

	const question = $derived(permissionQuestion(request));
	const body = $derived(
		request.reason
			? `${agent} wants to use ${request.tool}. ${request.reason}`
			: `${agent} wants to use ${request.tool}.`
	);
	const decisions = $derived(request.options.map((option) => ({ option, ...permissionDecision(option) })));
	const disabled = $derived(responding || unavailable !== undefined);
	const titleId = $derived(`request-${request.id}-title`);
	const reasonId = $derived(`request-${request.id}-unavailable`);

	async function respond(option: string): Promise<void> {
		if (disabled) return;
		responding = true;
		error = undefined;
		try {
			await onRespond({ id: request.id, value: option });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The answer could not be sent. Try again.';
		} finally {
			responding = false;
		}
	}

	/**
	 * Surfaces that own single keys while open: a menu, whose items answer
	 * to letters, and any dialog or modal panel. A stray Y there must never
	 * approve a call.
	 */
	const KEY_OWNERS = '[role="menu"], dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

	function handleKeydown(event: KeyboardEvent): void {
		const modified = event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey;
		if (modified || isTextField(event.target) || card?.closest('[inert]') || document.querySelector(KEY_OWNERS)) return;
		const decision = decisions.find((candidate) => candidate.key === event.key.toLowerCase());
		if (!decision) return;
		event.preventDefault();
		void respond(decision.option);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="pau-request request-card" aria-labelledby={titleId} data-request={request.id} bind:this={card}>
	<div class="pau-request__head">
		<span class="pau-mark pau-mark--waiting" aria-hidden="true"></span>
		<h2 class="pau-request__title" id={titleId}>
			{question.before}{#if question.target}<code>{question.target}</code>{/if}{question.after}
		</h2>
	</div>
	<p class="pau-request__body">
		{body}
	</p>
	{#if request.paths.length > 1 || request.cwd}
		<dl class="request-card__details">
			{#if request.paths.length > 1}
				<div>
					<dt>Paths</dt>
					<dd>
						{#each request.paths as path (path)}<code>{path}</code>{/each}
					</dd>
				</div>
			{/if}
			{#if request.cwd}
				<div>
					<dt>Working directory</dt>
					<dd><code>{request.cwd}</code></dd>
				</div>
			{/if}
		</dl>
	{/if}
	<div class="pau-request__actions">
		{#each decisions as decision, index (decision.option)}
			<button
				type="button"
				class={['pau-button', index === 0 ? 'pau-button--primary' : 'pau-button--secondary']}
				aria-keyshortcuts={decision.key?.toUpperCase()}
				aria-describedby={unavailable ? reasonId : undefined}
				{disabled}
				onclick={() => void respond(decision.option)}>
				<span>{decision.label}</span>{#if decision.key}<kbd><span>{decision.key.toUpperCase()}</span></kbd>{/if}
			</button>
		{/each}
	</div>
	{#if unavailable}<p class="request-card__note" id={reasonId}>{unavailable}</p>{/if}
	{#if error}<p class="request-card__note request-card__note--error" role="alert">{error}</p>{/if}
</section>

<style>
	.request-card__details {
		display: grid;
		gap: var(--pau-space-2);
		margin: 0;
	}

	.request-card__details div {
		display: grid;
		gap: var(--pau-space-1);
	}

	.request-card__details dt {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-tight);
	}

	.request-card__details dd {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
	}

	.request-card__details code {
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-row);
		overflow-wrap: anywhere;
	}

	.request-card__note {
		margin-block: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-tight);
	}

	.request-card__note--error {
		color: var(--pau-danger);
	}
</style>
