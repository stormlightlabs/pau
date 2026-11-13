<script lang="ts" module>
	/**
	 * Settings sections in the order the view and its navigation show them.
	 * The app owner links each one as `#settings-<id>` from the context rail.
	 */
	export const SETTINGS_SECTIONS = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'keyboard', label: 'Keyboard' },
		{ id: 'editor', label: 'Editor' },
		{ id: 'shell', label: 'Shell' }
	] as const;

	export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];
</script>

<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	import type { MotionSetting } from '../motion';
	import ViewHeader from './ViewHeader.svelte';

	type Props = {
		/** The saved motion setting. */
		motion: MotionSetting;
		/**
		 * Saves a motion setting the operator picked. A rejection selects
		 * `motion` again and shows the reason under the setting, unless the
		 * operator has picked another choice since.
		 */
		onMotionChange: (value: MotionSetting) => Promise<void> | void;
	};

	let { motion, onMotionChange }: Props = $props();

	const motionChoices: { value: MotionSetting; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'reduce', label: 'Reduce' },
		{ value: 'full', label: 'Full' }
	];

	/** The selected choice, which leads `motion` while a save is in flight and falls back to it when one fails. */
	let selectedMotion = $derived(motion);
	let motionError = $state<string>();
	/**
	 * The operator's latest pick. A failed save is reported only while it is
	 * still the latest, because a later pick's own save decides what is saved.
	 * `selectedMotion` cannot answer that: the owner may already have rolled
	 * `motion` back, which resets the derived value before the rejection lands.
	 */
	let latestMotion: MotionSetting | undefined;

	async function changeMotion(value: MotionSetting): Promise<void> {
		latestMotion = value;
		selectedMotion = value;
		motionError = undefined;
		try {
			await onMotionChange(value);
		} catch (error) {
			if (latestMotion !== value) return;
			selectedMotion = motion;
			motionError = error instanceof Error ? error.message : String(error);
		}
	}

	const id = $props.id();
</script>

<!--
	Each setting is a row: its name, what it changes, and its scope on the
	left, the control on the right. The scope chip names where the choice
	applies, so a workspace setting never reads as a global one.
-->
{#snippet setting(name: string, slug: string, description: string, scope: string, control: Snippet, error?: string)}
	<div class="settings-view__setting">
		<div class="settings-view__about">
			<span class="settings-view__name" id="{id}-{slug}-name">{name}</span>
			<p id="{id}-{slug}-description">{description}</p>
			<span class="settings-view__scope" id="{id}-{slug}-scope"
				><span class="settings-view__sr-only">Scope: </span>{scope}</span>
		</div>
		<div class="settings-view__control">{@render control()}</div>
		{#if error}
			<p class="settings-view__error" role="alert">Pau could not save this setting. {error}</p>
		{/if}
	</div>
{/snippet}

{#snippet motionControl()}
	<div
		class="settings-view__choices"
		role="radiogroup"
		aria-labelledby="{id}-motion-name"
		aria-describedby="{id}-motion-description {id}-motion-scope">
		{#each motionChoices as choice (choice.value)}
			<label class="settings-view__choice pau-choice">
				<input
					type="radio"
					name="{id}-motion"
					value={choice.value}
					checked={selectedMotion === choice.value}
					onchange={() => void changeMotion(choice.value)} />
				<span>{choice.label}</span>
			</label>
		{/each}
	</div>
{/snippet}

<section class="settings-view" aria-labelledby="{id}-title">
	<ViewHeader eyebrow="Preferences" title="Settings" titleId="{id}-title" />

	{#each SETTINGS_SECTIONS as section (section.id)}
		<!-- Focusable so a section link moves focus here, and Tab continues from the chosen section. -->
		<section
			id="settings-{section.id}"
			class="settings-view__section"
			aria-labelledby="{id}-{section.id}"
			tabindex="-1">
			<h2 id="{id}-{section.id}">{section.label}</h2>
			{#if section.id === 'appearance'}
				{@render setting(
					'Motion',
					'motion',
					'System follows the operating system. Reduce uses fades instead of slides and scaling. Full always animates.',
					'All workspaces',
					motionControl,
					motionError
				)}
			{:else}
				<p class="settings-view__empty">No settings yet.</p>
			{/if}
		</section>
	{/each}
</section>

<style>
	.settings-view {
		container-type: inline-size;
		min-width: 0;
		max-width: 56rem;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
	}

	.settings-view p {
		margin: 0;
	}

	/* Sections start on the view header's inset, so headings, names, and the title share one edge. */
	.settings-view__section {
		display: grid;
		gap: var(--pau-space-3);
		padding: var(--pau-space-4) var(--pau-space-3);
		border-top: 1px solid var(--pau-border);
		scroll-margin-top: var(--pau-space-4);
	}

	/* A section takes focus only as a link target, so it shows no ring of its own. */
	.settings-view__section:focus {
		outline: none;
	}

	h2 {
		margin: 0;
		font-size: var(--pau-type-lg);
		font-weight: 600;
	}

	.settings-view__setting {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		column-gap: var(--pau-space-5);
		row-gap: var(--pau-space-2);
		font-size: var(--pau-type-md);
	}

	.settings-view__about {
		display: grid;
		justify-items: start;
		gap: var(--pau-space-1);
	}

	.settings-view__name {
		font-weight: 500;
	}

	.settings-view__about p,
	.settings-view__empty {
		color: var(--pau-text-muted);
	}

	.settings-view__about p {
		max-width: 40rem;
	}

	.settings-view__scope {
		margin-top: var(--pau-space-1);
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--pau-text-muted);
		border: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
	}

	.settings-view__choices {
		display: flex;
		flex-wrap: wrap;
		column-gap: var(--pau-space-4);
	}

	.settings-view__choice {
		display: inline-flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		cursor: pointer;
	}

	.settings-view__choice input:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.settings-view__error {
		grid-column: 1 / -1;
		color: var(--pau-danger);
	}

	.settings-view__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* Narrow panes stack the control under its description instead of squeezing the description. */
	@container (max-width: 36rem) {
		.settings-view__setting {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
