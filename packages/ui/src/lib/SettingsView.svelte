<script lang="ts" module>
	import type { MotionSetting } from '../motion';
	import type { ThemeName, UiFontName } from '../theme';

	/**
	 * Settings sections in the order the view and its navigation show them.
	 * The app owner links each one as `#settings-<id>` from the context rail.
	 */
	export const SETTINGS_SECTIONS = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'sandbox', label: 'Sandbox' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'keyboard', label: 'Keyboard' },
		{ id: 'editor', label: 'Editor' },
		{ id: 'shell', label: 'Shell' },
		{ id: 'about', label: 'About' }
	] as const;

	export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

	/** Which session events notify the operator: those that need them, those and finished turns, or none. */
	export type NotificationSetting = 'attention' | 'all' | 'off';

	/** The choices Settings saves, keyed as `onChange` names them. */
	export type SettingsChoices = {
		theme: ThemeName;
		uiFont: UiFontName;
		notifications: NotificationSetting;
		motion: MotionSetting;
	};
</script>

<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	import { THEMES, UI_FONTS } from '../theme';
	import Icon from './Icon.svelte';
	import KeyboardShortcutList from './KeyboardShortcutList.svelte';
	import type { KeyPlatform, ResolvedKeyAction } from './keymap.svelte';
	import PageHeader from './PageHeader.svelte';

	type Props = {
		/** The saved theme. */
		theme: ThemeName;
		/** The saved UI font. */
		uiFont: UiFontName;
		/** The saved notification policy. */
		notifications: NotificationSetting;
		/** The saved motion setting. */
		motion: MotionSetting;
		/**
		 * Saves a choice the operator made. The view shows the props, so the
		 * owner moves them to the pick and back when the save fails. A
		 * rejection shows its reason under the setting, unless the operator has
		 * made another choice for that setting since.
		 */
		onChange: <K extends keyof SettingsChoices>(key: K, value: SettingsChoices[K]) => Promise<void> | void;
		/** Shortcuts the Keyboard section lists, with their chords resolved. */
		shortcuts: readonly ResolvedKeyAction[];
		platform: KeyPlatform;
		/**
		 * The sandbox new sessions get in the workspace the operator works in,
		 * which the Sandbox section summarizes and links to Agent sandbox to
		 * edit. Without it, the section asks for a workspace first.
		 */
		sandbox?: { workspace: string; summary?: string; href: string };
		/** Where About links to Diagnostics. */
		diagnosticsHref?: string;
	};

	let { theme, uiFont, notifications, motion, onChange, shortcuts, platform, sandbox, diagnosticsHref }: Props =
		$props();

	const motionChoices: { value: MotionSetting; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'reduce', label: 'Reduce' },
		{ value: 'full', label: 'Full' }
	];
	const notificationChoices: { value: NotificationSetting; label: string }[] = [
		{ value: 'attention', label: 'When a session needs you' },
		{ value: 'all', label: 'When a session finishes or needs you' },
		{ value: 'off', label: 'Off' }
	];
	const themeNames = Object.keys(THEMES) as ThemeName[];
	const fontNames = Object.keys(UI_FONTS) as UiFontName[];

	const saved = $derived<SettingsChoices>({ theme, uiFont, notifications, motion });

	/** Names a setting for its element IDs. Only the saved choices can fail. */
	type SettingSlug = keyof SettingsChoices | 'sandbox' | 'diagnostics';

	let errors = $state<Partial<Record<SettingSlug, string>>>({});
	/**
	 * The operator's latest pick for each setting. A rejection is reported
	 * only while its pick is still the latest, because a later pick's own
	 * save decides what is saved.
	 */
	const latest: Partial<SettingsChoices> = {};

	/**
	 * Saves a pick and reports a failure under its setting. The owner restores
	 * the saved value through the props, but an owner that never moved the
	 * prop leaves the browser's own check on the failed radio, so the group is
	 * set back to the prop here.
	 */
	async function change<K extends keyof SettingsChoices>(
		key: K,
		value: SettingsChoices[K],
		input: HTMLInputElement
	): Promise<void> {
		latest[key] = value;
		errors[key] = undefined;
		try {
			await onChange(key, value);
		} catch (error) {
			if (latest[key] !== value) return;
			for (const radio of document.getElementsByName(input.name)) {
				if (radio instanceof HTMLInputElement) radio.checked = radio.value === saved[key];
			}
			errors[key] = error instanceof Error ? error.message : String(error);
		}
	}

	/** A few tokens of code in the theme's own syntax colors, as a preview of the theme. */
	function previewStyle(name: ThemeName): string {
		const { colors, syntax } = THEMES[name];
		return [
			`--preview-canvas: ${colors.canvas}`,
			`--preview-border: ${colors.border}`,
			`--preview-text: ${colors.text}`,
			`--preview-keyword: ${syntax.keyword}`,
			`--preview-function: ${syntax.function}`,
			`--preview-number: ${syntax.number}`,
			`--preview-string: ${syntax.string}`
		].join('; ');
	}

	const id = $props.id();
</script>

<!--
	Each setting is one column: its name with the scope chip beside it, what it
	changes, then the control, so the control starts on the same edge as the
	name. The scope chip names where the choice applies, so a workspace setting
	never reads as a global one.
-->
{#snippet setting(name: string, slug: SettingSlug, description: string, scope: string, control: Snippet)}
	<div class="settings-view__setting">
		<div class="settings-view__heading">
			<span class="settings-view__name" id="{id}-{slug}-name">{name}</span>
			<span class="settings-view__scope" id="{id}-{slug}-scope"
				><span class="pau-visually-hidden">Scope:</span> {scope}</span>
		</div>
		<p class="settings-view__description" id="{id}-{slug}-description">{description}</p>
		<div class="settings-view__control">{@render control()}</div>
		{#if errors[slug]}
			<p class="settings-view__error" role="alert">Pau could not save this setting. {errors[slug]}</p>
		{/if}
	</div>
{/snippet}

{#snippet radioGroup<K extends keyof SettingsChoices>(
	key: K,
	choices: { value: SettingsChoices[K]; label: string; style?: string }[],
	layout: 'row' | 'column'
)}
	<div
		class={['settings-view__choices', `settings-view__choices--${layout}`]}
		role="radiogroup"
		aria-labelledby="{id}-{key}-name"
		aria-describedby="{id}-{key}-description {id}-{key}-scope">
		{#each choices as choice (choice.value)}
			<label class="settings-view__choice pau-choice">
				<input
					type="radio"
					name="{id}-{key}"
					value={choice.value}
					checked={saved[key] === choice.value}
					onchange={(event) => void change(key, choice.value, event.currentTarget)} />
				<span style={choice.style}>{choice.label}</span>
			</label>
		{/each}
	</div>
{/snippet}

{#snippet themeControl()}
	<div
		class="settings-view__themes"
		role="radiogroup"
		aria-labelledby="{id}-theme-name"
		aria-describedby="{id}-theme-description {id}-theme-scope">
		{#each themeNames as name (name)}
			<label class="settings-view__theme">
				<span class="settings-view__preview" style={previewStyle(name)} aria-hidden="true">
					<span><b>let</b> n = <i>wrap</i>(<em>42</em>)</span>
					<span><b>type</b> mode = <s>"dark"</s></span>
					<span class="settings-view__swatches">
						{#each THEMES[name].terminal.ansi.slice(1, 7) as color, index (index)}
							<span style="background: {color}"></span>
						{/each}
					</span>
				</span>
				<span class="settings-view__theme-name pau-choice">
					<input
						type="radio"
						name="{id}-theme"
						value={name}
						checked={theme === name}
						onchange={(event) => void change('theme', name, event.currentTarget)} />
					<span>{THEMES[name].label}</span>
				</span>
			</label>
		{/each}
	</div>
{/snippet}

{#snippet fontControl()}
	{@render radioGroup(
		'uiFont',
		fontNames.map((name) => ({
			value: name,
			label: UI_FONTS[name].label,
			style: `font-family: ${UI_FONTS[name].family}, ui-sans-serif, system-ui, sans-serif`
		})),
		'column'
	)}
{/snippet}

{#snippet notificationControl()}
	{@render radioGroup('notifications', notificationChoices, 'column')}
{/snippet}

{#snippet motionControl()}
	{@render radioGroup('motion', motionChoices, 'row')}
{/snippet}

{#snippet sandboxControl()}
	{#if sandbox}
		<a class="pau-button pau-button--secondary" href={sandbox.href}
			><Icon name="sandbox" size={16} /><span>Edit grants in Agent sandbox</span></a>
	{/if}
{/snippet}

{#snippet diagnosticsControl()}
	<a class="pau-button pau-button--secondary" href={diagnosticsHref}
		><Icon name="diagnostics" size={16} /><span>Open Diagnostics</span></a>
{/snippet}

<section class="settings-view" aria-labelledby="{id}-title">
	<PageHeader title="Settings" titleId="{id}-title" />

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
					'Theme',
					'theme',
					'Colors for Pau, its code views, and its terminals. External and terminal editors keep their own.',
					'All workspaces',
					themeControl
				)}
				{@render setting(
					'Font',
					'uiFont',
					'The typeface for labels, messages, and controls. Code always uses Overpass Mono.',
					'All workspaces',
					fontControl
				)}
				{@render setting(
					'Motion',
					'motion',
					'System follows the operating system. Reduce uses fades instead of slides and scaling. Full always animates.',
					'All workspaces',
					motionControl
				)}
			{:else if section.id === 'sandbox'}
				{#if sandbox}
					{@render setting(
						'Agent sandbox',
						'sandbox',
						`${sandbox.summary ?? 'Sandbox state unknown'}. New sessions in this workspace start with these grants.`,
						sandbox.workspace,
						sandboxControl
					)}
				{:else}
					<p class="settings-view__empty">Open a workspace to see and edit its sandbox.</p>
				{/if}
			{:else if section.id === 'about' && diagnosticsHref}
				{@render setting(
					'Diagnostics',
					'diagnostics',
					'Redacted build versions, agent handshakes and recent logs, for a bug report.',
					'This computer',
					diagnosticsControl
				)}
			{:else if section.id === 'notifications'}
				{@render setting(
					'Session notifications',
					'notifications',
					'A session you are not looking at notifies you when Pi waits for input, asks a question, or exits unexpectedly. Off also stops the badge on the app icon.',
					'All workspaces',
					notificationControl
				)}
			{:else if section.id === 'keyboard'}
				<p class="settings-view__intro">
					Where one of your Pi key bindings uses the same chord, the Pi binding wins and the shortcut says so.
				</p>
				<KeyboardShortcutList actions={shortcuts} {platform} showScope />
			{:else}
				<p class="settings-view__empty">No settings yet.</p>
			{/if}
		</section>
	{/each}
</section>

<style>
	.settings-view {
		/* The page header's title starts where the sections' text starts. */
		--pau-page-header-inset: var(--pau-space-3);
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
		gap: var(--pau-space-5);
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

	/*
	 * Every setting keeps one rhythm, top to bottom: the name and scope chip
	 * share a line, the description follows `space/1` below, and the control
	 * `space/2` below that, starting on the name's edge. Settings sit
	 * `space/5` apart, so the gap between two settings is always larger than
	 * any gap inside one.
	 */
	.settings-view__setting {
		display: grid;
		justify-items: start;
		font-size: var(--pau-type-md);
	}

	.settings-view__heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
	}

	/*
	 * The name and the chip trim their line boxes to the cap height and
	 * baseline, so centering them puts their capitals on one line, and the
	 * chip's even padding centers its own letters, whichever UI font is set.
	 */
	.settings-view__name {
		font-weight: 500;
		text-box: trim-both cap alphabetic;
	}

	.settings-view__scope {
		padding: var(--pau-space-2);
		color: var(--pau-text-muted);
		border: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
		line-height: 1;
		text-box: trim-both cap alphabetic;
	}

	.settings-view__description {
		margin-top: var(--pau-space-1);
	}

	.settings-view__control {
		justify-self: stretch;
		margin-top: var(--pau-space-2);
	}

	.settings-view__description,
	.settings-view__intro,
	.settings-view__empty {
		color: var(--pau-text-muted);
	}

	/* Text and short controls stop at 40rem, so on a wide window they stay near their name. Theme cards span the section. */
	.settings-view__description,
	.settings-view__intro,
	.settings-view__choices {
		max-width: 40rem;
	}

	.settings-view__choices {
		display: flex;
		flex-wrap: wrap;
		column-gap: var(--pau-space-4);
	}

	.settings-view__choices--column {
		flex-direction: column;
	}

	.settings-view__choice {
		display: inline-flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		cursor: pointer;
	}

	.settings-view__themes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: var(--pau-space-3);
	}

	.settings-view__theme {
		display: grid;
		gap: var(--pau-space-2);
		cursor: pointer;
	}

	/*
	 * The preview paints in the theme it shows, not the active one, so each
	 * card reads as that theme. The active accent marks the selected card.
	 */
	.settings-view__preview {
		display: grid;
		gap: var(--pau-space-1);
		padding: var(--pau-space-3);
		color: var(--preview-text);
		background: var(--preview-canvas);
		border: 1px solid var(--preview-border);
		border-radius: var(--pau-radius-control);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		white-space: nowrap;
		overflow: hidden;
	}

	.settings-view__theme:has(input:checked) .settings-view__preview {
		outline: 2px solid var(--pau-accent);
		outline-offset: 1px;
	}

	.settings-view__preview b,
	.settings-view__preview i,
	.settings-view__preview em,
	.settings-view__preview s {
		font-style: normal;
		font-weight: inherit;
		text-decoration: none;
	}

	.settings-view__preview b {
		color: var(--preview-keyword);
	}

	.settings-view__preview i {
		color: var(--preview-function);
	}

	.settings-view__preview em {
		color: var(--preview-number);
	}

	.settings-view__preview s {
		color: var(--preview-string);
	}

	.settings-view__swatches {
		display: flex;
		gap: var(--pau-space-1);
		margin-top: var(--pau-space-1);
	}

	.settings-view__swatches span {
		width: 0.75rem;
		height: 0.375rem;
	}

	.settings-view__theme-name {
		display: inline-flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
	}

	.settings-view__error {
		margin-top: var(--pau-space-2);
		color: var(--pau-danger);
	}
</style>
