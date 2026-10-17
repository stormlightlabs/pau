<script lang="ts">
	import type { ModelOption } from './types/session';

	type Props = {
		/** Lists the models the session can use. A rejection shows its message. */
		load: () => Promise<ModelOption[]>;
		/** Selects a model. A rejection shows its message and keeps the list open. */
		onSelect: (model: ModelOption) => void | Promise<void>;
		/** Whether the agent can switch models at all. */
		supported?: boolean;
		/** Explains why the picker is read-only right now, such as during a run. */
		unavailableReason?: string;
		/** Receives each fetched model list, so neighbours can read the current model. */
		onLoaded?: (models: ModelOption[]) => void;
		/** Model shown until the list arrives. */
		fallbackLabel?: string;
	};

	let { load, onSelect, supported = true, unavailableReason, fallbackLabel, onLoaded }: Props = $props();

	let models = $state<ModelOption[]>();
	let loadError = $state<string>();
	let selectError = $state<string>();
	let open = $state(false);
	let pendingId = $state<string>();

	const current = $derived(models?.find((model) => model.current));
	const label = $derived(current ? modelLabel(current) : (fallbackLabel ?? 'Model'));
	const disabled = $derived(!supported || unavailableReason !== undefined);
	const explanation = $derived(
		supported ? unavailableReason : 'This agent does not support switching models in a session.'
	);

	function modelLabel(model: ModelOption): string {
		return model.name || model.id;
	}

	async function fetchModels(): Promise<void> {
		loadError = undefined;
		try {
			models = await load();
			onLoaded?.(models);
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Pau could not list the available models.';
		}
	}

	async function select(model: ModelOption): Promise<void> {
		if (pendingId) return;
		pendingId = `${model.provider}/${model.id}`;
		selectError = undefined;
		try {
			await onSelect(model);
			open = false;
			await fetchModels();
		} catch (cause) {
			selectError = cause instanceof Error ? cause.message : 'The model could not be changed. Try again.';
		} finally {
			pendingId = undefined;
		}
	}

	// The picker mounts for each session, so one load per mount refreshes the list on open.
	$effect(() => {
		if (supported) void fetchModels();
	});

	$effect(() => {
		if (disabled) open = false;
	});
</script>

<div class="model-picker">
	<button
		type="button"
		class="model-picker__trigger"
		aria-label={`Model: ${label}`}
		aria-haspopup="true"
		aria-expanded={open}
		aria-describedby={explanation ? 'model-picker-note' : undefined}
		title={explanation}
		{disabled}
		onclick={() => (open = !open)}>
		{pendingId ? 'Switching…' : label}
	</button>
	{#if explanation}<span id="model-picker-note" class="model-picker__hint">{explanation}</span>{/if}

	{#if open}
		<div class="model-picker__panel" role="group" aria-label="Models">
			{#if selectError}<p class="model-picker__error" role="alert">{selectError}</p>{/if}
			{#if loadError}
				<p class="model-picker__error" role="alert">{loadError}</p>
				<button type="button" onclick={() => void fetchModels()}>Try again</button>
			{:else if !models}
				<p class="model-picker__note" role="status">Loading models…</p>
			{:else if models.length === 0}
				<p class="model-picker__note">No models are available. Sign in to a provider in Pi, then reopen this list.</p>
			{:else}
				<ul>
					{#each models as model (`${model.provider}/${model.id}`)}
						<li>
							<button
								type="button"
								aria-current={model.current ? 'true' : undefined}
								disabled={pendingId !== undefined}
								onclick={() => void select(model)}>
								<span class="model-picker__name">
									<small>{model.provider}</small>
									{modelLabel(model)}
								</span>
								{#if model.reasoning}<span class="model-picker__badge">Reasoning</span>{/if}
								{#if model.current}<span class="model-picker__badge">Current</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.model-picker {
		position: relative;
	}

	button {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-sm);
		cursor: pointer;
	}

	button:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	/* Screen readers get the explanation through aria-describedby. Sighted users get the title. */
	.model-picker__hint {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.model-picker__panel {
		position: absolute;
		top: calc(100% + var(--pau-space-1));
		right: 0;
		z-index: 10;
		display: grid;
		gap: var(--pau-space-2);
		width: 20rem;
		max-width: 80vw;
		max-height: 18rem;
		padding: var(--pau-space-2);
		overflow-y: auto;
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
	}

	ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li button {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		text-align: left;
		border-color: transparent;
	}

	li button[aria-current='true'] {
		border-color: var(--pau-border);
	}

	.model-picker__name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.model-picker__name small {
		display: block;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.model-picker__badge {
		flex: none;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.model-picker__note,
	.model-picker__error {
		margin: 0;
		padding: var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.model-picker__error {
		color: var(--pau-danger);
	}
</style>
