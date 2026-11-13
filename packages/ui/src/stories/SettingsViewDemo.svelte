<script lang="ts">
	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell, { type ShellNavItem } from '../lib/ApplicationShell.svelte';
	import SettingsView, { SETTINGS_SECTIONS } from '../lib/SettingsView.svelte';
	import type { MotionSetting } from '../motion';

	let {
		motion: initialMotion = 'system',
		saveError
	}: {
		motion?: MotionSetting;
		/** Rejects every save with this reason, as an unreachable backend would. */
		saveError?: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let motion = $state(initialMotion);

	const productItems: ShellNavItem[] = shellNavigationFixtures.productItems.map((item) =>
		item.id === 'settings' ? { ...item, href: '#settings', active: true } : { ...item, active: false }
	);
	const contextItems: ShellNavItem[] = SETTINGS_SECTIONS.map((section) => ({
		id: section.id,
		label: section.label,
		href: `#settings-${section.id}`
	}));

	async function save(value: MotionSetting): Promise<void> {
		if (saveError) throw new Error(saveError);
		motion = value;
	}
</script>

<ApplicationShell workspaceName="Settings" contextLabel="Sections" {productItems} {contextItems}>
	<SettingsView {motion} onMotionChange={save} />
</ApplicationShell>
