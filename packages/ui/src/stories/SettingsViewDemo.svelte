<script lang="ts">
	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell, { type ShellNavItem } from '../lib/ApplicationShell.svelte';
	import { Keymap, type PiKeyBinding } from '../lib/keymap.svelte';
	import SettingsView, { SETTINGS_SECTIONS, type SettingsChoices } from '../lib/SettingsView.svelte';

	let {
		initial = {},
		saveError,
		piBindings = []
	}: {
		/** Saved choices to start from. Unset ones use Pau's defaults. */
		initial?: Partial<SettingsChoices>;
		/** Rejects every save with this reason, as an unreachable backend would. */
		saveError?: string;
		/** Pi bindings that take chords from Pau's shortcuts. */
		piBindings?: PiKeyBinding[];
	} = $props();

	// svelte-ignore state_referenced_locally
	let choices = $state<SettingsChoices>({
		theme: 'eldritch',
		uiFont: 'overpass',
		notifications: 'attention',
		motion: 'system',
		...initial
	});

	const keymap = new Keymap({ platform: 'mac' });
	// svelte-ignore state_referenced_locally
	keymap.setPiBindings(piBindings);

	const productItems: ShellNavItem[] = shellNavigationFixtures.productItems.map((item) =>
		item.id === 'settings' ? { ...item, href: '#settings', active: true } : { ...item, active: false }
	);
	const contextItems: ShellNavItem[] = SETTINGS_SECTIONS.map((section) => ({
		id: section.id,
		label: section.label,
		href: `#settings-${section.id}`
	}));

	async function save<K extends keyof SettingsChoices>(key: K, value: SettingsChoices[K]): Promise<void> {
		if (saveError) throw new Error(saveError);
		choices[key] = value;
	}
</script>

<ApplicationShell contextLabel="Sections" {productItems} {contextItems} theme={choices.theme} uiFont={choices.uiFont}>
	<SettingsView {...choices} onChange={save} shortcuts={keymap.actions} platform={keymap.platform} />
</ApplicationShell>
